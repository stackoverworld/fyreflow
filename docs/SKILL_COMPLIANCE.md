# Skill Compliance Audit

Last updated: 2026-02-20

## Installed skills evaluated

- `doc`
- `playwright`
- `security-best-practices`
- `security-threat-model`

## Compliance matrix

| Skill | Applicability | Status | Evidence | Required follow-up |
| --- | --- | --- | --- | --- |
| `doc` | Only for `.docx` work | Not applicable now | No DOCX artifacts/workflows in repo (`README.md:1`) | Use skill when DOCX tasks appear |
| `playwright` | UI regression and browser automation | Partial | No e2e script in `package.json:6`; no Playwright flow documentation before this audit | Add and run CLI browser flows for critical paths, store artifacts in `output/playwright/` |
| `security-best-practices` | Express + React code security posture | Partial | Input validation exists (`server/index.ts:45`); CORS/header/error hardening now added (`server/index.ts:12`, `server/index.ts:20`, `server/index.ts:258`); local plaintext credentials still exist (`server/storage.ts:71`, `server/storage.ts:81`, `server/storage.ts:314`) | Move credential handling to secure server-side secret storage for production; add CSP hardening for web shell before deploy |
| `security-threat-model` | Threat-modeling process | Partial | No prior repo threat-model file; rule added in `docs/ENGINEERING_RULES.md:48` | Maintain and update `agents-dashboard-threat-model.md` with boundary/abuse-path changes |

## Monolith risk checkpoints

1. Frontend helper logic is partially extracted from `src/App.tsx` into `src/lib/pipelineDraft.ts`, `src/lib/smartRunInputs.ts`, and `src/lib/draftHistory.ts`; remaining concentration is in orchestration/event handlers.
2. Step-builder complexity remains concentrated in `src/components/dashboard/PipelineEditor.tsx:137`.
3. API routing is centralized in `server/index.ts:115` even after hardening middleware.

## Related reports

- `security_best_practices_report.md`
- `docs/ENGINEERING_RULES.md`
