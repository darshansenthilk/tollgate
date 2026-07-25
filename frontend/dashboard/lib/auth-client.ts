"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

/**
 * Better Auth client. The auth server is the api (backend/api is the auth
 * authority), so baseURL points at the api origin — the client appends
 * /api/auth. credentials:"include" so the session cookie travels with every
 * request (dashboard :3000 -> api :4000, same site). The organization plugin
 * client mirrors the server plugin.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  fetchOptions: { credentials: "include" },
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
