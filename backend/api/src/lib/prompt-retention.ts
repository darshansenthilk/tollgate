/**
 * Pure logic behind db/purge-old-prompts.ts — split out so the date math is
 * testable without a live database, the same way login-throttle.ts's ladder
 * math is tested separately from anything that touches Redis.
 *
 * Exists because spend_events.prompt persists real request content
 * indefinitely once written (see that column's doc comment in db/schema.ts)
 * — this is the other half of that tradeoff: a way to bound how long it
 * persists. NULLs the column rather than deleting the row: the row itself
 * (cost, decision, tokens, timestamp) is the audit trail the activity log and
 * suggestions detector both read; only the prompt TEXT is the sensitive part
 * with a shelf life.
 */

/** ~3 months. Long enough that "what did this agent send last week" (the
 *  activity log's actual use case) still works; short enough that customer
 *  data doesn't accumulate forever by default on a knob nobody touched. */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * Reads PROMPT_RETENTION_DAYS, falling back to the default for anything that
 * isn't a positive integer — a typo'd env var should degrade to "keep the
 * safe default", not silently retain forever (0/negative) or crash the script.
 */
export function resolveRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["PROMPT_RETENTION_DAYS"];
  if (raw === undefined) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

/** Rows with created_at strictly before this are past their retention window. */
export function cutoffDate(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
