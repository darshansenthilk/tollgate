import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// db/migrate.ts compiles/runs from src/db — drizzle/ lives at the api package root.
const MIGRATIONS_FOLDER = path.join(__dirname, "../../drizzle");

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
