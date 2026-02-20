# Security best practices report

## Executive summary
- The Express API currently accepts requests from any origin, and there are no header or error-handling hardenings around the middleware chain to keep attackers from probing and fingerprinting it.
- The React shell ships with no Content-Security-Policy or other security headers, so untrusted prompts, model output, and future third-party scripts cannot rely on browser-enforced defenses.
- Zod schemas are used on every endpoint boundary (pipeline, provider, run) to normalize and validate user input before it touches storage or downstream execution.

## Findings

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
