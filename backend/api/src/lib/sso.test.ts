import { test } from "node:test";
import assert from "node:assert/strict";
import { isSelfHosted, ssoProviderConfig, ssoSettings, SSO_PROVIDER_ID } from "./sso.js";

/**
 * The gate these tests pin is a security boundary, not a preference: SSO must
 * never activate on the hosted deployment, and must never half-activate on a
 * self-hosted one. Both directions are asserted, because either failure is
 * bad in a different way — the first federates Tollgate's own multi-tenant
 * service to one customer's IdP, the second offers a sign-in button that
 * can't work.
 */

/** A fully-configured self-hosted environment. */
const SELF_HOSTED: Record<string, string> = {
  TOLLGATE_LICENSE_KEY: "some.licensekey",
  SSO_ISSUER: "https://sso.acme.com/realms/employees",
  SSO_CLIENT_ID: "tollgate",
  SSO_CLIENT_SECRET: "shhh",
};

test("isSelfHosted: keyed on the license key, which only the self-hosted build sets", () => {
  assert.equal(isSelfHosted({ TOLLGATE_LICENSE_KEY: "abc" }), true);
  assert.equal(isSelfHosted({}), false);
  // Whitespace-only is the shape a half-filled .env leaves behind; it must
  // not read as "self-hosted".
  assert.equal(isSelfHosted({ TOLLGATE_LICENSE_KEY: "   " }), false);
});

test("hosted deployment never enables SSO, even if the config vars are present", () => {
  // The critical one. If these vars ever leaked into the hosted service's
  // environment, SSO must stay off — the license key is what says "this is a
  // customer's own install", and the hosted deployment never has one.
  const hostedButConfigured = { ...SELF_HOSTED };
  delete (hostedButConfigured as Record<string, string | undefined>).TOLLGATE_LICENSE_KEY;

  assert.equal(ssoSettings(hostedButConfigured), null);
  assert.equal(ssoProviderConfig(hostedButConfigured), null);
});

test("self-hosted but unconfigured stays off rather than half-enabled", () => {
  // A sign-in button that can only fail is worse than no button, so every
  // required field must be present before SSO is advertised at all.
  for (const missing of ["SSO_ISSUER", "SSO_CLIENT_ID", "SSO_CLIENT_SECRET"]) {
    const env: Record<string, string | undefined> = { ...SELF_HOSTED };
    delete env[missing];
    assert.equal(ssoSettings(env), null, `expected null when ${missing} is unset`);
  }
  // Bare self-hosted install, no IdP configured at all.
  assert.equal(ssoSettings({ TOLLGATE_LICENSE_KEY: "abc" }), null);
});

test("self-hosted and configured yields settings, with a default label", () => {
  const settings = ssoSettings(SELF_HOSTED);
  assert.ok(settings !== null);
  assert.equal(settings.issuer, "https://sso.acme.com/realms/employees");
  assert.equal(settings.clientId, "tollgate");
  assert.equal(settings.label, "SSO");

  assert.equal(ssoSettings({ ...SELF_HOSTED, SSO_LABEL: "Acme SSO" })?.label, "Acme SSO");
});

test("provider config points discovery at the IdP and enables PKCE + issuer validation", () => {
  const config = ssoProviderConfig(SELF_HOSTED);
  assert.ok(config !== null);

  assert.equal(config.providerId, SSO_PROVIDER_ID);
  assert.equal(
    config.discoveryUrl,
    "https://sso.acme.com/realms/employees/.well-known/openid-configuration",
  );
  // Set so the callback can verify the `iss` it gets back (RFC 9207).
  assert.equal(config.issuer, "https://sso.acme.com/realms/employees");
  // Not the plugin default — see sso.ts for why it's forced on.
  assert.equal(config.pkce, true);
  assert.deepEqual(config.scopes, ["openid", "profile", "email"]);
});

test("a trailing slash on the issuer doesn't produce a double-slashed discovery URL", () => {
  // Operators paste issuer URLs from a Keycloak admin console, which shows
  // them with and without the trailing slash depending on where you copy from.
  const config = ssoProviderConfig({
    ...SELF_HOSTED,
    SSO_ISSUER: "https://sso.acme.com/realms/employees/",
  });
  assert.equal(
    config?.discoveryUrl,
    "https://sso.acme.com/realms/employees/.well-known/openid-configuration",
  );
  assert.equal(config?.issuer, "https://sso.acme.com/realms/employees");
});
