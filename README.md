# FyreFlow

FyreFlow is a local-first dashboard for building AI workflows/pipelines, configuring step-by-step agents, and running sequential multi-agent execution with provider routing.

You can run FyreFlow in two modes:
- `local`: UI + engine on the same machine.
- `remote`: UI local/desktop, engine on a remote server.

Remote deployment guide: `docs/runbooks/remote-engine-deploy.md`.

## Fast Path For End Users (Railway, No CLI)

This is the simplest flow for your users.

1. Push this repository to GitHub.
2. In Railway: `New Project` -> `Deploy from GitHub Repo` -> select this repo.
3. Railway builds from root `Dockerfile` automatically.
4. In Railway service, set variables:
   - `FYREFLOW_RUNTIME_MODE=remote`
   - `DASHBOARD_API_TOKEN=<strong-random-token>`
   - `DASHBOARD_SECRETS_KEY=<strong-random-token>`
   - `CORS_ORIGINS=<allowed desktop/web origins>`
5. Add a volume mounted to `/app/data`.
6. Enable GitHub auto-deploy for your branch (usually `main`).
7. Generate a public domain for the service.

After this, backend is online and users can connect from desktop app.

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
- `FYREFLOW_UPDATER_BASE_URL` (optional; enable backend-managed updates via updater service)
- `FYREFLOW_UPDATER_AUTH_TOKEN` (optional; token core uses to call updater service)
- `FYREFLOW_UPDATER_TIMEOUT_MS` (default `15000`)
- `FYREFLOW_MIN_DESKTOP_VERSION` (optional; when set, backend reports client compatibility and can require desktop upgrade)
- `FYREFLOW_DESKTOP_DOWNLOAD_URL` (optional; download/release URL shown to outdated desktop clients)
- `FYREFLOW_DESKTOP_UPDATE_FEED_URL` (optional; Electron auto-update feed URL used by desktop app on startup)
- `FYREFLOW_DESKTOP_UPDATE_CHECK_INTERVAL_MS` (default `3600000`; desktop auto-update check interval)
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

## How Users Connect Desktop App

1. Open desktop app -> `Settings -> Remote`.
2. Set mode: `remote`.
3. Set API URL: `https://<your-railway-domain>`.
4. Set API token: same value as `DASHBOARD_API_TOKEN`.
5. Click `Save Connection` and `Validate`.

After that, app UI is local, engine runs remotely on Railway.

## Desktop App Auto-Update + Compatibility Gate

- Desktop app now supports startup auto-update checks when `FYREFLOW_DESKTOP_UPDATE_FEED_URL` is configured.
- Desktop app checks for updates at startup and then on interval (`FYREFLOW_DESKTOP_UPDATE_CHECK_INTERVAL_MS`).
- To prevent backend/frontend drift, set `FYREFLOW_MIN_DESKTOP_VERSION` on backend:
- if connected desktop version is lower than required, app bootstrap is blocked and user is prompted to update.
- set `FYREFLOW_DESKTOP_DOWNLOAD_URL` so blocked clients get a direct download link.

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

## How Updates Work On Railway

- Railway path: your users get updates from GitHub auto-deploy.
- You push/merge to deployment branch (`main`) -> Railway rebuilds and redeploys.
- No updater token input is required for users in this flow.
- `Settings -> Updates` is intended for self-host stacks that run a dedicated updater service.
- Railway `Image Auto Updates` applies to services created from a Docker image registry; for GitHub-repo deploys use GitHub auto-deploy.

## Advanced: Self-Host With Updater Service (One-Click In App)

Use this only if you host with Docker/VPS and want in-app `Check/Update/Rollback`.

1. Copy `.env.selfhost.example` to `.env.selfhost` and fill values.
2. Start stack:

```bash
docker compose --env-file .env.selfhost up -d --build
```

3. Services:
- Core API: `http://localhost:8787`
- Updater API: `http://localhost:8788`
4. In app `Settings -> Updates`:
- click `Check`,
- click `Update` when new release is available.

## Advanced: Release Image Pipeline For Self-Host

1. Publish `GitHub Release` (for example `v1.2.3`).
2. Workflow `.github/workflows/release-docker.yml` builds and pushes:
- `ghcr.io/<owner>/fyreflow-core:1.2.3`
- `ghcr.io/<owner>/fyreflow-core:latest` (for non-prerelease releases)
3. Self-host updater reads GitHub release metadata and applies updates via Docker Compose.

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

Remote mode note:
- The dashboard opens the provider pairing/login URL returned by backend OAuth start (when available), with provider-homepage fallback.
- OAuth CLI login runs on the remote engine host (backend), not on your local desktop. If `CLI unavailable` or `not installed` appears, install CLI on backend and/or set `CODEX_CLI_PATH` / `CLAUDE_CLI_PATH`.
- If status remains pending, run the shown CLI command (`codex login --device-auth` or `claude auth login`) directly on the remote server terminal.

For Claude, this is expected:
- OAuth token input does not auto-fill.
- Status should show **Connected** and **CLI ready**.
- Pipeline runs can execute through Claude CLI auth in OAuth mode.

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
