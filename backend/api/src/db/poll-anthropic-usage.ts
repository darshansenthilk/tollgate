/**
 * CLI entrypoint for external agent governance's usage/budget poll — thin
 * wrapper around connectors/poll-anthropic-links.ts's pollAllAnthropicLinks(),
 * kept for operators who'd rather run this on their own external cron than
 * rely on the api service's own in-process interval (see index.ts's doc
 * comment on that scheduler — this script isn't needed for a normal install,
 * it's here for anyone who wants direct control over exactly when it runs):
 *   cd /path/to/tollgate/backend/api && pnpm db:poll-anthropic-usage
 */
import "../lib/env.js";
import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { pollAllAnthropicLinks } from "../connectors/poll-anthropic-links.js";

pollAllAnthropicLinks()
  .then(async ({ linksPolled, linksFailed }) => {
    console.log(`[anthropic-poll] done: ${linksPolled} link(s), ${linksFailed} failure(s)`);
    await redis.quit().catch(() => {});
    await pool.end();
    process.exit(linksFailed > 0 ? 1 : 0);
  })
  .catch(async (err: unknown) => {
    console.error("[anthropic-poll] fatal", err);
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  });
