# API Contracts

- Last reviewed: 2026-02-26

## Contract-First Policy
- Define or update contracts before implementing integration behavior.
- Keep schema changes backward-compatible unless a migration is documented.
- Version externally consumed contracts.

## Initial Contract Surface
- GET /api/health -> { ok: boolean, now: string, version?: string, realtime?: { enabled: boolean, path: string }, updater?: { configured: boolean }, client?: { minimumDesktopVersion: string, clientVersion?: string, updateRequired: boolean, message: string, downloadUrl?: string } }
- GET /api/agents -> { items: AgentSummary[], nextCursor?: string }
- POST /api/agents (CreateAgentInput) -> Agent
- GET /api/agents/:agentId -> Agent
- PATCH /api/agents/:agentId (UpdateAgentInput) -> Agent
- POST /api/runs (CreateRunInput) -> Run
- GET /api/runs/:runId -> Run
- GET /api/runs/:runId/events -> Server-Sent Events stream of RunEvent
- GET /api/ws (WebSocket upgrade) -> realtime run/log stream protocol
- Shared exports: AgentSchema, RunSchema, ApiErrorSchema, and createApiClient(baseUrl)

## Update Service Contract (2026-02-25)
- Core API exposes `/api/updates/*` and proxies calls to updater service when configured.
- Clients call core `/api/updates/*` with regular API auth (static API token or pairing device token).
- Dedicated updater service still runs separately from core runtime (default port `8788`).
- `GET /api/updates/status` -> `{ status }` with:
- `channel`, `currentTag`, optional `currentVersion`,
- optional `latestTag`/`latestPublishedAt`,
- `updateAvailable`, `rollbackAvailable`, `busy`,
- optional `lastCheckedAt`, `lastAppliedAt`, `lastError`.
- `POST /api/updates/check` -> refresh latest release from GitHub and return `{ status }`.
- `POST /api/updates/apply` with optional `{ version }` -> update core to latest/explicit tag and return `{ status }`.
- `POST /api/updates/rollback` -> rollback to previously applied tag and return `{ status }`.
- If updater proxy is not configured on backend, core `/api/updates/*` returns `503` with a descriptive error.
- Updater service auth:
- internal core->updater calls use `FYREFLOW_UPDATER_AUTH_TOKEN` (`UPDATER_AUTH_TOKEN` fallback).
- direct updater `/api/updates/*` routes require `UPDATER_AUTH_TOKEN` via `Authorization: Bearer` or `x-api-token` header.
- `GET /health` on updater remains unauthenticated for liveness checks.

## Desktop Compatibility Contract (2026-02-26)
- Client includes desktop/web app version in `x-fyreflow-client-version` header for core API requests.
- Compatibility policy source defaults to repository file `config/desktop-compatibility.json` (backend image content).
- `FYREFLOW_MIN_DESKTOP_VERSION` / `FYREFLOW_DESKTOP_DOWNLOAD_URL` are optional operator overrides.
- `/api/health` may include `client` compatibility metadata when effective minimum desktop version is configured:
- `minimumDesktopVersion`: minimum supported desktop version on this backend.
- `clientVersion`: normalized version received from request header (if present/valid).
- `updateRequired`: `true` when client version is below required minimum or unavailable.
- `message`: user-safe compatibility summary suitable for direct UI display.
- `downloadUrl`: optional release/download URL from `FYREFLOW_DESKTOP_DOWNLOAD_URL`.
- Client bootstrap should block dashboard usage when `client.updateRequired === true`.

## File Manager Scope API (2026-02-23)
- `GET /api/files` lists files inside a storage scope owned by the selected pipeline.
- `GET /api/files/content` returns safe text preview content for a file inside the same scope.
- `GET /api/files/raw/:scope/:pipelineId/:runId/*` returns raw file bytes for scoped HTML assets (images/css/fonts/etc).
- `POST /api/files/upload` uploads a file into scoped storage using chunked base64 payloads.
- `POST /api/files/import-url` downloads a file from an external URL into scoped storage.
- Required query params:
- `pipelineId`: pipeline id in dashboard state.
- `scope`: `shared | isolated | runs`.
- `runId` is required when `scope=runs`.
- Optional query param: `path` (relative path inside scope root).
- Required query param for content endpoint: `path` (must point to a file).
- Optional query param for content endpoint: `maxBytes` (default `262144`, max `1048576`).
- Raw endpoint path rules:
- `scope`: `shared | isolated | runs`
- `pipelineId`: selected pipeline id
- `runId`: use `-` for `shared/isolated`; required real run id for `runs`
- `*`: relative file path inside scoped root
- Optional raw query param:
- `download=1` forces attachment download via `Content-Disposition`.
- `DELETE /api/files` deletes a file or folder inside the same scoped roots.
- Required body fields:
- `pipelineId`, `scope`, `path`.
- Optional body fields:
- `runId` (required when `scope=runs`), `recursive`.
- Upload body fields:
- `pipelineId`, `scope`, `destinationPath`, `uploadId`, `chunkIndex`, `totalChunks`, `totalSizeBytes`, `chunkBase64`.
- Optional upload fields:
- `runId` (required when `scope=runs`), `overwrite`.
- URL import body fields:
- `pipelineId`, `scope`, `sourceUrl`.
- Optional URL import fields:
- `runId` (required when `scope=runs`), `destinationPath`, `overwrite`.
- Scope roots are derived from storage config:
- shared: `<root>/<sharedFolder>/<pipelineId>`
- isolated: `<root>/<isolatedFolder>/<pipelineId>`
- runs: `<root>/<runsFolder>/<runId>` (only when run belongs to pipelineId)
- Security guarantees:
- Absolute paths and traversal (`..`) are rejected.
- Requests are confined to resolved scope root (real-path checked); no access to system folders or other pipelines.
- Scope root deletion is disallowed.
- Symlinks are blocked from listing/delete/content preview.
- File preview returns only text-like content; non-text files are rejected.
- Upload limits:
- max file size `25 MB`, max chunk size `512 KB`, upload sessions expire after `15 min`.
- URL import limits:
- only `http/https`, blocks localhost/private-network IP hosts, timeout `30s`, max downloaded size `25 MB`.

## Run Event Stream Contract (2026-02-22)
- `GET /api/runs/:runId/events?cursor=<number>` opens an SSE stream for run timeline updates.
- Stream event types:
- `ready`: `{ runId, cursor, status, at }`
- `log`: `{ runId, logIndex, message, status, at }`
- `status`: `{ runId, status, at }`
- `heartbeat`: `{ runId, cursor, status, at }`
- `complete`: `{ runId, status, at }`
- `error`: `{ runId, message, at }`
- `cursor` is additive/backward-compatible; omitted cursor defaults to `0`.
- Clients can reconnect using the last processed `logIndex + 1` as cursor.

## WebSocket Realtime Contract (2026-02-24)
- `GET /api/ws` upgrades to WebSocket (`FYREFLOW_WS_PATH` can override path).
- `GET /api/health` may include `realtime: { enabled: boolean, path: string }` capability metadata for clients.
- Auth matches API token policy:
- if `DASHBOARD_API_TOKEN` is set, client must provide either:
- `Authorization: Bearer`, `x-api-token`, or WS subprotocol `fyreflow-auth.<base64url(token)>` with the static API token, or
- a claimed pairing `deviceToken` in `Authorization` / `x-api-token`.
- Client messages:
- `ping`
- `subscribe_run`: `{ type: "subscribe_run", runId: string, cursor?: number }`
- `unsubscribe_run`: `{ type: "unsubscribe_run", runId: string }`
- Server messages:
- `hello`: session bootstrap metadata.
- `subscribed` / `unsubscribed`
- `run_log`: incremental log messages.
- `run_status`: status transitions.
- `run_not_found`, `heartbeat`, `pong`, `error`
- SSE `/api/runs/:runId/events` remains supported for backward compatibility during client migration.

## Pairing Contract (2026-02-24)
- `POST /api/pairing/sessions` creates a short-lived pairing session for desktop/web linking.
- Request body (optional): `{ clientName?: string, platform?: string, ttlSeconds?: number }`.
- Response: `{ session: { id, code, status, clientName, platform, label, createdAt, updatedAt, expiresAt, realtimePath } }`.
- `GET /api/pairing/sessions/:sessionId` returns current session status.
- `POST /api/pairing/sessions/:sessionId/approve` approves session with request `{ code, label? }`.
- `POST /api/pairing/sessions/:sessionId/claim` claims approved session with request `{ code }` and returns `{ session, deviceToken }`.
- `POST /api/pairing/sessions/:sessionId/cancel` cancels pending/approved sessions.
- `POST /api/pairing/sessions/:sessionId/revoke` revokes an already claimed device token for that session.
- Pairing sessions status lifecycle: `pending -> approved -> claimed` and terminal states `cancelled` / `expired`.
- Public bootstrap endpoints: `create`, `get`, `claim`.
- Admin-only pairing endpoints in `remote` runtime: `approve`, `cancel`, `revoke` require `DASHBOARD_API_TOKEN` via `Authorization: Bearer` or `x-api-token`.
- If `FYREFLOW_RUNTIME_MODE=remote` and `DASHBOARD_API_TOKEN` is missing, `approve`/`cancel`/`revoke` return `503` (`pairing_admin_token_missing`).
- After successful claim, returned `deviceToken` is accepted as an API/WS auth credential for protected routes.
- Device token TTL is `30 days`; session summary includes `deviceTokenExpiresAt` once claimed.
- Claimed pairing sessions and device tokens are persisted in backend state (`data/pairing-state.json`) and remain valid after server restarts.
- Realtime pairing updates over WebSocket:
- Client messages: `subscribe_pairing` (`{ type: "subscribe_pairing", sessionId: string }`), `unsubscribe_pairing`.
- Server messages: `pairing_subscribed`, `pairing_status`, `pairing_not_found`, `pairing_unsubscribed`.

## Provider OAuth Contract (2026-02-25)
- `GET /api/providers/:providerId/oauth/status` -> `{ status }` where status includes login source, cli availability, login state, token availability, and runtime probe details.
- `POST /api/providers/:providerId/oauth/start` -> `{ result, status }`.
- `result` fields:
- `providerId`, `command`, `message`
- optional `authUrl`: provider/device pairing URL extracted from CLI output when available.
- optional `authCode`: one-time user/device code extracted from CLI output when available.
- Client behavior should prefer `result.authUrl` for opening browser in remote mode and fall back to provider defaults only when missing.
- `POST /api/providers/:providerId/oauth/submit-code` with `{ code }` -> `{ result, status }`.
- `result` fields:
- `providerId`, `accepted`, `message`
- Intended for OAuth flows that require entering a browser-provided authorization code back into CLI (for example Claude callback code flows in remote mode).
- `POST /api/providers/:providerId/oauth/sync-token` -> `{ provider, result }` where `result` includes sync message, optional token, and latest OAuth status.

## Error Model
- Provide stable machine-readable error codes.
- Separate user-safe messages from internal diagnostics.
- Track error classes and expected remediation in tests.

## Compatibility Rules
- Additive changes are preferred over breaking changes.
- Breaking changes require explicit versioning and migration notes.
- Reflect contract updates in tests and release notes.

## Workflow Additions (2026-02-21)
- `PipelineStep` adds `scenarios: string[]` for scenario-tagged step routing.
- `PipelineStep` adds `skipIfArtifacts: string[]` for pre-execution artifact cache skip checks.
- `PipelineStep` adds `policyProfileIds: string[]` for reusable backend runtime policies (artifact contracts, skip validation, cache strategy hints).
- `PipelineStep` adds `cacheBypassInputKeys: string[]` for step-level skip-cache bypass inputs.
- `PipelineStep` adds `cacheBypassOrchestratorPromptPatterns: string[]` for orchestrator-driven cache bypass matching.
- `POST /api/pipelines/:pipelineId/runs` accepts optional `scenario` string in request body.
- `PipelineRun` includes optional `scenario` in run metadata.
- Scenario behavior is additive: when scenario is omitted, pipelines run with existing behavior.

## Scenario Profile Boundary (2026-02-22)
- Scenario-specific behavior should be expressed in pipeline configuration (`steps[*].prompt`, `steps[*].scenarios`, `qualityGates`) and flow-builder outputs.
- Runtime specialization is now profile-driven through `steps[*].policyProfileIds` and cache policy fields, not hardcoded scenario names in runner internals.
- Backend runtime remains generic for provider dispatch, retries, scheduling, pause/resume, and gate execution while allowing reusable policy profiles for domain-specific artifact contracts.

## AI Builder Additions (2026-02-21)
- `POST /api/flow-builder/generate` response adds optional `questions` for clarification-first chat turns.
- `questions` shape: `[{ id, question, options: [{ label, value, description? }] }]`.
- Clarification is additive and backward-compatible: `action` remains `answer | update_current_flow | replace_flow`.
- When `questions` are present, clients may offer one-click replies by sending `options[].value` as the next user message.
- `POST /api/flow-builder/generate` accepts `prompt` up to `64_000` chars.
- `POST /api/flow-builder/generate` accepts each `history[*].content` up to `64_000` chars.
- `POST /api/flow-builder/generate` request history accepts larger transcripts (`history` up to 240 messages), and server-side prompt assembly compacts older turns into a summary block when context budget is exceeded.
- Server-side chat planner assembly now keeps up to `120_000` chars of combined history before compaction.
- `POST /api/flow-builder/generate` accepts optional `requestId` (`string`, max 120 chars) for idempotent retries.
- When `requestId` repeats with the same request payload, server returns or awaits the same generation result instead of re-running provider work.
- Reusing the same `requestId` with a different payload is rejected with `409`.

## Subagent Execution Semantics (2026-02-21)
- `PipelineStep.enableDelegation` and `PipelineStep.delegationCount` drive real runtime parallelism in the run executor.
- When at least one step has delegation enabled, ready steps can run concurrently using worker slots, capped by the maximum configured `delegationCount` (clamped to `1..8`).
- Step outputs still merge into one run timeline/log stream and route through existing links and quality gates.

## Runtime Timeout Bounds (2026-02-22)
- `runtime.stageTimeoutMs` accepts `10_000..18_000_000` ms (10 seconds to 5 hours) for both pipeline create/update and flow-builder generated drafts.
- Runtime normalization now preserves long budgets up to 5 hours instead of clamping at 20 minutes.
- Claude heavy roles (`analysis`, `planner`, `executor`, `review`, `tester`, high-effort/large-context) automatically receive expanded effective stage budgets to reduce premature timeout kills.

## Runtime Guardrails (2026-02-22)
- Blocking quality-gate failures now route only through `on_fail` links; `always` links are suppressed for that failed step.
- If a step fails blocking gates and has no `on_fail` route, the run is failed immediately instead of continuing through disconnected fallback.
- Shared structural artifacts are immutable for downstream non-owner steps: `ui-kit.json`, `dev-code.json`, `assets-manifest.json`, `frame-map.json`, `pdf-content.json`.

## Run Trace Additions (2026-02-22)
- `PipelineRun.steps[*]` adds optional `triggeredByReason` to explain how the step was enqueued.
- Allowed values: `entry_step`, `cycle_bootstrap`, `route`, `skip_if_artifacts`, `disconnected_fallback`.
- This is additive and intended for deterministic UI transition rendering and post-run debugging.

## GateResult Strictness (2026-02-22)
- `review`/`tester` steps and delivery-style steps now require strict JSON `GateResult` contract emission for step-contract pass.
- Legacy text markers (for example `WORKFLOW_STATUS: PASS`) remain parseable for diagnostics but no longer satisfy strict contract validation on those steps.

## Gate Reliability Updates (2026-02-23)
- Runtime regex quality gates are evaluated by default; set `FYREFLOW_ENABLE_LEGACY_REGEX_GATES=0` to disable legacy regex evaluation for diagnostic isolation.
- `json_field_exists` gates now evaluate `jsonPath` against `artifactPath` JSON when `artifactPath` is set; otherwise they continue to evaluate against step output JSON.
- `workflow_status: "COMPLETE"` now requires explicit metadata in strict GateResult JSON:
- `stage: "final"`
- `step_role: "delivery"`
- `gate_target: "delivery"`
- Runtime enforces that `COMPLETE` can only pass on a terminal `executor` step (no outgoing links), preventing premature delivery completion on intermediate stages.

## Runtime Hardening Updates (2026-02-24)
- Run-input summaries now redact sensitive values (`token`, `secret`, `password`, `credential`, `api_key`, and `*_key`) before prompt/context composition.
- Persisted step `inputContext` is redacted before writing run state, reducing secret exposure in local run history storage.
- OpenAI API JSON-mode steps now attach provider-level `response_format` contracts; gate-result JSON uses strict `json_schema`.
- Claude API JSON-mode gate-result steps now attach provider-level `output_config.format` JSON schema contract.
- API-path MCP routing now uses provider-native tool calls (`mcp_call`) for OpenAI and Claude, with strict schema on tool inputs and server-id allowlisting from step config.
- MCP call extraction now accepts only strict top-level JSON payloads (no fenced/prose/partial-object salvage), reducing accidental tool dispatch from free-form text.
- Delivery completion gates are no longer auto-retargeted at runtime; misconfigured gates now fail the run early and require explicit `targetStepId` pointing to the terminal delivery step.
- Flow-builder quality-gate mapping no longer silently retargets unresolved delivery completion gate targets; unresolved targets stay `any_step` and are rejected by runtime validation.
- Relative artifact templates may still use `output_dir`, but resolution is now confined to the run storage root to prevent path escape outside pipeline storage.
- Provider SSE readers now enforce idle timeout via `LLM_STREAM_IDLE_TIMEOUT_MS` (default 90s, min 1s, max 10m) and fail stalled streams deterministically.
- Claude CLI dangerous permission bypass is now opt-in (`CLAUDE_CLI_SKIP_PERMISSIONS` defaults to `0`).
