import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { pool } from "./db.js";
import {
  checkSignInLock,
  recordSignInFailure,
  recordSignInSuccess,
  humanizeDuration,
  SHOW_REMAINING_AT,
} from "./login-throttle.js";

/**
 * Better Auth instance — the api is the authentication authority for the whole
 * system (the dashboard is a client that carries the session cookie). It uses
 * Better Auth's built-in adapter over the SAME pg pool the app's drizzle client
 * uses (backend/api/src/db/client.ts), so auth and app data share one database.
 * Better Auth owns its own tables (user/session/account/verification, plus the
 * organization plugin's organization/member/invitation); they are created by
 * db/auth-migrate.ts. The app tables (agents/policies/spend_events) stay under
 * drizzle-kit.
 *
 * Scoping model: one organization per account (created on sign-up below), and
 * the session is pinned to that org. Agents are scoped to the active org, which
 * is what isolates one account's data from another's. This is also the seed of
 * the future host/invite/delegate model (see docs/PLANS.md) — the org plugin
 * already carries the member/invitation tables and roles.
 */

const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000";

export const auth = betterAuth({
  // A pg.Pool selects Better Auth's built-in Postgres (Kysely) adapter, so its
  // schema is applied by getMigrations (db/auth-migrate.ts), not drizzle-kit.
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
  // Signs/encrypts sessions. Required — see .env / .env.example.
  secret: process.env.BETTER_AUTH_SECRET,
  // The dashboard origin is trusted for CSRF/origin checks. The api's CORS layer
  // (index.ts) separately allows this origin with credentials so the session
  // cookie can travel dashboard(:3000) -> api(:4000) (same site).
  trustedOrigins: [DASHBOARD_ORIGIN],
  emailAndPassword: {
    // Email + password only for this cut. Password hashing is Better Auth's
    // scrypt default. No email verification (no mail infra yet) — a documented
    // follow-up in docs/PLANS.md. autoSignIn (default) issues a session on
    // sign-up so the user lands straight on the dashboard.
    enabled: true,
  },
  plugins: [organization()],
  rateLimit: {
    // Belt to the api's global @fastify/rate-limit braces: Better Auth adds its
    // own limiter on the auth surface, with stricter caps on the credential
    // endpoints to blunt brute-force / credential-stuffing.
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  hooks: {
    // Progressive per-account sign-in lockout (see login-throttle.ts + PLAN.md).
    // Both hooks run for EVERY auth endpoint, so each guards on the sign-in path.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = (ctx.body as { email?: string } | undefined)?.email;
      if (!email) return;
      const lock = await checkSignInLock(email);
      if (lock.locked) {
        // Reject before the password is checked: a locked identifier is refused
        // even with correct credentials, and this attempt is NOT counted as a
        // failure (the endpoint never runs, so the after-hook doesn't fire).
        throw new APIError(
          "TOO_MANY_REQUESTS",
          {
            message: `Too many failed attempts. Try again in ${humanizeDuration(lock.retryAfterSec)}.`,
            code: "ACCOUNT_LOCKED",
            retryAfter: lock.retryAfterSec,
          },
          { "Retry-After": String(lock.retryAfterSec) },
        );
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = (ctx.body as { email?: string } | undefined)?.email;
      if (!email) return;

      // `returned` is the endpoint's result: an APIError on a failed sign-in
      // (401 for bad credentials), or the session payload on success. See the
      // Better Auth dispatch pipeline (better-auth/dist/api/dispatch.mjs).
      const returned = (ctx.context as { returned?: unknown }).returned;
      const credentialFailure =
        returned instanceof APIError && returned.statusCode === 401;

      if (!credentialFailure) {
        // Clear the record only on a genuine success — not on a validation/500
        // error, which shouldn't count for or against the user.
        if (!(returned instanceof APIError)) await recordSignInSuccess(email);
        return;
      }

      const result = await recordSignInFailure(email);
      if (result.locked) {
        // This failed credential attempt is what tripped the lockout. The
        // sign-in endpoint already resolved as 401, and Better Auth's dispatch
        // pins the HTTP status to that original result even when an after-hook
        // overrides the body (dist/api/dispatch.mjs sets result.response but not
        // result.status). So this response is an honest 401 ("your login
        // failed") that ALSO carries the lockout details. The 429 "we didn't
        // even check" response is the before-hook's, on the next attempt. The
        // client keys on `code`/`retryAfter` in the body, which are identical
        // in both, so the countdown renders either way.
        throw new APIError("UNAUTHORIZED", {
          message: `Too many failed attempts. Try again in ${humanizeDuration(result.retryAfterSec)}.`,
          code: "ACCOUNT_LOCKED",
          retryAfter: result.retryAfterSec,
        });
      }
      if (result.remaining <= SHOW_REMAINING_AT) {
        // Surface the count only once they're down to their last 3 attempts;
        // stay generic before that (no "attempts remaining" leak early on).
        throw new APIError("UNAUTHORIZED", {
          message: `Invalid email or password. ${result.remaining} attempt${
            result.remaining === 1 ? "" : "s"
          } remaining before a temporary lockout.`,
          code: "LOGIN_ATTEMPTS_REMAINING",
          remaining: result.remaining,
        });
      }
      // Otherwise leave Better Auth's original generic 401 in place.
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Pin every new session to the user's organization so each authenticated
        // request carries an active org for requireAuth to scope by. If the user
        // has no org yet (first session after sign-up), provision a personal one
        // here and make them its owner.
        //
        // Provisioning lives in this ONE order-independent place on purpose: a
        // user.create.after hook runs deferred relative to session creation, so
        // the membership wouldn't exist yet when this hook needs it. Doing it
        // lazily on first session is robust and idempotent (subsequent sign-ins
        // find the existing membership). This org is also the seed of the future
        // host/invite/delegate model (docs/PLANS.md).
        before: async (session, ctx) => {
          const adapter = ctx?.context.adapter;
          if (!adapter) return;

          let member = await adapter.findOne<{ organizationId: string }>({
            model: "member",
            where: [{ field: "userId", value: session.userId }],
          });

          if (!member) {
            const user = await adapter.findOne<{ email: string; name: string | null }>({
              model: "user",
              where: [{ field: "id", value: session.userId }],
            });
            const org = await adapter.create<
              { name: string; slug: string; createdAt: Date },
              { id: string }
            >({
              model: "organization",
              data: {
                name: user?.name ? `${user.name}'s workspace` : (user?.email ?? "Workspace"),
                // Slug is required + unique; a random suffix guarantees
                // uniqueness without a user-facing name collision.
                slug: `org-${randomUUID()}`,
                createdAt: new Date(),
              },
            });
            await adapter.create({
              model: "member",
              data: {
                organizationId: org.id,
                userId: session.userId,
                role: "owner",
                createdAt: new Date(),
              },
            });
            member = { organizationId: org.id };
          }

          return { data: { ...session, activeOrganizationId: member.organizationId } };
        },
      },
    },
  },
});
