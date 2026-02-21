import type { Point } from "./types";

const ROUTE_HISTORY_LIMIT = 80;

export function cloneManualRoutePoints(points: Record<string, Point>): Record<string, Point> {
  return Object.fromEntries(
    Object.entries(points).map(([linkId, point]) => [linkId, { x: point.x, y: point.y }])
  );
}

export function manualRoutePointsEqual(left: Record<string, Point>, right: Record<string, Point>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    const leftPoint = left[key];
    const rightPoint = right[key];
    if (!leftPoint || !rightPoint) {
      return false;
    }

    if (leftPoint.x !== rightPoint.x || leftPoint.y !== rightPoint.y) {
      return false;
    }
  }

  return true;
}

export function pushRouteHistorySnapshot(
  stack: Record<string, Point>[],
  snapshot: Record<string, Point>
): Record<string, Point>[] {
  if (stack.length >= ROUTE_HISTORY_LIMIT) {
    return [...stack.slice(stack.length - ROUTE_HISTORY_LIMIT + 1), cloneManualRoutePoints(snapshot)];
  }

  return [...stack, cloneManualRoutePoints(snapshot)];
}

export function isMultiSelectModifier(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}
