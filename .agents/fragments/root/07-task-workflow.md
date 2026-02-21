## Task Workflow
- 1) Read this file, then open `docs/index.md`.
- 2) Load scoped `AGENTS.md` files for directories being modified.
- 3) Draft a minimal change plan before editing.
- 4) Implement with clear module boundaries and explicit contracts.
- 5) Run automation checks: `node scripts/check-agent-context.mjs`, `node scripts/check-doc-freshness.mjs`, `node scripts/check-skills.mjs`.
- 6) Run stack checks from scoped instructions.
- 7) Update docs/ADR entries if architecture or contracts changed.
- 8) Summarize edits with affected files and verification results.
