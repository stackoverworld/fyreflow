# API Contracts

- Last reviewed: 2026-02-21

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
- `POST /api/pipelines/:pipelineId/runs` accepts optional `scenario` string in request body.
- `PipelineRun` includes optional `scenario` in run metadata.
- Scenario behavior is additive: when scenario is omitted, pipelines run with existing behavior.

## AI Builder Additions (2026-02-21)
- `POST /api/flow-builder/generate` response adds optional `questions` for clarification-first chat turns.
- `questions` shape: `[{ id, question, options: [{ label, value, description? }] }]`.
- Clarification is additive and backward-compatible: `action` remains `answer | update_current_flow | replace_flow`.
- When `questions` are present, clients may offer one-click replies by sending `options[].value` as the next user message.

## Subagent Execution Semantics (2026-02-21)
- `PipelineStep.enableDelegation` and `PipelineStep.delegationCount` drive real runtime parallelism in the run executor.
- When at least one step has delegation enabled, ready steps can run concurrently using worker slots, capped by the maximum configured `delegationCount` (clamped to `1..8`).
- Step outputs still merge into one run timeline/log stream and route through existing links and quality gates.
