/**
 * Self-host-only activation gate. Run by backend/proxy/docker-entrypoint.sh
 * BEFORE `pnpm start` — never imported by index.ts itself, so the hosted
 * deployment (which runs `pnpm start` directly, no Docker, no entrypoint
 * script) never executes this and never needs a license key. See
 * backend/shared/src/license.ts's doc comment for the full design.
 */
import { checkLicenseOrExit } from "@tollgate/shared/license";

checkLicenseOrExit();
