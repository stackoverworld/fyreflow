# Refactor Boundary Ledger (Wave-2)

- Last reviewed: 2026-02-23

## Current boundary status

- This Wave adds documentation-only boundary tracking; no runtime or contract behavior was changed in owned files.
- No new code module boundaries were introduced in application/server code in this pass.
- Existing architecture guidance remains in `README.md`, `docs/ENGINEERING_RULES.md`, and `docs/SKILL_COMPLIANCE.md`.

## Monolith/coupling hotspots under active boundary review

- `src/components/dashboard/PipelineCanvas.tsx`
- `src/components/dashboard/pipeline-canvas/edgeRendering.ts`
- `src/components/dashboard/pipeline-editor/usePipelineEditorState.ts`
- `src/app/useAppState.ts`
- `server/storage.ts`

## Boundary policy reminders for future edits

- Keep changes confined to single, cohesive boundaries to preserve deterministic runtime behavior.
- Preserve existing API payloads, CLI flags, and visible workflow contracts.
- Avoid nested visual/card border stacks unless hierarchy requires it (aligns with project UI conventions).
- For workflow/platform feature additions, keep AI Builder/schema/runtime sync in:
  - `server/flowBuilder.ts` (schema parsing + context prompts)
  - `server/flowBuilder.ts` (draft mapping + fallback templates)

## Wave-2 verification result summary

- `bun x tsc --noEmit` passed.
- `bun x vitest run` failed in the current environment due tempdir write permission (`AccessDenied`).
- `bun x vite build` passed.

## Wave-3 boundary updates (current pass)

### New module boundaries introduced

- `server/providers/clientFactory.ts` is now a stable facade that re-exports:
  - `executeViaCli` from `server/providers/clientFactory/cliRunner.ts`
  - `executeOpenAIWithApi` and `executeClaudeWithApi` from `server/providers/clientFactory/apiRunner.ts`
- Shared provider client constants/flag helpers were isolated in `server/providers/clientFactory/config.ts`.
- `server/mcp.ts` is now an orchestrator that keeps public MCP contracts while delegating to:
  - `server/mcp/allowlist.ts`
  - `server/mcp/parsers.ts`
  - `server/mcp/process.ts`
  - `server/mcp/transports/http.ts`
  - `server/mcp/transports/stdio.ts`

### Contract impact

- No public contract changes:
  - Provider client exports and call signatures are unchanged.
  - MCP exports and result semantics are unchanged.
- No user-visible UI behavior was modified.

### Wave-3 verification result summary

- `bunx tsc --noEmit` passed.
- `vitest run` is not available in this repository (`vitest` not installed).
- `bunx vite build` failed before and after this pass at `src/components/dashboard/ai-builder/plan-preview/planPreviewFormatters.ts:142` with JSX parse error (`Expected ">" but found "key"`).
