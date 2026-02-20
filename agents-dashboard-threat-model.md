# Agents Dashboard Threat Model (Draft)

Status: Draft baseline. Assumptions need confirmation before final risk ranking.

## Scope

- Frontend: React dashboard in `src/`
- Backend: Express API in `server/`
- Persistence: local JSON store in `data/local-db.json`

Out of scope:

- External provider infrastructure (OpenAI/Anthropic internals)
- Host OS hardening and local workstation security

## System model

1. Browser UI (`src/App.tsx`) calls API routes through `src/lib/api.ts`.
2. API server (`server/index.ts`) validates payloads and updates state via `LocalStore` (`server/storage.ts`).
3. Run execution (`server/runner.ts`, `server/providers.ts`) calls model providers via API key/OAuth/CLI paths.
4. OAuth orchestration (`server/oauth.ts`) reads local CLI auth state and can launch login commands.

## Primary trust boundaries

1. Browser -> API (`http://localhost:5173` -> `http://localhost:8787`)
2. API -> local filesystem (`data/local-db.json`)
3. API -> provider APIs / CLIs (`fetch`, `codex`, `claude`)
4. Local CLI auth cache -> API runtime (`~/.codex/auth.json`)

## Key assets

1. Provider credentials (`apiKey`, `oauthToken`)
2. Pipeline definitions and run logs
3. Prompt/task content and model outputs
4. Local auth/session state for CLI tools

## Top abuse paths (initial)

1. Cross-origin mutation of pipeline/provider state if CORS is too broad.
2. Credential disclosure via insecure local persistence or logs.
3. Prompt/output injection paths causing unsafe rendering in future UI changes.
4. Abuse of provider execution endpoints for cost or availability exhaustion.

## Existing mitigations

1. Zod validation for pipeline/provider/run payloads in `server/index.ts`.
2. Basic API header hardening and origin allowlist handling in `server/index.ts`.
3. Generic 500 responses for unhandled server errors in `server/index.ts`.

## Known gaps

1. Production-grade secret storage is not implemented (credentials are local JSON today).
2. No explicit rate limiting for run/start endpoints.
3. CSP strategy for the web shell is not finalized.
4. Formal threat-model update workflow was missing before this file.

## Open assumptions to validate

1. Is this service local-only or internet-exposed in production?
2. Will multiple users/tenants share one deployed backend?
3. What data classification applies to prompts, outputs, and provider credentials?
4. What authn/authz model is expected for non-local usage?
