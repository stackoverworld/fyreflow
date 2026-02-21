## Update Policy
- New architecture decisions: add `docs/decisions/NNNN-title.md`.
- Contract changes: update `docs/api-contracts.md` in the same change.
- Convention changes: update `docs/conventions.md` with rationale.
- Keep root instructions between 60-150 lines and scoped docs focused.
- Keep Codex instruction chains under 32 KiB total; run `node scripts/check-agent-context.mjs`.
- Keep docs fresh: run `node scripts/check-doc-freshness.mjs` (default max age 90 days).
- Keep skill catalog curated with trigger tests in `skills/**/tests/trigger-cases.md`.
- If guidance conflicts, deeper scoped `AGENTS.md` files win for their subtree.
