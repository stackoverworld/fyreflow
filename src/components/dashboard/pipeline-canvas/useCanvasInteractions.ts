import { useCallback, type RefObject } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Point, ViewportState } from "./types";
import { clamp } from "./useNodeLayout";

export const ZOOM_MIN = 0.45;
export const ZOOM_MAX = 1.8;

export function useCanvasPointTransform(
  canvasRef: RefObject<HTMLDivElement | null>,
  viewport: ViewportState
): {
  toCanvasPoint: (event: { clientX: number; clientY: number }) => Point | null;
  toWorldPoint: (event: { clientX: number; clientY: number }) => Point | null;
} {
  const toCanvasPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }, [canvasRef]);

  const toWorldPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvasPoint = toCanvasPoint(event);
      if (!canvasPoint) {
        return null;
      }

      return {
        x: (canvasPoint.x - viewport.x) / viewport.scale,
        y: (canvasPoint.y - viewport.y) / viewport.scale
      };
    },
    [toCanvasPoint, viewport.scale, viewport.x, viewport.y]
  );

  return { toCanvasPoint, toWorldPoint };
}

export function useCanvasWheelZoom(
  canvasRef: RefObject<HTMLDivElement | null>,
  setViewport: Dispatch<SetStateAction<ViewportState>>
): (event: WheelEvent) => void {
  return useCallback(
    (event: WheelEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      const canvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };

      const zoomFactor = Math.exp(-event.deltaY * 0.001);

      setViewport((current) => {
        const nextScale = clamp(current.scale * zoomFactor, ZOOM_MIN, ZOOM_MAX);
        if (nextScale === current.scale) {
          return current;
        }

        const worldX = (canvasPoint.x - current.x) / current.scale;
        const worldY = (canvasPoint.y - current.y) / current.scale;

        return {
          x: canvasPoint.x - worldX * nextScale,
          y: canvasPoint.y - worldY * nextScale,
          scale: nextScale
        };
      });
    },
    [setViewport]
  );
}
