import "../lib/env.js";
import { runAuthMigrations } from "./auth-migrate.js";

runAuthMigrations()
  .then(() => {
    console.log("better-auth migrations applied");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("better-auth migration failed", err);
    process.exit(1);
  });
