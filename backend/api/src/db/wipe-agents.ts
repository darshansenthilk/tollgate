/**
 * ONE-TIME rollout script for the Dashboard Expansion reset — see
 * docs/COMPLETION.md's 2026-08-02 entry (this was planned in root PLAN.md,
 * which was retired 2026-08-03). The user authorized
 * deleting every agent and its spend history across every org: "wipe them for
 * all accounts, like they have never made one in the first place". There is no
 * soft-delete, backup, or undo — the pre-wipe counts logged below are the only
 * record of what existed.
 *
 * Must NOT be wired into runMigrations(): that replays on every boot and is for
 * schema, not a one-time data reset. Run it by hand, once, at rollout.
 */
import "../lib/env.js";
import { count } from "drizzle-orm";
import { pool } from "../lib/db.js";
import { db } from "./client.js";
import { agents, spendEvents } from "./schema.js";

const CONFIRM_FLAG = "--yes-wipe-all-agents";

async function wipeAgents(): Promise<void> {
  // Emitted before anything is deleted — see the doc comment: this is the record.
  const perOrg = await db
    .select({ orgId: agents.orgId, agentCount: count() })
    .from(agents)
    .groupBy(agents.orgId)
    .orderBy(agents.orgId);
  const [agentTotal] = await db.select({ value: count() }).from(agents);
  const [spendTotal] = await db.select({ value: count() }).from(spendEvents);

  console.log("pre-wipe snapshot:");
  if (perOrg.length === 0) {
    console.log("  (no agents in any org)");
  }
  for (const row of perOrg) {
    console.log(`  org ${row.orgId}: ${row.agentCount} agents`);
  }
  console.log(`  total agents: ${agentTotal?.value ?? 0}`);
  console.log(`  total spend_events: ${spendTotal?.value ?? 0}`);

  // Global on purpose — no org filter. spend_events.agent_id FKs to agents.id,
  // so the dependent rows have to go first or the delete trips the constraint.
  // policies and org_upstream_keys are deliberately left alone: orphaned policy
  // rows are harmless (nothing ever re-attaches to them), and BYOK keys are
  // org-level config, not agent state.
  const deleted = await db.transaction(async (tx) => {
    const spendResult = await tx.delete(spendEvents);
    const agentsResult = await tx.delete(agents);
    return {
      spendEvents: spendResult.rowCount ?? 0,
      agents: agentsResult.rowCount ?? 0,
    };
  });

  console.log(
    `wiped: ${deleted.spendEvents} spend_events, ${deleted.agents} agents`,
  );
}

if (!process.argv.slice(2).includes(CONFIRM_FLAG)) {
  console.error(
    `refusing to run: this permanently deletes every agent and spend event in every org. Re-run with ${CONFIRM_FLAG} if that is what you want.`,
  );
  process.exit(1);
}

wipeAgents()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("agent wipe failed", err);
    process.exit(1);
  });
