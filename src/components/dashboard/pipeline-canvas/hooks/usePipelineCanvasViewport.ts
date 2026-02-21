import { type UseCanvasViewportOptions, type UseCanvasViewportResult, useCanvasViewport } from "./useCanvasViewport";

export type { UseCanvasViewportOptions, UseCanvasViewportResult };

export function usePipelineCanvasViewport(options: UseCanvasViewportOptions): UseCanvasViewportResult {
  return useCanvasViewport(options);
}

