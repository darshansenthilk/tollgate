"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";

/**
 * Better Auth client. The auth server is the api (backend/api is the auth
 * authority), so baseURL points at the api origin — the client appends
 * /api/auth. credentials:"include" so the session cookie travels with every
 * request (dashboard :3000 -> api :4000, same site). The organization plugin
 * client mirrors the server plugin.
 *
 * twoFactorClient (Layer 2, PLAN.md) deliberately omits `onTwoFactorRedirect`
 * / `twoFactorPage` — auth-form.tsx handles a `{ twoFactorRedirect: true }`
 * sign-in response inline (no page reload) by reading the result it already
 * gets back from `signIn.email`, so the plugin's own redirect hook would be
 * redundant.
 *
 * genericOAuthClient is registered UNCONDITIONALLY even though SSO is
 * self-host-only (backend/api/src/lib/sso.ts). It only teaches this client
 * how to *call* /sign-in/oauth2; whether that endpoint exists at all is the
 * server's decision, and on the hosted deployment it doesn't — the plugin
 * isn't registered there, so the route 404s and nothing in the UI ever offers
 * it (auth-form.tsx renders the button only when the api's
 * /v1/auth/capabilities says SSO is on). Making the client conditional would
 * mean a build-time flag, which is exactly what one published dashboard image
 * can't have.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  fetchOptions: { credentials: "include" },
  plugins: [organizationClient(), twoFactorClient(), genericOAuthClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
