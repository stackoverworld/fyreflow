# Canvas Selection Boundaries

`useCanvasSelection.ts` is the public hook that wires selection-related state
for pipeline canvas interactions.

Supporting modules under this folder:

- `pointerHandlers.ts`: pointer move/up handler construction for drag, pan,
  connect, marquee, and manual-route finalization semantics.
- `math.ts`: pure geometry/selection calculations.
- `keyboard.ts`: keyboard shortcut behavior for selection and route undo/redo.
- `types.ts`: public hook option/result contracts.

Boundary rules:

- Keep browser event sequencing in `pointerHandlers.ts`.
- Keep deterministic calculations pure and colocated in `math.ts`.
- Keep `useCanvasSelection.ts` focused on state composition and public API.
