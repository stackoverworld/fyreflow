# ADR-0002: Runtime Kernel And Managed Release Updates

- Last reviewed: 2026-02-25

## Status
Accepted

## Context
- Backend startup wiring lived directly in `server/index.ts`, which made profile-specific behavior (local vs remote deployment) hard to evolve safely.
- The product requires one backend core that can run both locally and on Railway, while enabling controlled feature toggles (scheduler/recovery) per environment.
- Update rollout must remain predictable: backend containers should be replaced by CI/CD release pipelines, not self-mutated by application code.

## Decision
- Introduce a runtime kernel layer:
  - `server/runtime/config.ts` for runtime/profile/env parsing.
  - `server/runtime/bootstrap.ts` for deterministic startup sequence and scheduler lifecycle.
  - `server/runtime/kernel.ts` for composition of store, runtimes, and HTTP app.
- Keep `server/index.ts` bootstrap-only and delegate startup to the runtime kernel.
- Use managed release updates as the backend update policy:
  - source of truth is tagged release artifact (container image),
  - deployment platform pulls new image and replaces runtime,
  - in-app controls trigger checks/notifications, not self-update logic inside the server process.
- Expose update controls through core API (`/api/updates/*`) that proxy to updater service so clients use normal API auth and do not store updater admin tokens.

## Consequences
- Local and remote backends share one composition path, reducing drift.
- Startup behavior becomes testable with unit tests around config parsing and bootstrap sequencing.
- Future work (WebSocket hub, pairing, admin update controls) can attach to runtime/kernel without reworking route/service layers.
- Update safety shifts to deployment orchestration (drain windows, health checks, rollout controls), which is more reliable than in-process self-updates.
- User-facing update UX becomes simpler: pairing/device tokens or API tokens are enough for update actions; updater admin token stays backend-only.

## Rollback Triggers
- Revert runtime-kernel rollout if startup failures increase or scheduler/recovery behavior deviates from expected defaults in production.
- Revert managed-release policy only if deployment platform cannot provide reliable health-checked rollouts for active run workloads.
