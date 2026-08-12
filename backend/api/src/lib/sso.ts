import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";

/**
 * OAuth2 / OIDC single sign-on — SELF-HOSTED DEPLOYMENTS ONLY.
 *
 * WHY IT'S GATED. Tollgate's hosted service is email+password (plus opt-in
 * TOTP): anyone can sign up, and there is no external identity provider to
 * federate with. Enterprises running Tollgate on their own infrastructure are
 * the opposite case — they already have an IdP (Red Hat SSO, which is
 * Keycloak; or Okta/Entra/etc.) and a hard requirement that employees not
 * hold a separate password for an internal tool. So SSO is an addition to the
 * self-hosted build, NOT a replacement of the existing auth anywhere:
 *
 *   - Email+password stays enabled in both deployments. A self-hoster whose
 *     IdP is down must still be able to reach their own dashboard, and the
 *     very first operator has to sign in before any IdP is configured at all.
 *   - The hosted deployment never registers the plugin, so its auth surface
 *     is byte-for-byte what it was before this feature existed.
 *
 * HOW THE GATE WORKS. Two independent conditions, both required:
 *
 *   1. Self-hosted. Detected by TOLLGATE_LICENSE_KEY being set — the same
 *      signal the rest of the self-host-only surface already keys on
 *      (backend/api/src/check-license.ts refuses to boot the self-hosted
 *      image without it, and the hosted deployment never sets it). Reusing it
 *      avoids inventing a second, drift-prone "am I self-hosted?" flag.
 *      Deliberately NOT verified here: this module only asks "which build is
 *      this", and check-license.ts has already exited the process if the key
 *      is invalid. Treating an unverified key as proof of *entitlement* would
 *      be wrong; treating it as a mode indicator is exactly what it is.
 *   2. Configured. All three of SSO_ISSUER / SSO_CLIENT_ID /
 *      SSO_CLIENT_SECRET present. A self-hoster who hasn't set up an IdP
 *      shouldn't be shown a sign-in button that can only fail.
 *
 * Both must hold, so the failure modes are safe in both directions: hosted
 * never enables it even if the vars leak into its environment, and
 * self-hosted never advertises it until it can actually work.
 */

/** Stable id for this provider. Appears in the OAuth callback path the
 *  customer must register in their IdP — /api/auth/oauth2/callback/sso — so
 *  it is deliberately provider-NEUTRAL ("sso", not "keycloak"). The config
 *  below is otherwise identical to better-auth's own keycloak() helper, which
 *  is itself just standard OIDC discovery; naming it "keycloak" would make
 *  the callback URL read as a lie for a customer federating with Okta or
 *  Entra, which the same discovery flow supports unchanged. */
export const SSO_PROVIDER_ID = "sso";

/** Env is a parameter (defaulting to the real one) rather than read straight
 *  from process.env, so the gate below is testable without mutating global
 *  state — same convention as lib/prompt-retention.ts. */
export type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** Which build this is. See condition 1 above for why the license key is the
 *  signal and why its validity is check-license.ts's job, not ours. */
export function isSelfHosted(env: Env = process.env): boolean {
  return read(env, "TOLLGATE_LICENSE_KEY") !== undefined;
}

export interface SsoSettings {
  /** OIDC issuer URL, realm included for Keycloak/Red Hat SSO
   *  (e.g. https://sso.acme.com/realms/employees). */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Shown on the sign-in button, so an operator can label it with whatever
   *  their employees actually recognise ("Acme SSO", "Okta"). */
  label: string;
}

/**
 * The configured SSO settings, or null when SSO is off for this deployment —
 * either because it isn't self-hosted or because it isn't configured.
 *
 * Read per call rather than captured at module load so a deployment can be
 * reconfigured with a restart and no rebuild, matching how the vault and
 * upstream-key env fallbacks already behave.
 */
export function ssoSettings(env: Env = process.env): SsoSettings | null {
  if (!isSelfHosted(env)) return null;

  const issuer = read(env, "SSO_ISSUER");
  const clientId = read(env, "SSO_CLIENT_ID");
  const clientSecret = read(env, "SSO_CLIENT_SECRET");
  if (issuer === undefined || clientId === undefined || clientSecret === undefined) {
    return null;
  }

  return {
    issuer,
    clientId,
    clientSecret,
    label: read(env, "SSO_LABEL") ?? "SSO",
  };
}

/**
 * The genericOAuth provider config, or null when SSO is off.
 *
 * Only `discoveryUrl` is given for the endpoints: every OIDC provider serves
 * /.well-known/openid-configuration, so authorization/token/userinfo URLs are
 * fetched from the IdP itself rather than hand-configured — three fewer env
 * vars to get wrong, and they stay correct if the IdP moves an endpoint.
 */
export function ssoProviderConfig(env: Env = process.env): GenericOAuthConfig | null {
  const settings = ssoSettings(env);
  if (settings === null) return null;

  // Trailing slash stripped so the discovery URL doesn't come out with "//".
  const issuer = settings.issuer.replace(/\/+$/, "");

  return {
    providerId: SSO_PROVIDER_ID,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    // Set so the callback validates the `iss` it gets back (RFC 9207) instead
    // of trusting whatever responded — cheap defence against a mix-up attack
    // where a response from one IdP is replayed against another.
    issuer,
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    // openid is what makes this OIDC rather than bare OAuth2; profile+email
    // are what populate the Better Auth user row on first sign-in.
    scopes: ["openid", "profile", "email"],
    // Defaults to false in the plugin. Enabled because the authorization-code
    // flow without PKCE is interceptable at the redirect, and Red Hat SSO can
    // be configured to REQUIRE it — in which case its absence is a hard
    // failure at the token exchange rather than a subtle weakening.
    pkce: true,
  };
}
