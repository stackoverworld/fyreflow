# App State Module Boundaries

`useAppStateController.ts` is the composition root for dashboard app-state APIs.
It assembles state, derived values, handlers, and runtime effects into the
public controller contract used by dashboard/shell components.

Supporting modules isolate distinct responsibilities:

- `controller/useAppStateController/state.ts`: state containers, refs, and
  draft history plumbing.
- `controller/useAppStateController/derivedState.ts`: memoized selector-derived
  view state and schedule-plan signature computation.
- `controller/useAppStateController/handlers.ts`: command handlers for pipeline,
  runtime execution, and config management workflows.
- `controller/useAppStateController/runtime.ts`: side-effect lifecycle wiring
  (initial load, autosave, polling, notifications, plan refresh).
- `appStateRunController.ts` and `appStateConfigMutations.ts`: reusable
  service-layer operations invoked by handlers.

Boundary rules:

- Keep selector-heavy derived calculations in `derivedState.ts`.
- Keep side-effect workflows in `runtime.ts` or operation-specific helpers.
- Keep `useAppStateController` focused on orchestration and public return shape.
