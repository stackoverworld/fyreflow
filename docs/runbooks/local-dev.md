# Local Development Runbook

- Last reviewed: 2026-02-25

## Prerequisites
- Node.js 20+ and Bun installed.
- Git installed.

## First-Time Setup
1. Install dependencies: `bun install`.
2. Run baseline checks (below).
3. Start local runtime (`bun run dev`) or desktop runtime (`bun run dev:desktop`).
4. If you need update-flow testing, run updater in a second terminal (`bun run dev:updater`) and set `FYREFLOW_UPDATER_BASE_URL`.

## Commands
- `node scripts/check-agent-context.mjs`
- `node scripts/check-doc-freshness.mjs`
- `node scripts/check-skills.mjs`
- `npx tsc --noEmit`
- `vitest run`
- `vite build`
- `npm run test:e2e`
- Launch web + API: `bun run dev`
- Launch desktop app: `bun run dev:desktop`
- Launch updater service: `bun run dev:updater`

## Troubleshooting
- If checks fail, fix root cause before continuing.
- Keep docs and contracts updated with behavior changes.
- Capture recurring setup issues in this runbook.
