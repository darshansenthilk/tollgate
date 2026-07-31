#!/bin/sh
set -e

# Self-host activation gate — Docker-image-only, see check-license.ts's doc
# comment. `set -e` means a non-zero exit from the license check (invalid/
# missing/expired key) stops here and never reaches `pnpm start`.
pnpm exec tsx src/check-license.ts

exec pnpm start
