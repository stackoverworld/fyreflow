# Architecture

## Intent
Set up fyreflow as a Bun-managed monorepo where web and API evolve through shared typed contracts, Codex can work in small bounded modules, and delivery is reproducible in local and CI runs.

- Last reviewed: 2026-02-24

## Structural Principles
- Use a workspace layout with apps/web, apps/api, packages/shared, and packages/config under one lockfile and root scripts.
- Adopt contract-first development: request/response schemas live in packages/shared and are imported by both API handlers and web client code.
- Structure API code as routes -> services -> repositories so behavior is testable and storage can be swapped without handler changes.
- Keep API bootstrap isolated in a runtime kernel (`server/runtime/kernel.ts`) so local and remote deployment profiles can share one core composition.
- Keep startup orchestration profile-driven with explicit feature flags (`scheduler`, `recovery`) to avoid environment-specific forks in route/service code.
- Keep workflow runtime behavior profile-driven: step-level policy fields should control cache bypass, skip validation, and artifact contracts instead of hardcoded scenario branches in runner core.
- Structure web code by domain features (agents, runs, settings) with route-level modules and a thin typed API client.
- Apply progressive disclosure docs: short task-oriented runbooks first, then deeper ADR rationale in docs/decisions.
- Make verification deterministic with scripted checks and fixed test inputs (time, IDs, seeds).

## Initial Module Plan
| Module Path | Responsibility |
| --- | --- |
| `package.json` | Define Bun workspaces, root scripts (typecheck/test/build/verify), and pinned engine versions. |
| `tsconfig.base.json` | Central strict TypeScript config shared by all apps/packages. |
| `apps/web/src/main.tsx` | Web app bootstrap and provider wiring. |
| `apps/web/src/app/router.tsx` | Route map and feature-level code boundaries. |
| `apps/web/src/features/agents/AgentsPage.tsx` | Agents dashboard page with list/create/edit flows. |
| `apps/web/src/features/runs/RunTimeline.tsx` | Execution run timeline UI and status visualization. |
| `apps/web/src/lib/apiClient.ts` | Typed client wrappers around shared API contracts. |
| `apps/api/src/server.ts` | HTTP server entrypoint, middleware, and route registration. |
| `apps/api/src/routes/health.ts` | Liveness/version endpoint for monitoring and CI smoke checks. |
| `apps/api/src/routes/agents.ts` | Agent CRUD endpoints validated with shared schemas. |
| `apps/api/src/routes/runs.ts` | Run trigger/status/event endpoints for dashboard execution flow. |
| `apps/api/src/services/agentService.ts` | Business logic for agent lifecycle and run orchestration. |
| `apps/api/src/repositories/agentRepository.ts` | Repository interface with deterministic in-memory implementation for initial delivery. |
| `packages/shared/src/contracts/agents.ts` | Zod schemas and inferred types for agent payloads. |
| `packages/shared/src/contracts/runs.ts` | Zod schemas and inferred types for run payloads/events. |
| `packages/shared/src/contracts/index.ts` | Single public export surface for shared contracts. |
| `packages/config/vite.base.ts` | Reusable Vite defaults consumed by apps/web. |
| `tests/e2e/agents-dashboard.spec.ts` | End-to-end smoke for core dashboard and API interaction path. |
| `scripts/verify.sh` | Deterministic local/CI gate runner in fixed order. |
| `docs/decisions/0001-contract-first-monorepo.md` | ADR capturing boundaries, dependencies, and tradeoffs. |
| `server/runtime/config.ts` | Parse runtime mode, CORS, auth token, and startup feature flags from env in one place. |
| `server/runtime/bootstrap.ts` | Deterministic startup sequence for recovery/scheduler, with disposable scheduler loop. |
| `server/runtime/kernel.ts` | Compose store, runtimes, HTTP app, and bootstrap lifecycle behind one start/stop API. |
| `docs/decisions/0002-runtime-kernel-and-managed-release-updates.md` | ADR capturing runtime profile boundaries and release-driven backend update policy. |

## Dependency Direction
- Domain and business logic should not depend on delivery frameworks.
- Adapters (HTTP, CLI, persistence, UI) depend on domain contracts.
- Shared utilities must stay generic and avoid product-specific coupling.

## Change Management
- Any boundary change must be reflected in ADRs under `docs/decisions/`.
- Keep this document aligned with repository layout and ownership.
