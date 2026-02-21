import { useEffect, useState } from "react";
import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { useCanvasPointTransform, useCanvasWheelZoom } from "../useCanvasInteractions";
import type { PanState, Point, ViewportState } from "../types";

export interface UseCanvasViewportOptions {
  canvasRef: RefObject<HTMLDivElement | null>;
  initialViewport?: ViewportState;
}

export interface UseCanvasViewportResult {
  viewport: ViewportState;
  setViewport: Dispatch<SetStateAction<ViewportState>>;
  panState: PanState | null;
  setPanState: Dispatch<SetStateAction<PanState | null>>;
  toCanvasPoint: (event: { clientX: number; clientY: number }) => Point | null;
  toWorldPoint: (event: { clientX: number; clientY: number }) => Point | null;
}

const DEFAULT_VIEWPORT: ViewportState = { x: 80, y: 80, scale: 1 };

export function useCanvasViewport({
  canvasRef,
  initialViewport = DEFAULT_VIEWPORT
}: UseCanvasViewportOptions): UseCanvasViewportResult {
  const [viewport, setViewport] = useState<ViewportState>(initialViewport);
  const [panState, setPanState] = useState<PanState | null>(null);
  const { toCanvasPoint, toWorldPoint } = useCanvasPointTransform(canvasRef, viewport);
  const onCanvasWheel = useCanvasWheelZoom(canvasRef, setViewport);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onCanvasWheel);
    };
  }, [canvasRef, onCanvasWheel]);

  return {
    viewport,
    setViewport,
    panState,
    setPanState,
    toCanvasPoint,
    toWorldPoint
  };
}
