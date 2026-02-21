# Conventions

- Last reviewed: 2026-02-20

## Coding
- Use Bun for dependency operations only (install/add/remove).
- All cross-app API types must come from packages/shared contracts; do not duplicate payload interfaces in apps.
- Dependency direction is one-way: apps can import packages; packages cannot import apps.
- Expose feature/module public APIs via index.ts and keep internals private by path.
- Runbooks use progressive disclosure: quick-start steps first, deep details linked below.
- ADRs are required for boundary changes and must include rollback trigger criteria.
- Tests must control time/ID generation for deterministic outcomes.

## Delivery Workflow
- Start from a short plan, then implement minimal viable changes.
- Keep commits scoped and reversible.
- Validate locally before asking for review.
- Prefer a single project-level check entrypoint (`check` script/command) that CI and developers both use.
- Any user-visible feature or behavior change must include a test delta in the same change.
- Choose test depth by risk: `vitest` for logic/contracts/edge-cases and `playwright` for critical end-to-end user journeys.

## Verification
- `node scripts/check-agent-context.mjs`
- `node scripts/check-doc-freshness.mjs`
- `node scripts/check-skills.mjs`
- `npx tsc --noEmit`
- `vitest run`
- `vite build`
- `npm run test:e2e` (critical browser journeys)

## Documentation
- Update `docs/architecture.md` when module boundaries evolve.
- Update `docs/api-contracts.md` when interfaces or payloads change.
- Add ADR entries for durable architecture decisions.
