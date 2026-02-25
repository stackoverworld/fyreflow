# ADR-0001: Initial Architecture Blueprint

- Last reviewed: 2026-02-25

## Status
Accepted

## Context
The project was initialized with `primer-ai` to provide an agent-optimized, progressively disclosed architecture scaffold.

## Decision
- Establish `AGENTS.md` as the root routing document.
- Keep source-of-truth architecture data in `docs/*`.
- Use scoped `AGENTS.md` files for subtree-specific constraints.
- Validate changes with the following initial checks:
  - `npx tsc --noEmit`
  - `vitest run`
  - `vite build`

## Consequences
- Faster cold-start for coding agents due to stable context layout.
- Documentation maintenance is required to avoid drift.
- Repository decisions become explicit and reviewable.

## Notes
Initial project intent: Build FyreFlow with an agent-optimized architecture and reproducible delivery workflow.
