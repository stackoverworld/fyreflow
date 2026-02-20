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
  - `{{input.figma_links}}`

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

## Environment variables (optional)

- `PORT` (default `8787`)
- `VITE_API_BASE_URL` (default `http://localhost:8787`)
- `CORS_ORIGINS` (comma-separated; default `http://localhost:5173,http://127.0.0.1:5173,null`)

## Build / checks

```bash
bun run lint
bun run typecheck
bun run build
```

## Engineering rules

- Architecture, security, threat-modeling, and testing guardrails are defined in:
  - `docs/ENGINEERING_RULES.md`
  - `docs/SKILL_COMPLIANCE.md`
  - `security_best_practices_report.md`

## Railway deployment notes

1. Set `PORT` in Railway environment.
2. Run API + web behind Railway service (or split services).
3. Persist `data/local-db.json` with a mounted volume if you need durable storage.
4. For production, move secrets to server-side env vault and avoid storing raw credentials in JSON.

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
