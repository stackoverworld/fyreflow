import type { Point } from "../../types";
import { CORNER_RADIUS } from "../styles";
import { routePath } from "../geometry";

export function buildBezierPath(points: Point[], requestedCornerRadius: number = CORNER_RADIUS): string {
  return routePath(points, requestedCornerRadius);
}
