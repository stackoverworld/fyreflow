## Quality Gates
- `bun install --frozen-lockfile`
- `npx tsc --noEmit`
- `vitest run`
- `vite build`
- `npm run test:e2e`
- `scripts/verify.sh runs the gates in the same order locally and in CI.`
