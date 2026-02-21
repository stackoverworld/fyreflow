# Adaptive Refactor Skill

## Trigger
Use this skill when a request asks to refactor code while preserving behavior, especially across stack-specific toolchains.

## Do Not Trigger
- Net-new feature delivery where behavior-preservation is not the goal.
- Cosmetic-only edits (typos, formatting-only passes, copy changes).
- Pure explanation requests with no code edits.

## Workflow
1. Start with baseline safety loop:
   - establish current behavior and add/confirm invariants
   - create a narrow seam for the refactor
   - execute smallest safe change
   - verify before proceeding
2. Apply baseline skill preference:
   - `qa-refactoring` as default safe workflow
3. Add stack-specific skill(s) when relevant:
   - Rust: `rust-refactor-helper`
   - Next.js/React: `vercel-react-best-practices`
   - Node backend: `nodejs-backend-patterns`
   - Swift/iOS: `ios-development`
   - Large Vite reorganizations (optional specialist): `react-vite-expert`
4. Prefer deterministic verification commands per stack:
   - Rust: `cargo fmt`, `cargo clippy --fix`, `cargo test`
   - TypeScript + Node backend: `npx tsc --noEmit`, `npm run test`, `npm run build`
   - Vite + TypeScript: `npx tsc --noEmit`, `vitest run`, `vite build`
   - Swift: `swift format lint .`, `swift test`
   - Next.js note: use project `eslint` scripts instead of `next lint`
5. Keep output concise and contract-focused. If contracts change, update docs/ADRs in the same change.
