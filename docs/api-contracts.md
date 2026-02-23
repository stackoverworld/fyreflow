# API Contracts

- Last reviewed: 2026-02-23

## Contract-First Policy
- Define or update contracts before implementing integration behavior.
- Keep schema changes backward-compatible unless a migration is documented.
- Version externally consumed contracts.

## Initial Contract Surface
- GET /api/health -> { status: "ok", version: string }
- GET /api/agents -> { items: AgentSummary[], nextCursor?: string }
- POST /api/agents (CreateAgentInput) -> Agent
- GET /api/agents/:agentId -> Agent
- PATCH /api/agents/:agentId (UpdateAgentInput) -> Agent
- POST /api/runs (CreateRunInput) -> Run
- GET /api/runs/:runId -> Run
- GET /api/runs/:runId/events -> Server-Sent Events stream of RunEvent
- Shared exports: AgentSchema, RunSchema, ApiErrorSchema, and createApiClient(baseUrl)

## File Manager Scope API (2026-02-23)
- `GET /api/files` lists files inside a storage scope owned by the selected pipeline.
- `GET /api/files/content` returns safe text preview content for a file inside the same scope.
- Required query params:
- `pipelineId`: pipeline id in dashboard state.
- `scope`: `shared | isolated | runs`.
- `runId` is required when `scope=runs`.
- Optional query param: `path` (relative path inside scope root).
- Required query param for content endpoint: `path` (must point to a file).
- Optional query param for content endpoint: `maxBytes` (default `262144`, max `1048576`).
- `DELETE /api/files` deletes a file or folder inside the same scoped roots.
- Required body fields:
- `pipelineId`, `scope`, `path`.
- Optional body fields:
- `runId` (required when `scope=runs`), `recursive`.
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
- `POST /api/flow-builder/generate` request history accepts larger transcripts (`history` up to 240 messages), and server-side prompt assembly compacts older turns into a summary block when context budget is exceeded.

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
- Runtime regex quality gates are now debug-only and skipped by default; set `FYREFLOW_ENABLE_LEGACY_REGEX_GATES=1` to re-enable regex evaluation for diagnostics.
- `workflow_status: "COMPLETE"` now requires explicit metadata in strict GateResult JSON:
- `stage: "final"`
- `step_role: "delivery"`
- `gate_target: "delivery"`
- Runtime enforces that `COMPLETE` can only pass on a terminal `executor` step (no outgoing links), preventing premature delivery completion on intermediate stages.
