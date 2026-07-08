import "../lib/env.js";
import { runMigrations } from "./migrate.js";

runMigrations()
  .then(() => {
    console.log("migrations applied");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("migration failed", err);
    process.exit(1);
  });
