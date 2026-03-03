# AGENTS.md

## Scope
- Applies to: `tests/**`
- Priority: this file overrides broader instructions for files in this subtree.

## Focus
- Cross-package integration and release checks.
- Keep changes localized to this subtree unless a contract requires broader edits.
- If API behavior changes, update `docs/api-contracts.md`.
- If architecture boundaries change, update `docs/architecture.md` and ADRs.

## Working Rules
- Prefer small, reviewable patches.
- Avoid hidden side effects across module boundaries.
- Keep tests near the behavior they validate.
- Any feature or behavior change in this scope must add or update automated tests before merge.
- Do not skip verification commands.
- Prefer behavior-level assertions over implementation-only helper assertions.
- For UI flows, cover the user action plus a measurable invariant (for example: final scroll distance from bottom).
- Avoid debug-style tests in CI (no local machine file dependencies, no `console.log`-only checks).
- Prefer explicit assertions (`toBeDefined`, exact value checks) over generic `toBeTruthy` when possible.
- Include at least one edge-case assertion for boundary states or in-flight/race conditions.

## Required Checks
- `npx tsc --noEmit`
- `vitest run`
- `vite build`
- `npm run test:e2e`
