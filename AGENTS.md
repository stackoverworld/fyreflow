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
