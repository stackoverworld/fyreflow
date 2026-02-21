# AGENTS.md

## Scope
- Applies to: `packages/shared/**`
- Priority: this file overrides broader instructions for files in this subtree.

## Focus
- Shared contracts and reusable building blocks.
- Keep changes localized to this subtree unless a contract requires broader edits.
- If API behavior changes, update `docs/api-contracts.md`.
- If architecture boundaries change, update `docs/architecture.md` and ADRs.

## Working Rules
- Prefer small, reviewable patches.
- Avoid hidden side effects across module boundaries.
- Keep tests near the behavior they validate.
- Do not skip verification commands.

## Required Checks
- `npx tsc --noEmit`
- `vitest run`
- `vite build`
