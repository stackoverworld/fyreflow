import type { Point } from "../../../types";
import { clamp } from "../../../useNodeLayout";

export function pointToOrthogonalSegmentDistance(point: Point, start: Point, end: Point): number {
  if (start.x === end.x) {
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const clampedY = clamp(point.y, minY, maxY);
    return Math.hypot(point.x - start.x, point.y - clampedY);
  }

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const clampedX = clamp(point.x, minX, maxX);
  return Math.hypot(point.x - clampedX, point.y - start.y);
}

export function routeDistanceToPoint(route: Point[], point: Point): number {
  if (route.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (route.length === 1) {
    return Math.hypot(route[0].x - point.x, route[0].y - point.y);
  }

  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < route.length; index += 1) {
    const distance = pointToOrthogonalSegmentDistance(point, route[index - 1], route[index]);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

