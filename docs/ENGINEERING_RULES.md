# Engineering Rules

- Last reviewed: 2026-02-23

These rules are mandatory for this repository. They are derived from installed skills:

- `security-best-practices`
- `security-threat-model`
- `playwright`
- `doc` (when DOCX work is requested)

## Architecture (anti-monolith)

1. `src/App.tsx` is a composition shell only:
   - no direct `fetch` calls;
   - no business logic besides view-level orchestration.
   - keep pipeline drafting/scheduling helpers in `src/lib/pipelineDraft.ts`, `src/lib/smartRunInputs.ts`, and `src/lib/draftHistory.ts`.
2. API and stateful workflow logic must live in feature modules:
   - frontend target: `src/features/<domain>/...`;
   - backend target: `server/http/routes`, `server/runtime`, and focused `server/<domain>` modules.
3. `server/index.ts` is bootstrap-only:
   - dependency wiring and runtime factory composition only;
   - startup orchestration only (recovery + scheduler tick bootstrap);
   - no request schema definitions or route handler business logic.
4. New files should stay under these soft limits:
   - components/hooks/services: 300 lines;
   - route handlers: 220 lines.
5. Legacy oversized files are grandfathered, but every substantial edit must reduce coupling:
   - move at least one coherent responsibility out (state logic, API calls, mapping, validation, or rendering).

## Security baseline

1. Validate all untrusted request payloads at route boundaries with Zod before storage/execution.
2. Keep CORS restricted by explicit origin allowlists (`CORS_ORIGINS`), not open wildcard defaults in production.
3. Keep security headers enabled on API responses:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: no-referrer`
4. Do not expose internal stack traces/messages to API consumers.
5. Do not commit or expose secrets:
   - never place API keys/tokens in frontend bundles;
   - no plaintext production credentials in repo files;
   - local JSON credential storage is development-only and must not be used in production.
6. Keep CSP/header hardening explicit for the web shell before production deploy.

## Threat-model process

1. Maintain `agents-dashboard-threat-model.md`.
2. Update the threat model when any of the following changes:
   - new auth flow;
   - new external integration/provider;
   - new data store or persistence layer;
   - new public endpoint or execution surface.
3. Threat model updates must include:
   - trust boundaries;
   - high-priority abuse paths;
   - mitigation plan with ownership.

## Browser automation and regression checks

1. Critical user journeys must be covered via Playwright CLI flows before release:
   - create/edit/delete pipeline;
   - provider auth configuration;
   - start run and observe step output.
2. Save investigation artifacts under `output/playwright/`.
3. Keep browser-debug commands and snapshots deterministic and reproducible.

## DOCX-specific rule

If a task involves `.docx` creation/review, use the `doc` skill workflow (`python-docx`, visual render check loop) before delivery.

## Definition of done

1. `npm run lint`
2. `npm run typecheck`
3. Security-sensitive changes include a threat-model delta entry.
4. If UI behavior changed, run the relevant Playwright flow and store artifacts.
