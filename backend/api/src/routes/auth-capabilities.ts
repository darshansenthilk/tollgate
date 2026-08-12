import type { FastifyInstance } from "fastify";
import { SSO_PROVIDER_ID, ssoSettings } from "../lib/sso.js";

/**
 * What sign-in methods this deployment actually offers.
 *
 * PUBLIC AND UNAUTHENTICATED BY NECESSITY: the sign-in page is the caller,
 * and it has no session yet by definition. Registered outside index.ts's
 * requireAuth scope for that reason, alongside the install-wizard routes.
 *
 * Why the dashboard can't just read an env var: SSO is self-host-only
 * (lib/sso.ts), and whether it's on is decided by the API's runtime
 * environment — which the browser bundle can't see. NEXT_PUBLIC_* values are
 * inlined at BUILD time (see frontend/dashboard/docker-entrypoint.sh for the
 * sentinel-substitution workaround that exists precisely because of this), so
 * one published dashboard image can't carry a per-customer answer. Asking the
 * API at page load is the only way one image serves both a self-hoster with
 * SSO and one without.
 *
 * Deliberately returns NO secret. The client id is omitted too — it isn't
 * strictly confidential in an authorization-code flow, but the browser never
 * needs it (Better Auth builds the authorize URL server-side), and an
 * unauthenticated endpoint should hand out the minimum that makes the UI
 * correct: whether to show the button, and what to call it.
 */
export function registerAuthCapabilityRoutes(app: FastifyInstance): void {
  app.get("/v1/auth/capabilities", async () => {
    const sso = ssoSettings();

    return {
      // Always true — email+password is never disabled, in either build. Sent
      // explicitly so the sign-in page renders from one source of truth
      // rather than assuming a default the server might later change.
      emailPassword: true,
      sso:
        sso === null
          ? { enabled: false }
          : { enabled: true, providerId: SSO_PROVIDER_ID, label: sso.label },
    };
  });
}
