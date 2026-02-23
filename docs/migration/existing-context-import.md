# Existing Context Import

- Last reviewed: 2026-02-23

- Source: pre-existing project files before primer-ai scaffold write.
- Purpose: keep migration transparent and preserve useful guidance from existing agent/docs artifacts.

## How To Use
- Review sections below and merge relevant constraints into canonical docs under `docs/*`.
- If existing `AGENTS.md` / `CLAUDE.md` files already encode useful rules, keep them as source references during consolidation.
- Preserve skill triggers and test cases when moving skills to canonical `skills/*` layout.

## AGENTS.md

```text
# AGENTS ## Package Manager Policy - Use `bun` for dependency management in this repository. - Do not use `npm`, `pnpm`, or `yarn` for install/update/remove operations. ## Commands - Install deps: `bun install` - Add dep: `bun add <package>` - Add dev dep: `bun add -d <package>` - Remove dep: `bun remove <package>` ## Dashboard UI Consistency - Follow the existing dashboard UI kit patterns used in the right step moda...
```
