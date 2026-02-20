# Security best practices report

## Executive summary
- The Express API currently accepts requests from any origin, and there are no header or error-handling hardenings around the middleware chain to keep attackers from probing and fingerprinting it.
- The React shell ships with no Content-Security-Policy or other security headers, so untrusted prompts, model output, and future third-party scripts cannot rely on browser-enforced defenses.
- Zod schemas are used on every endpoint boundary (pipeline, provider, run) to normalize and validate user input before it touches storage or downstream execution.
- There is currently no authentication/authorization around the Express routes, so any client that reaches port 8787 can mutate pipelines, providers, secure inputs, MCP servers, or queue runs.
- All secrets (provider keys, OAuth tokens, secure pipeline inputs, MCP env/headers) live in plaintext JSON files and the API runs only over HTTP, so they can be read from disk or intercepted on the network.

## Findings

### Critical
#### FIND-004: API endpoints expose secrets and actions without any authentication/authorization
- Rule ID: CUSTOM-AUTHZ-001
- Severity: Critical
- Location: `server/index.ts:526-833`
- Evidence: Every pipeline, provider, secure-input, MCP, and run endpoint (see `/api/pipelines` through `/api/runs/:runId/stop`) is mounted immediately after the Express app is configured, yet no authentication/authorization middleware is attached anywhere before these routes execute.
- Impact: Any process that can reach port 8787 can mutate pipelines, provider API keys, pipeline secure inputs, MCP servers, or trigger runs—which means a simple port scan yields full control over agent prompts, credentials, and remotely executed MCP commands.
- Fix: Introduce a mandatory auth layer (JWT, API key, mTLS, etc.), enforce role/permission checks before state-changing endpoints, and fail-along requests that lack valid credentials. Rotate tokens periodically and tie them to the Electron shell if that is the only client.
- Mitigation: Limit TCP/IP access with firewalls or VPNs until auth is in place and audit every unauthenticated request for incident response.
- False positive notes: If the server is guaranteed to run inside a mutually authenticated tunnel (e.g., local Electron + named pipe only), document that constraint so this finding can be re-evaluated.

#### FIND-005: Secrets (provider keys, OAuth tokens, secure inputs) are persisted in plaintext JSON state
- Rule ID: CUSTOM-SECRETS-001
- Severity: Critical
- Location: `server/storage.ts:1-714`, `server/secureInputs.ts:12-164`
- Evidence: `LocalStore` writes provider API keys, OAuth tokens, and MCP `env`/`headers` directly into `data/local-db.json` (see `DB_PATH` and `upsertProvider`/`createMcpServer`), and secure pipeline inputs are serialized as JSON files under `data/pipeline-secure-inputs/<pipeline>/secure-inputs.json` with only Unix file permissions guarding them.
- Impact: A compromised host, backup, or unencrypted copy of these files immediately reveals every provisioning secret, so attackers gain access to downstream LLM providers and MCP credentials and can inject new workflows.
- Fix: Encrypt these files at rest (e.g., with a key pulled from the environment or a secret manager) or move secrets into a dedicated vault and only cache non-sensitive metadata locally; always rotate encryption keys and never serialize raw secrets in shared state.
- Mitigation: Harden filesystem ACLs around the `data` directory, avoid exposing the JSON files to backup processes, and delete secrets from disk once they are no longer needed.
- False positive notes: If secrets are mirrored from a hardened DSM/Vault and the JSON payloads contain only encrypted blobs, document that so this finding can be revisited.

#### FIND-006: Transport defaults assume plaintext HTTP and leak every secret in flight
- Rule ID: CUSTOM-TRANSPORT-001
- Severity: Critical
- Location: `server/index.ts:526-845`
- Evidence: The server only calls `app.listen(port)` (logged as `Agents dashboard API listening on http://localhost:${port}`) without TLS configuration or any `req.secure` checks, so all API traffic—including provider tokens, pipeline inputs, and MCP credentials—is served over unencrypted HTTP unless the deployment manually adds TLS.
- Impact: Without HTTPS, every secret the API handles can be intercepted or modified by a man-in-the-middle, and attackers can hijack MCP commands or steal pipeline definitions while in transit.
- Fix: Require HTTPS in production (e.g., run Express with TLS or reject `req.protocol !== 'https'` after trusting only a fronting proxy) and document that TLS termination is mandatory; consider automatically redirecting HTTP → HTTPS when the gateway indicates a secure endpoint.
- Mitigation: Deploy behind a reverse proxy that terminates TLS, sets `X-Forwarded-Proto`, and configure Express to trust only that proxy so non-HTTPS requests are rejected.
- False positive notes: If the server is intentionally only ever reached over a Unix domain socket or internal loopback without external network exposure, state that assumption so we can close this finding.

#### FIND-007: MCP credential blobs are stored raw and replayed into command execution
- Rule ID: CUSTOM-MCP-001
- Severity: Critical
- Location: `server/storage.ts:639-714`, `server/mcp.ts:69-220`
- Evidence: MCP definitions persist arbitrary `env` and `headers` strings (the carrier for credentials) in `LocalStore`, and `callStdioMcp`/`callHttpLikeMcp` parse and inject them verbatim into spawned commands or HTTP headers without encryption, validation, or per-field access controls.
- Impact: Because the config API is unauthenticated and secrets sit in plaintext JSON, an attacker can both harvest MCP secrets and use them to execute arbitrary binaries or RPC calls, effectively turning the MCP subsystem into a remote command-execution backdoor.
- Fix: Treat MCP `env`/`headers` as secrets: store them encrypted, enforce that only authenticated users can write or modify MCP records, validate each entry before piping it to `spawn` or `fetch`, and consider signing MCP definitions so only trusted clients can add new servers.
- Mitigation: Keep MCP configs in a separate secured store and postpone exposing this API to the public internet until both auth and encryption are in place.
- False positive notes: If MCP env/headers are guaranteed to be empty or only contain safe metadata, document that limitation so we can re-evaluate this finding.

### Medium
#### FIND-001: Open CORS exposes state-changing API endpoints to every origin
- Rule ID: EXPRESS-CORS-001
- Severity: Medium
- Location: `server/index.ts:9-13`
- Evidence: the bootstrap only installs `cors()` with the default configuration (`app.use(cors())`) before the body parser, so the API reflects every incoming `Origin` header and allows every method without restriction.
- Impact: Any website can call POST/PUT/DELETE endpoints such as `/api/pipelines`, `/api/providers/:id`, or `/api/pipelines/:id/runs` and mutate stored pipelines/provider tokens. If cookie/credential support is added later, this becomes a high-impact CSRF avenue because `Access-Control-Allow-Credentials` would be honored for whitelisted origins.
- Fix: Replace the global `cors()` call with a scoped configuration that allowlists the dashboard origin(s) (e.g., `origin: process.env.FRONTEND_URL` or explicit host list) and tightens `methods`, `allowedHeaders`, and `credentials` to what is strictly necessary. Consider attaching the middleware only to the routes that need browser access.
- Mitigation: Keep the API stateless and unauthenticated if the intention is to expose it publicly, and monitor for abuse if you must support multiple front ends.
- False positive notes: If this API intentionally accepts traffic from any origin because it is a public SaaS endpoint, document that decision and use additional controls (e.g., API tokens) during the exposure window.

#### FIND-002: Missing Helmet/X-Powered-By disablement and error handler weaken Express baseline
- Rule IDs: EXPRESS-HEADERS-001, EXPRESS-FINGERPRINT-001, EXPRESS-ERROR-001
- Severity: Medium
- Location: `server/index.ts:9-230`
- Evidence: the server setup contains only the two middleware calls (`app.use(cors())`, `app.use(express.json(...))`) and the route handlers—there is no `helmet()` middleware, `app.disable('x-powered-by')`, nor final 404/error-handling middleware defined anywhere in the file.
- Impact: Without `helmet()` or custom headers, the API is missing defenses such as `X-Content-Type-Options`, clickjacking protection, referrer policy, and a Content-Security-Policy, making it easier to fingerprint/abuse. The default Express pages still expose `X-Powered-By: Express` and stack traces when `NODE_ENV !== 'production'`, so attackers can use that telemetry to adjust attack vectors.
- Fix: Install and configure `helmet` early (configure at least `contentSecurityPolicy`, `frameguard`, and `noSniff`), call `app.disable('x-powered-by')`, and add a terminal 404 handler plus an error-handling middleware that logs internally but returns sanitized error responses. Align the error handler with Express guidance so stack traces never reach clients even if you forget to set `NODE_ENV`.
- Mitigation: Add logging/monitoring around unhandled errors and ensure any future middleware can't override the header configuration.
- False positive notes: If these headers are set at a reverse proxy/CDN that is not checked into the repo, note the behavior; otherwise, assume the Express app is responsible for them.

#### FIND-003: React shell lacks CSP/header hardening for user-provided content
- Rule IDs: REACT-HEADERS-001, REACT-CSP-001
- Severity: Medium
- Location: `index.html:1-15`
- Evidence: `index.html` only declares charset/viewport/description metadata and loads `main.tsx`—no `<meta http-equiv="Content-Security-Policy">` tag is present, and there is nothing in the repo that sets the CSP, nosniff, or frame-ancestors headers before the SPA loads.
- Impact: The UI renders user-entered pipeline prompts, run tasks, and provider names. Without a CSP, any inadvertent DOM XSS (e.g., future markdown rendering or LLM output that slips through) has no policy that blocks inline scripts or untrusted asset loading, leaving the app dependent on React escaping alone. Third-party scripts that may be added later also gain full privileges.
- Fix: Deliver a CSP that at least restricts assets to `'self'` (e.g., `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'self';`). Because this is a Vite SPA, you can emit the header from the Express server (via `helmet`/custom middleware) or add a `<meta http-equiv>` tag early in `index.html` if headers are not available.
- Mitigation: Pair the CSP with Trusted Types or strict hashing/nonces if you ever add inline scripts or `dangerouslySetInnerHTML`. Enable SRI for any third-party CDN assets as soon as they exist.
- False positive notes: If a gateway already injects these headers before the SPA is served, document the exact header values so the repo reflects the runtime reality.

## Positive controls
- Rule ID: EXPRESS-INPUT-001 — `server/index.ts:15-62` defines comprehensive Zod schemas for every pipeline step, pipeline payload, provider update, and run request, ensuring that every state-changing endpoint parses/validates untrusted JSON before it reaches storage or execution.
