# Maintenance

- Last reviewed: 2026-02-20

## Context Budget Policy
- Keep root `AGENTS.md` between 60 and 150 lines.
- Keep Codex project instruction chain under 32 KiB total.
- Prefer scoped `AGENTS.md` files instead of growing root instructions.
- Run `node scripts/check-agent-context.mjs` before merging.

## Mechanical Checks
- `node scripts/check-agent-context.mjs`: validates AGENTS structure, chain budget, and fragment composition.
- `node scripts/check-doc-freshness.mjs`: validates `Last reviewed` dates in docs.
- `node scripts/check-skills.mjs`: validates skill packaging and trigger case docs.
- Stack verification commands:
  - `npx tsc --noEmit`
  - `vitest run`
  - `vite build`
  - `npm run test:e2e`

## Doc-Gardening Loop
- Scheduled CI workflow runs weekly and opens a PR when docs drift.
- Keep `.github/workflows/ci.yml` aligned with this document's verification commands.
- Use `node scripts/doc-garden.mjs --apply` to refresh docs index and review metadata locally.
- Every architecture-affecting change must include docs and ADR updates.
