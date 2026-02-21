## Architecture Snapshot
- Use a workspace layout with apps/web, apps/api, packages/shared, and packages/config under one lockfile and root scripts.
- Adopt contract-first development: request/response schemas live in packages/shared and are imported by both API handlers and web client code.
- Structure API code as routes -> services -> repositories so behavior is testable and storage can be swapped without handler changes.
- Structure web code by domain features (agents, runs, settings) with route-level modules and a thin typed API client.
- Apply progressive disclosure docs: short task-oriented runbooks first, then deeper ADR rationale in docs/decisions.
- Make verification deterministic with scripted checks and fixed test inputs (time, IDs, seeds).
