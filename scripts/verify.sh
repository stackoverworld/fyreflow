#!/usr/bin/env bash
set -euo pipefail

node scripts/check-agent-context.mjs
node scripts/check-doc-freshness.mjs
node scripts/check-skills.mjs
node scripts/check-test-baseline.mjs
npx tsc --noEmit
vitest run
vite build
playwright test
