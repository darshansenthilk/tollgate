import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { pool } from "./db.js";

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
