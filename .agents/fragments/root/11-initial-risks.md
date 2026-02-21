## Initial Risks
- Schema drift if handlers bypass shared validators.
- Workspace dependency cycles can slow or break incremental builds.
- Non-deterministic run/event generation can create flaky tests.
- Mixed Bun/Node toolchains can diverge without explicit version pinning.
- SSE run-event volume can degrade UI responsiveness if not bounded.
- Docs can become stale if ADR/runbook updates are not part of feature changes.
