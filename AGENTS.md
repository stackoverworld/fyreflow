# AGENTS

## Package Manager Policy

- Use `bun` for dependency management in this repository.
- Do not use `npm`, `pnpm`, or `yarn` for install/update/remove operations.

## Commands

- Install deps: `bun install`
- Add dep: `bun add <package>`
- Add dev dep: `bun add -d <package>`
- Remove dep: `bun remove <package>`

## Dashboard UI Consistency

- Follow the existing dashboard UI kit patterns used in the right step modal (`PipelineEditor`).
- Prefer section-based layout with subtle separators (`h-px`, spacing rhythm) over stacked nested cards.
- Avoid "border in border in border" compositions unless there is a strong information hierarchy need.
- Use Optics components (`Button`, `Input`, `Select`, `Switch`, `Textarea`) and existing color tokens/classes.
- New panels should feel visually consistent with existing side panels, not like standalone generated widgets.
- Action buttons in panel headers must stay single-line (`whitespace-nowrap`, `shrink-0`) to avoid wrapped labels.

## AI Builder Sync Policy

- Any workflow/platform feature added to pipeline execution must be reflected in AI Builder behavior in the same change.
- Mandatory update points:
  - `server/flowBuilder.ts` schema/parsing (`generatedFlowSchema`, normalizers).
  - `server/flowBuilder.ts` prompt contracts (`buildPlannerContext`, `buildChatPlannerContext`, repair/regeneration contexts).
  - `server/flowBuilder.ts` draft mapping (`buildFlowDraft`, `buildFlowDraftFromExisting`) and fallback templates (`fallbackSpec`).
- For new strict checks/contracts, ensure AI Builder either emits them directly or auto-injects safe defaults.
- Keep AI Builder aware of runtime control features exposed by the platform, especially `manual_approval` quality gates and remediation-loop routing semantics.
- Keep AI Builder aware of scheduling controls: `schedule.runMode` (`smart|quick`) and `schedule.inputs` used for cron preflight gating.
- If a feature cannot be auto-configured by AI Builder, document it in the assistant message as manual-required.
