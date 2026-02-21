# Skills

- Last reviewed: 2026-02-20

## Purpose
Skills are progressive-disclosure playbooks. Metadata stays easy to scan, detailed instructions are loaded only when task triggers match.

## Curation Rules
- Keep a small, high-signal catalog.
- Each skill must define explicit trigger patterns.
- Each skill must include trigger test cases in `tests/trigger-cases.md`.
- Remove or archive stale skills that no longer trigger meaningfully.

## Structure
- `skills/<skill-name>/SKILL.md`
- `skills/<skill-name>/tests/trigger-cases.md`

## Refactor Skill Baseline
- Default workflow skill: `qa-refactoring`
- Why: Cross-language safe refactor workflow with baseline/invariants/micro-step discipline.
- Install: `npx skills add vasilyu1983/ai-agents-public --skill qa-refactoring`

## Stack Add-ons
- `vercel-react-best-practices`: React/Next refactor guidance with performance and architecture-focused best practices.

## Install Commands
- `qa-refactoring`: `npx skills add vasilyu1983/ai-agents-public --skill qa-refactoring`
- `vercel-react-best-practices`: `npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices`

## Deterministic Refactor Checks
- `npx tsc --noEmit`
- `vitest run`
- `vite build`

## Adaptive Notes
- Use `vite build` and `vitest run` for deterministic single-pass verification.
- Treat `react-vite-expert` as optional specialist guidance for large structural reorganizations.
- Keep command execution deterministic and preserve behavior via boundary tests.
- Run these checks before and after each non-trivial refactor step.

## Validation
- Run `node scripts/check-skills.mjs`.
- Keep docs and runbooks in sync when public contracts or architecture boundaries change.
- Update this document when skill lifecycle policy changes.
- Stack verification defaults:
  - `npx tsc --noEmit`
  - `vitest run`
  - `vite build`
