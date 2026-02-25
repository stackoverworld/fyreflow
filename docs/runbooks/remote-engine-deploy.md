# Remote Engine Deploy Runbook

- Last reviewed: 2026-02-25

This runbook is for cases where UI stays local/desktop and the FyreFlow engine runs on a remote server.

## Option A: Railway (managed deploy from GitHub)

1. Push this repository to GitHub (your own repo/fork is fine).
2. In Railway, create a service from that GitHub repo.
3. Railway uses root `Dockerfile` and starts only backend engine (`npm run start:api`).
4. Add a persistent volume mounted to `/app/data`.
5. Set required env vars:
   - `FYREFLOW_RUNTIME_MODE=remote`
   - `DASHBOARD_API_TOKEN=<strong-random-token>`
   - `DASHBOARD_SECRETS_KEY=<strong-random-token>`
   - `CORS_ORIGINS=<allowed desktop/web origins>`
6. Deploy and verify:
   - `GET https://<railway-domain>/api/health`
   - `GET https://<railway-domain>/api/health` should include realtime metadata when WS is enabled.
7. In desktop/web app -> `Settings -> Remote`:
   - mode: `remote`
   - API URL: `https://<railway-domain>`
   - API token: value from `DASHBOARD_API_TOKEN` (or pairing `deviceToken`)
   - note: pairing `approve/cancel` in remote mode requires admin token (`DASHBOARD_API_TOKEN`); `create/claim` stay bootstrap-friendly.

## Option B: Any Docker host (self-host with updater)

1. Copy `.env.selfhost.example` to `.env.selfhost`.
2. Fill required values:
   - `FYREFLOW_CORE_IMAGE_REPOSITORY`
   - `FYREFLOW_VERSION`
   - `DASHBOARD_API_TOKEN`
   - `DASHBOARD_SECRETS_KEY`
   - `FYREFLOW_UPDATER_BASE_URL` (usually `http://updater:8788` in compose)
   - `FYREFLOW_UPDATER_AUTH_TOKEN`
   - `UPDATER_AUTH_TOKEN`
   - `UPDATER_GITHUB_OWNER`
   - `UPDATER_GITHUB_REPO`
   - `UPDATER_IMAGE_REPOSITORY`
3. Start services:
   - `docker compose --env-file .env.selfhost up -d --build`
4. Verify:
   - core health: `http://<host>:8787/api/health`
   - updater health: `http://<host>:8788/health`
5. In app -> `Settings -> Updates`:
   - click `Check`, then `Update`
   - app talks to backend `/api/updates/*`; no separate updater token input in UI

## How updates are delivered

1. You publish a GitHub Release (for example `v1.2.3`).
2. Workflow `.github/workflows/release-docker.yml` builds and pushes `ghcr.io/<owner>/fyreflow-core:<tag>`.
3. Self-hosted users click `Check` and then `Update` in the app to pull and apply that tag.
4. Railway users update by redeploying latest commit/release from GitHub in Railway.

## Important notes

- Repository is monolith, but remote engine deployment runs only backend process from `Dockerfile`.
- Frontend source files inside repo do not start a separate frontend service on Railway.
- For production, use strong random tokens and restricted `CORS_ORIGINS`.
- Provider OAuth in `remote` mode opens the pairing/login URL returned by backend OAuth start (fallbacks to provider login page), but CLI auth still runs on the remote host. If login stays pending, run the UI-shown CLI command on the server terminal.
- If provider status shows `CLI unavailable`, install provider CLI on the backend host and set `CODEX_CLI_PATH` / `CLAUDE_CLI_PATH` env vars when binaries are outside `PATH`.
