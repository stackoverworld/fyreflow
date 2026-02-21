# Flow Builder Boundaries

This split keeps `server/flowBuilder.ts` as the orchestration/composition layer and moves reusable primitives into focused modules.

## Ownership

- `server/flowBuilder.ts`
  - Owns end-to-end flow builder orchestration.
  - Composes provider execution, parse/repair/regeneration loops, fallback handling, context building, and draft mapping.
  - Exposes the behavior consumed by callers (`generateFlowDraft`) and should remain the integration point.

- `server/flowBuilder/constants.ts`
  - Static defaults and tuning constants (runtime defaults, schedule defaults, prompt defaults, caps, patterns, model defaults).
  - No parsing or orchestration behavior.

- `server/flowBuilder/schemas.ts`
  - Zod contracts and inferred types for model outputs (`generatedFlowSchema`, `flowDecisionSchema`).
  - Source of truth for structured output shape validation.

- `server/flowBuilder/jsonCandidates.ts`
  - JSON candidate extraction/sanitization helpers (`collectJsonCandidates`) for messy model output.
  - Text normalization only; no flow-domain decisions.

## Refactor Rule (Behavior Preservation)

When refactoring internals in `server/flowBuilder/*`, keep externally observable output contracts identical:

- Keep `generateFlowDraft` response shape and action semantics unchanged.
- Keep schema-validated JSON contracts unchanged unless explicitly versioned/migrated.
- Preserve fallback/default injection behavior expected by pipeline execution and AI Builder paths.
