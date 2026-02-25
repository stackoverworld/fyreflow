# Agents Dashboard (Local First)

A local-first dashboard panel for creating AI workflows/pipelines, configuring step-by-step agents, and running sequential multi-agent execution with provider routing.

## What you can do

- Create and name pipelines/workflows
- Configure each step as a dedicated bot (analysis, planner, executor/orchestrator, tester, review)
- Add an explicit `orchestrator` agent role (optional)
- Set per-step prompt, provider, model, and reasoning effort
- Enable delegation for executor/orchestrator with connected downstream agents
- Connect nodes manually on canvas and in step settings (many-to-many)
- Add conditional routes per edge: `always`, `on_pass`, `on_fail`
- Run graph-based workflows with branching and feedback loops
- Pass task, previous output, incoming outputs, and all outputs into step context templates
- Configure provider auth in UI:
  - OpenAI / Codex: API key or OAuth token mode
  - Claude: API key or OAuth token mode
  - Browser OAuth launcher for both providers via local CLI
- Select provider-specific model presets (from local `~/Downloads/codex` and `~/Downloads/claude-code`)
- Configure reasoning effort per step (`minimal`, `low`, `medium`, `high`, `xhigh`)
- Toggle Claude fast mode (extra-usage path) per step
- Toggle 1M context mode for Sonnet/Opus-compatible Claude steps (off by default)
- Configure per-agent storage policy:
  - isolated storage (private persistent folder for the step)
  - shared storage (centralized artifacts folder)
- Configure strict per-step output contracts:
  - expected output format (`markdown` or `json`)
  - required JSON fields
  - required output artifact paths
- Configure pipeline-level quality gates in a dedicated panel:
  - regex must match / must not match
  - JSON field existence checks
  - artifact existence checks
  - blocking vs advisory behavior
- Configure runtime guards per flow:
  - max loops per step
  - max total step executions
  - per-stage timeout
- Manage MCP + storage in a dedicated tab:
  - create/update/delete MCP server configs
  - set transport (`http`/`sse`/`stdio`) and connection metadata
  - configure centralized storage root/folders
  - enable MCP servers per step and execute MCP tool calls from agent output
- Use **AI Mode Builder** in Flow Settings:
  - choose provider + model + reasoning
  - describe desired workflow in plain language
  - auto-generate agents and links on the canvas
- Start runs and watch per-step execution logs/output
- Persist run trace snapshots automatically to storage:
  - `.../runs/<run-id>/state.json`
- Use Smart Run preflight:
  - infer required run inputs from flow contracts/placeholders
  - render typed run form fields (text/path/url/secret/multiline)
  - validate provider/MCP/storage readiness before run
- Use run input placeholders in step prompts/templates:
  - `{{input.source_pdf_path}}`
  - `{{input.output_dir}}`
  - `{{input.source_links}}`

## Stack

- Frontend: React + TypeScript + Vite + Tailwind
- API: Express + TypeScript
- Persistence: local JSON file (`data/local-db.json`)

## Run locally

```bash
bun install
bun run dev
```

- Web UI: `http://localhost:5173`
- API: `http://localhost:8787`

## Run as desktop app (Electron)

```bash
bun run dev:desktop
```

- Starts API (`8787`) + Vite (`5173`) + Electron together
- Renderer updates live with Vite HMR
- Electron main/preload changes auto-restart Electron

To launch the built web bundle inside Electron:

```bash
bun run build
bun run start:desktop
```

## Environment variables

- `PORT` (default `8787`)
- `FYREFLOW_RUNTIME_MODE` (`local` or `remote`, default `local`)
- `DASHBOARD_API_TOKEN` (recommended for remote deployment)
- `DASHBOARD_SECRETS_KEY` (recommended for remote deployment; keeps encrypted secrets stable across restarts)
- `CORS_ORIGINS` (comma-separated; default `http://localhost:5173,http://127.0.0.1:5173,null`)
- `FYREFLOW_ENABLE_SCHEDULER` (`true`/`false`, default `true`)
- `FYREFLOW_ENABLE_RECOVERY` (`true`/`false`, default `true`)
- `FYREFLOW_ENABLE_REALTIME_WS` (`true`/`false`, default `true`)
- `FYREFLOW_WS_PATH` (default `/api/ws`)
- `FYREFLOW_WS_RUN_POLL_INTERVAL_MS` (default `400`)
- `FYREFLOW_WS_HEARTBEAT_INTERVAL_MS` (default `15000`)
- `VITE_API_BASE_URL` (default `http://localhost:8787`)
- `VITE_DASHBOARD_API_TOKEN` (optional web default token)
- `VITE_REALTIME_WS_PATH` (default `/api/ws`)
- `UPDATER_PORT` (default `8788`)
- `UPDATER_AUTH_TOKEN` (required for `/api/updates/*`)
- `UPDATER_GITHUB_OWNER` / `UPDATER_GITHUB_REPO` (release source)
- `UPDATER_GITHUB_TOKEN` (optional, recommended for private repos/rate limits)
- `UPDATER_CHANNEL` (`stable` or `prerelease`, default `stable`)
- `UPDATER_IMAGE_REPOSITORY` (default `ghcr.io/<owner>/fyreflow-core`)
- `UPDATER_CORS_ORIGINS` (default local web origins)

## Self-host (core + one-click updater)

1. Copy `.env.selfhost.example` to `.env.selfhost` and fill tokens/owner/repo.
2. Start stack:

```bash
docker compose --env-file .env.selfhost up -d --build
```

3. Services:
- Core API: `http://localhost:8787`
- Updater API: `http://localhost:8788`
4. In dashboard open **Settings -> Updates**:
- set updater URL and updater token,
- click **Check**,
- click **Update** when a newer release is available.

## Build / checks

```bash
bun run lint
bun run typecheck
bun run build
npm run test:e2e
```

## Engineering rules

- Architecture, security, threat-modeling, and testing guardrails are defined in:
  - `docs/ENGINEERING_RULES.md`
  - `docs/SKILL_COMPLIANCE.md`
  - `security_best_practices_report.md`

## Railway deployment notes

1. Push this repository with `Dockerfile` and `railway.json` to GitHub.
2. In Railway, create a new service from this repo (Dockerfile build is auto-detected).
3. Add a volume mount to `/app/data` (required for durable state):
   - `/app/data/local-db.json`
   - `/app/data/pairing-state.json`
   - `/app/data/.secrets-key` (if `DASHBOARD_SECRETS_KEY` is not set)
4. Set Railway environment variables:
   - `FYREFLOW_RUNTIME_MODE=remote`
   - `DASHBOARD_API_TOKEN=<strong-random-token>`
   - `DASHBOARD_SECRETS_KEY=<strong-random-token>`
   - `CORS_ORIGINS=<desktop/web origins>`
   - optional: `FYREFLOW_WS_PATH=/api/ws`
5. Deploy and verify:
   - `GET https://<railway-domain>/api/health` returns `{ ok: true, realtime: { ... } }`.
6. In desktop/web UI open **Settings -> Remote** and configure:
   - mode `remote`
   - remote API URL `https://<railway-domain>`
   - API token = your `DASHBOARD_API_TOKEN` (or a claimed pairing `deviceToken`).

## Release -> auto-update pipeline

1. Publish `GitHub Release` (tag like `v1.2.3`).
2. Workflow `.github/workflows/release-docker.yml` builds and pushes:
- `ghcr.io/<owner>/fyreflow-core:1.2.3`
- `ghcr.io/<owner>/fyreflow-core:latest` (for non-prerelease releases)
3. Self-host updater checks GitHub release metadata and applies the new tag through `docker compose`.

## About Optics UI library

The project is structured with an Optics-style component layer in `src/components/optics/*` so it is easy to swap in the official Optics registry components.

If you want to pull official components directly from Optics, use their registry/installation flow from:
- `https://optics.agusmayol.com.ar/`

Example commands:

```bash
npx shadcn@latest init
npx shadcn@latest add @optics/button @optics/card @optics/input @optics/textarea @optics/select @optics/badge
```

Or directly by URL:

```bash
npx shadcn@latest add https://optics.agusmayol.com.ar/r/button.json
```

Then replace matching files under `src/components/optics/`.

## Current limitations

- OAuth is CLI-mediated:
  - OpenAI/Codex uses `codex login --device-auth` and can auto-import token from `~/.codex/auth.json`.
  - Claude uses `claude auth login`; token export is not available, so OAuth mode falls back to Claude CLI execution.
- No queue workers yet (runs execute in-process on API server).
- Credentials are currently stored in local JSON for convenience.

## Model source snapshot

Model presets are populated from local repositories:

- Codex source: `~/Downloads/codex/codex-rs/core/models.json`
- Claude source: `~/Downloads/claude-code/CHANGELOG.md` and `~/Downloads/claude-code/.github/workflows/*`

Included Codex models in UI:
- `gpt-5.3-codex`
- `gpt-5.2-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex`
- `gpt-5.2`
- `gpt-5.1`
- `gpt-5-codex`
- `gpt-5`
- `gpt-5.1-codex-mini`
- `gpt-5-codex-mini`
- `gpt-5.2-spark` (manual alias)
- `gpt-5.2-codex-sonic` (manual alias)

Included Claude models in UI:
- `claude-sonnet-4-6`
- `claude-opus-4-6`
- `claude-sonnet-4-5-20250929`
- `claude-opus-4-5-20251101`
- `claude-haiku-4-5-20251001`
- aliases: `sonnet`, `opus`, `haiku`

Default context policy:
- Claude steps default to `200000` tokens.
- `1M` context is optional per-step via the runtime toggle.

## OAuth flow in dashboard

1. Open **Provider Auth**.
2. Set provider to **OAuth** mode.
3. Click **Connect in browser**.
4. Complete login in browser.
5. For OpenAI/Codex, click **Import Codex token**.
6. Click **Save provider**.

For Claude, this is expected:
- OAuth token input does not auto-fill.
- Status should show **Connected** and **CLI ready**.
- Pipeline runs can execute through Claude CLI auth in OAuth mode.

## T13 Wave-2 Final Verification / Refactor Closeout

- `bun x tsc --noEmit` — pass (exit code 0).
- `bun x vitest run` — fail in this environment (exit code 1).
  - Error: `bun` cannot write temp files (`AccessDenied`).
  - Retry required in an environment with writable `TMPDIR`/temp permissions.
- `bun x vite build` — pass (exit code 0), Vite 6.4.1.
  - Build completes successfully; chunk-size warning is pre-existing and did not affect buildability.
- Boundary docs update: added `docs/architecture/refactor-boundaries.md` to document current and proposed module boundaries for Wave-2.

<!-- primer-ai:agent-context:start -->
## AI Agent Context (Managed by primer-ai)

## Generated By primer-ai
- Project shape: Monorepo
- Stack: React + TypeScript + Vite
- Assistant workflow target: codex

## Knowledge Architecture
- Root routing: `AGENTS.md`
- Source of truth: `docs/*`
- Scoped instructions: nested `AGENTS.md` files per directory
- Root composition: `.agents/fragments/root/*` + `node scripts/compose-agents.mjs --write`
- Codex CLI adapter: `AGENTS.md` + scoped `AGENTS.md` files.

## Quick Start
1. Install dependencies for your selected stack.
2. Run context maintenance checks:
   - `node scripts/check-agent-context.mjs`
   - `node scripts/check-doc-freshness.mjs`
   - `node scripts/check-skills.mjs`
3. Run stack verification commands:
   - `npx tsc --noEmit`
   - `vitest run`
   - `vite build`
4. Start local runtime with `npm run dev --workspaces`.

## Documentation
- `docs/index.md`
- `docs/architecture.md`
- `docs/api-contracts.md`
- `docs/conventions.md`
- `docs/maintenance.md`
- `docs/skills.md`
<!-- primer-ai:agent-context:end -->
