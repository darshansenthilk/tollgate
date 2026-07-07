import pg from "pg";
import type { DependencyHealth } from "@tollgate/shared";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://tollgate:tollgate@localhost:5432/tollgate";

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 2000,
});

pool.on("error", () => {
  /* surfaced via /health */
});

export async function checkPostgres(): Promise<DependencyHealth> {
  const start = performance.now();
  try {
    await pool.query("SELECT 1");
    return { state: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      state: "error",
      latencyMs: Math.round(performance.now() - start),
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
