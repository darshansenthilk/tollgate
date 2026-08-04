/**
 * Retention job for spend_events.prompt — see lib/prompt-retention.ts for the
 * reasoning and the tested date math this only wires up to a real UPDATE.
 *
 * Run by hand, or on a schedule (a self-hoster's own cron, or `docker compose
 * exec api node --import tsx src/db/purge-old-prompts.js` from outside) — NOT
 * wired into runMigrations(): that replays on every boot, and nulling out
 * rows is a recurring maintenance job, not a schema change.
 *
 * NULLs the prompt column rather than deleting the row: the row itself (cost,
 * decision, tokens, timestamp) stays for the activity log and suggestions
 * detector's own retention needs — only the request TEXT has a shelf life.
 */
import "../lib/env.js";
import { and, isNotNull, lt } from "drizzle-orm";
import { pool } from "../lib/db.js";
import { resolveRetentionDays, cutoffDate } from "../lib/prompt-retention.js";
import { db } from "./client.js";
import { spendEvents } from "./schema.js";

async function purgeOldPrompts(): Promise<{ retentionDays: number; purged: number }> {
  const retentionDays = resolveRetentionDays();
  const cutoff = cutoffDate(retentionDays, new Date());

  const result = await db
    .update(spendEvents)
    .set({ prompt: null })
    .where(and(isNotNull(spendEvents.prompt), lt(spendEvents.createdAt, cutoff)));

  return { retentionDays, purged: result.rowCount ?? 0 };
}

purgeOldPrompts()
  .then(async ({ retentionDays, purged }) => {
    console.log(`purged prompt text from ${purged} spend_events row(s) older than ${retentionDays}d`);
    await pool.end();
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("prompt purge failed", err);
    process.exit(1);
  });
