import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/**
 * Plain `dotenv/config` only looks for `.env` in process.cwd(), which pnpm
 * sets to this package's directory when run via `pnpm --filter`/`--parallel`,
 * not the monorepo root where the shared .env actually lives. Walk up from
 * this file's own location (not cwd) until we find one, so env vars load
 * correctly regardless of how this service is invoked.
 */
let dir = path.dirname(fileURLToPath(import.meta.url));
for (let i = 0; i < 6; i++) {
  const candidate = path.join(dir, ".env");
  if (existsSync(candidate)) {
    config({ path: candidate });
    break;
  }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
