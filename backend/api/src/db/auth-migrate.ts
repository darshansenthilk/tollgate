import { getMigrations } from "better-auth/db/migration";
import { auth } from "../lib/auth.js";

/**
 * Applies Better Auth's own schema — user / session / account / verification,
 * plus the organization plugin's organization / member / invitation — to
 * Postgres via Better Auth's built-in adapter migrator.
 *
 * Better Auth owns these tables; the app's own tables (agents / policies /
 * spend_events) stay under drizzle-kit (db/migrate.ts). getMigrations only
 * creates what's missing and adds missing columns, so this is idempotent and
 * safe to run on every boot (index.ts calls it right after the drizzle
 * migrations). There is also a `db:auth-migrate` package script for running it
 * on its own.
 */
export async function runAuthMigrations(): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
