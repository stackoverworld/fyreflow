# Panel UI Kit — Spacing & Layout Rules

Reference implementation: **RunPanel** and **PipelineEditor step configuration panel**

---

## 1. Panel root

Plain `<div>` — no `space-y-*`. Sections are separated by explicit dividers with their own margins.

```tsx
<div>
  {/* section A */}
  <div className="my-5 h-px bg-ink-800/60" />
  {/* section B */}
  <div className="my-5 h-px bg-ink-800/60" />
  {/* section C */}
</div>
```

Panel content padding (`p-3`) is applied by the parent SlidePanel, not by the panel component itself.

---

## 2. Section dividers

The **only** way to separate top-level sections. Always placed between every two sections.

```tsx
<div className="my-5 h-px bg-ink-800/60" />
```

`my-5` = 20px top + 20px bottom = **40px total gap** with a 1px line.

---

## 3. Sections

Each logical group is a `<section>` with internal vertical spacing.

| Variant | Class | Use for |
|---------|-------|---------|
| Standard | `space-y-4` | Form fields, settings, inputs |
| Compact | `space-y-3` | Button groups, action areas, lists |

```tsx
<section className="space-y-4">
  {/* section header */}
  {/* section body */}
</section>
```

---

## 4. Section headers

Icon (h-3.5) + uppercase label. Optional trailing metadata or action button.

**Basic header:**
```tsx
<div className="flex items-center gap-2 text-ink-400">
  <Icon className="h-3.5 w-3.5" />
  <span className="text-[11px] font-semibold uppercase tracking-wider">Section Name</span>
</div>
```

**Header with trailing metadata:**
```tsx
<div className="flex items-center gap-2 text-ink-400">
  <Icon className="h-3.5 w-3.5" />
  <span className="text-[11px] font-semibold uppercase tracking-wider">Preflight</span>
  <span className="text-[11px] text-ink-600">3/5 passed</span>
</div>
```

**Header with trailing action:**
```tsx
<div className="flex items-center justify-between gap-2">
  <div className="flex items-center gap-2 text-ink-400">
    <Icon className="h-3.5 w-3.5" />
    <span className="text-[11px] font-semibold uppercase tracking-wider">Section Name</span>
  </div>
  <Button size="sm" variant="secondary">
    <RefreshCw className="h-3.5 w-3.5" />
    Refresh
  </Button>
</div>
```

---

## 5. Form fields

Each field wrapped in a `<label>` with `space-y-1.5` between label text, input, and optional helper.

**Standard field:**
```tsx
<label className="block space-y-1.5">
  <span className="text-xs text-ink-400">Field label</span>
  <Input placeholder="..." />
</label>
```

**With required indicator:**
```tsx
<span className="flex items-center gap-1 text-xs text-ink-400">
  Field label
  <span className="text-red-400">*</span>
</span>
```

**With description below input:**
```tsx
<label className="block space-y-1.5">
  <span className="text-xs text-ink-400">Field label</span>
  <Input placeholder="..." />
  <p className="text-[11px] text-ink-600">Helper text describing the field.</p>
</label>
```

---

## 6. Cards

Used for list items (preflight checks, run history, server entries, etc.).

**Standard bordered card:**
```tsx
<div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
  ...
</div>
```

**Card with icon + title + subtitle (e.g. preflight check):**
```tsx
<div className="flex items-start gap-2.5 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
  <StatusIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
  <div className="min-w-0 flex-1">
    <p className="text-xs font-medium text-ink-200">Card title</p>
    <p className="mt-0.5 text-[11px] text-ink-500">Card subtitle</p>
    <p className="mt-0.5 text-[11px] text-ink-600">Extra detail line</p>
  </div>
</div>
```

**Card list spacing:** `space-y-2` wrapper around cards.

---

## 7. Empty states

Centered placeholder inside a bordered card:

```tsx
<div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-4 text-center text-xs text-ink-500">
  No items yet. Do something to see results.
</div>
```

---

## 8. Warning / error banners

```tsx
<div className="flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400">
  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
  Warning message text
</div>
```

---

## 9. Inline loading state

```tsx
<div className="flex items-center gap-2 rounded-lg bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
  <Loader2 className="h-3.5 w-3.5 animate-spin" />
  Loading description...
</div>
```

---

## 10. Buttons

**Full-width primary action:**
```tsx
<Button className="w-full">
  <Play className="mr-2 h-4 w-4" />
  Start run
</Button>
```

**Secondary inline action (sm):**
```tsx
<Button size="sm" variant="secondary">
  <Save className="h-3.5 w-3.5" />
  Save
</Button>
```

---

## 11. Expandable list items

Uses native `<details>` with chevron rotation.

```tsx
<details className="group">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5 transition-colors hover:border-ink-700/60">
    <div className="flex items-center gap-2.5 min-w-0">
      <ChevronRight className="h-3 w-3 shrink-0 text-ink-600 transition-transform group-open:rotate-90" />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-ink-200">Item title</p>
        <p className="line-clamp-1 text-[11px] text-ink-500">Subtitle</p>
      </div>
    </div>
    <Badge variant="success">status</Badge>
  </summary>
  <div className="mt-1.5 space-y-2 rounded-lg border border-ink-800/30 bg-ink-950/40 p-2.5">
    {/* expanded content */}
  </div>
</details>
```

---

## 12. Switch rows

Toggle with label + description, used in settings panels.

```tsx
<div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
  <div className="flex items-center gap-2.5">
    <Icon className="h-3.5 w-3.5 text-ink-500" />
    <div>
      <p className="text-[13px] text-ink-100">Setting name</p>
      <p className="text-[11px] text-ink-500">What this does.</p>
    </div>
  </div>
  <Switch checked={value} onChange={setValue} />
</div>
```

---

## 13. Status icons (inline)

```tsx
<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />  // pass
<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />   // warning
<XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />           // fail
```

---

## 14. Typography scale

| Class | Usage |
|-------|-------|
| `text-[11px] font-semibold uppercase tracking-wider text-ink-400` | Section headers |
| `text-xs text-ink-400` | Field labels |
| `text-xs font-medium text-ink-200` | Card titles |
| `text-xs text-ink-500` | Secondary info, status lines |
| `text-[11px] text-ink-500` | Card subtitles, metadata |
| `text-[11px] text-ink-600` | Helper text, descriptions |
| `text-[10px] uppercase tracking-wide text-ink-500` | Micro labels |
| `text-[13px] text-ink-100` | Switch row labels |
| `font-display text-sm font-semibold text-ink-50` | Provider / entity name |

---

## 15. Color discipline

### ink-only palette for layout
- All borders, backgrounds, and text colors for layout elements use `ink-*` shades (ink-50 through ink-950). These auto-invert between dark and light themes.
- `ember-*` is the brand accent — only for focus rings, active toggles, and primary CTAs.
- **Never use raw Tailwind semantic colors** (red-400, sky-400, amber-400, violet-400, blue-500, etc.) for borders, backgrounds, or accents on layout elements. They look garish against the ink palette.
- Semantic colors (emerald, red, amber) are allowed **only** inside `<Badge>` variants and preflight status icons — never for card borders or backgrounds.
- When you need visual differentiation between item kinds (e.g. event types in a timeline), use different ink shades (ink-600 vs ink-700) — not rainbow colors.

### Surface tokens (always use these)
| Token | Usage |
|-------|-------|
| `bg-[var(--surface-raised)]` | Card and list-item backgrounds |
| `bg-[var(--surface-inset)]` | Code blocks, depressed areas |
| `bg-[var(--surface-overlay)]` | Floating overlays, tooltips, code blocks |
| `border-ink-800/50` | Standard card/container border |
| `border-ink-800/40` | Inner divider lines (with `border-t`) |
| `bg-[var(--divider)]` | Full-width `h-px` horizontal rules |

### Text hierarchy
| Role | Class |
|------|-------|
| Primary (headings) | `text-ink-50` |
| Secondary (labels, names) | `text-ink-200` |
| Tertiary (descriptions) | `text-ink-400` |
| Muted (hints, placeholders) | `text-ink-500` |
| Near-invisible (fine print) | `text-ink-600` |

---

## 16. No nested borders

- **One level of border maximum.** A bordered card (`rounded-lg border border-ink-800/50`) must never contain children with their own `border` + `rounded-*` + `bg-*`.
- Inside a bordered card, separate sections with `border-t border-ink-800/40` divider lines.
- `<details>` inside a card: no border, no background. Just indent with `pl-4`.
- **Exception**: `<pre>`/`<code>` blocks for code content may keep `border border-ink-800/50 bg-[var(--surface-inset)]`.

**Bad — nested borders:**
```tsx
<div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)]">
  {/* ❌ sub-card with its own border */}
  <div className="rounded-md border border-ink-800/50 bg-[var(--surface-overlay)]">
    ...
  </div>
</div>
```

**Good — flat with dividers:**
```tsx
<div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)]">
  <div>Section A</div>
  <div className="border-t border-ink-800/40 pt-2.5">Section B</div>
  <div className="border-t border-ink-800/40 pt-2.5">Section C</div>
</div>
```

---

## 17. Icon alignment

- Always use `items-start` (not `items-center`) when an icon sits next to text that can wrap to multiple lines.
- Add `shrink-0` on every icon to prevent squishing.
- Use `mt-px` on icons for optical alignment with the first line of text.

```tsx
{/* ✅ Correct */}
<div className="flex items-start gap-1.5">
  <Icon className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
  <p className="text-[12px] text-ink-200">Title that may wrap</p>
</div>

{/* ❌ Wrong — icon will center-align on multi-line */}
<div className="flex items-center gap-1.5">
  <Icon className="h-3.5 w-3.5" />
  <p>Title</p>
</div>
```

---

## 18. Badges and inline labels

- Any badge, tag, or inline label must have `shrink-0 whitespace-nowrap` so it never wraps or gets squished.

```tsx
<span className="shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-500">
  attempt 1
</span>
```

---

## 19. Auxiliary buttons

- Use `variant="ghost"` for secondary actions inside cards/panels (copy, open folder, refresh) — not `variant="secondary"`.
- Copy-to-clipboard: prefer a small inline `<button>` with `text-ink-500 hover:text-ink-300` placed right next to the value being copied.

---

## 20. Timeline / event list pattern

Use left-accent border per item — not bordered cards.

```tsx
<ol className="space-y-3">
  <li className="border-l-2 border-l-ink-700 pl-3 py-1.5">
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-1.5">
        <Icon className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
        <p className="text-[12px] font-medium text-ink-200">Event title</p>
      </div>
      <span className="shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-500">
        attempt 1
      </span>
    </div>
    <p className="mt-2 text-[11px] text-ink-400">Event detail</p>
  </li>
</ol>
```

---

## Spacing summary

| Where | Class | Pixels |
|-------|-------|--------|
| Panel content padding | `p-3` (parent) | 12px |
| Section divider margin | `my-5` | 20+20 = 40px gap |
| Divider line | `h-px bg-ink-800/60` | 1px |
| Within sections (standard) | `space-y-4` | 16px |
| Within sections (compact) | `space-y-3` | 12px |
| Between cards in a list | `space-y-2` | 8px |
| Label to input gap | `space-y-1.5` | 6px |
| Label to description gap | `space-y-1` | 4px |
| Section header icon to text | `gap-2` | 8px |
| Card inner padding | `px-3 py-2.5` | 12px / 10px |
