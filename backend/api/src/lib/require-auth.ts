import type { FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";

/**
 * Set by requireAuth once a request passes the gate. Downstream agent-route
 * handlers read these instead of trusting anything client-supplied — org
 * scoping (and therefore cross-account isolation) hangs off activeOrgId.
 */
declare module "fastify" {
  interface FastifyRequest {
    authUser?: { id: string; email: string };
    activeOrgId?: string;
  }
}

/**
 * Deny-by-default auth gate for the management plane. Resolves the Better Auth
 * session from the request cookies:
 *  - no / invalid session            -> 401 unauthenticated
 *  - authenticated but no active org -> 403 no_active_organization (nothing to
 *    scope to; shouldn't happen once sign-up provisions an org, but fail closed)
 *  - otherwise stamps req.authUser + req.activeOrgId and lets the handler run.
 *
 * Attached as a preHandler on the encapsulated /v1/* scope in index.ts, so it
 * runs before every agent route but not on /health or /api/auth/*.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

  if (result === null) {
    reply.code(401).send({ error: "unauthenticated" });
    return;
  }

  // activeOrganizationId is added to the session by the organization plugin and
  // pinned in auth.ts's session.create hook. Read defensively in case a session
  // predates that hook.
  const activeOrgId =
    (result.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;

  if (activeOrgId === null) {
    reply.code(403).send({ error: "no_active_organization" });
    return;
  }

  // TOTP (Layer 2) is opt-in (PLAN.md §6, revised 2026-07-26): unlike the
  // session/org checks above, twoFactorEnabled is not gated here. An account
  // that never enrolled (or disabled it later) authenticates on password
  // alone — Better Auth's own sign-in hook is what enforces the second factor
  // for accounts that *do* have it enabled (a correct password alone won't
  // resolve a session for them; see the twoFactor plugin).
  req.authUser = { id: result.user.id, email: result.user.email };
  req.activeOrgId = activeOrgId;
}
