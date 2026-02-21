import type { Point } from "../types";
import { routeLength } from "./geometry";

export function routeMidpoint(points: Point[]): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }

  const total = routeLength(points);
  if (total <= 0) {
    return points[0];
  }

  const half = total / 2;
  let walked = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (walked + segment < half) {
      walked += segment;
      continue;
    }

    const remain = half - walked;
    if (start.x === end.x) {
      const sign = end.y >= start.y ? 1 : -1;
      return {
        x: start.x,
        y: start.y + sign * remain
      };
    }

    const sign = end.x >= start.x ? 1 : -1;
    return {
      x: start.x + sign * remain,
      y: start.y
    };
  }

  return points[points.length - 1];
}
