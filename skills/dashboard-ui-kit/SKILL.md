---
name: dashboard-ui-kit
description: >-
  Build or update dashboard UI in this repository using UIKIT.md and existing
  panel/modal patterns. Use when tasks ask for new or revised pages, side
  panels, modals, forms, cards, buttons, lists, empty states, warnings, or
  visual consistency work in the dashboard.
---

# Dashboard UI Kit Skill

## Trigger
Use this skill when a request adds or updates dashboard UI in this repository, especially:
- New pages, side panels, right-side "play/run" views, or modals.
- New forms, cards, lists, empty states, warnings, or action rows.
- Visual consistency work for existing dashboard surfaces.
- Requests that mention matching the current UI kit or `UIKIT.md`.

## Do Not Trigger
- Backend-only, API-only, or data-model-only tasks.
- Non-dashboard creative redesigns that intentionally ignore existing patterns.
- Pure bugfixes with no UI structure/style impact.

## Workflow
1. Read the canonical UI sources before editing:
   - `UIKIT.md` (primary spacing/layout/token reference).
   - `src/components/dashboard/PipelineEditor.tsx` and `src/components/optics/slide-panel.tsx` (right-side step panel behavior).
   - `src/app/shell/routes/routeWrappers.tsx` (left/right panel shell sizing, header, and `p-3` body padding).
   - `src/components/dashboard/RunPanel.tsx`, `src/components/dashboard/SettingsModal.tsx`, and `src/components/dashboard/RunInputRequestModal.tsx` (real examples).
2. Identify the surface type and reuse the matching shell pattern:
   - Right panel: `SlidePanel` with top bar and scrollable `p-3` body.
   - Center modal: glass panel, rounded border, header/body split, backdrop.
   - In-panel section: section-based layout with divider rhythm.
3. Build panel content with UI kit spacing rules:
   - Root container has no `space-y-*` for top-level groups.
   - Separate top-level groups using `my-5 h-px bg-ink-800/60`.
   - Use `<section className="space-y-4">` for standard forms and `<section className="space-y-3">` for compact actions/lists.
4. Implement fields and controls with Optics primitives:
   - Use `Button`, `Input`, `Select`, `Switch`, `Textarea`.
   - Wrap fields with `label.block.space-y-1.5`.
   - Keep helper/meta text at `text-[11px]` token sizes.
5. Implement cards and status states with existing tokens:
   - Standard card: `rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5`.
   - Empty state: centered text in a bordered card.
   - Warning/error: tinted banner with icon and compact copy.
6. Keep hierarchy clean (see UIKIT.md §16–§20 for full rules and examples):
   - **No nested borders**: one `border` level max. Inside a bordered card use `border-t` dividers, never sub-cards with their own border + rounded + bg.
   - **ink-only colors**: never use raw Tailwind semantic colors (red-400, sky-400, amber-400, violet-400) for borders/backgrounds. Use `ink-*` shades. Semantic colors only inside `<Badge>` variants.
   - **Icon alignment**: `items-start` + `shrink-0` + `mt-px` on icons next to wrapping text. Never `items-center` for multi-line content.
   - **Badges/labels**: always `shrink-0 whitespace-nowrap` to prevent wrapping.
   - **Auxiliary buttons**: use `variant="ghost"` for copy/open/refresh actions inside cards, not `variant="secondary"`.
   - **Timelines/event lists**: `border-l-2 border-l-ink-700 pl-3` left-accent per item — not bordered cards per item.
7. Run a consistency self-check before finalizing:
   - Typography and color tokens match `UIKIT.md`.
   - Spacing follows divider rhythm and section spacing.
   - Interaction states (hover/disabled/loading) match nearby dashboard patterns.
   - New UI feels native to existing dashboard panels, not a standalone widget.
