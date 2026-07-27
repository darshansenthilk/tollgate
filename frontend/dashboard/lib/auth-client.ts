"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";

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
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  fetchOptions: { credentials: "include" },
  plugins: [organizationClient(), twoFactorClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
