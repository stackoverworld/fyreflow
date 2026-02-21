# Local Development Runbook

- Last reviewed: 2026-02-20

## Prerequisites
- Runtime/toolchain for your selected stack.
- Package manager configured for this repository.
- Git installed.

## First-Time Setup
1. Install dependencies.
2. Run baseline verification commands.
3. Start local development runtime.

## Commands
- `node scripts/check-agent-context.mjs`
- `node scripts/check-doc-freshness.mjs`
- `node scripts/check-skills.mjs`
- `npx tsc --noEmit`
- `vitest run`
- `vite build`
- `npm run test:e2e`
- Launch: `npm run dev --workspaces`

## Troubleshooting
- If checks fail, fix root cause before continuing.
- Keep docs and contracts updated with behavior changes.
- Capture recurring setup issues in this runbook.
