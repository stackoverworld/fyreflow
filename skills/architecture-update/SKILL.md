# Architecture Update Skill

## Trigger
Use this skill when a change affects module boundaries, contracts, or cross-cutting architecture decisions.

## Workflow
1. Read `docs/architecture.md` and `docs/api-contracts.md`.
2. Implement minimal code changes for the selected boundary update.
3. Update `docs/architecture.md` and add an ADR in `docs/decisions/`.
4. Run verification:
   - `node scripts/check-agent-context.mjs`
   - `node scripts/check-doc-freshness.mjs`
5. Summarize architectural impact and migration concerns.
