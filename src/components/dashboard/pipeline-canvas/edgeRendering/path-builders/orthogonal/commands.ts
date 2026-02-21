import type { Point } from "../../../types";
import { routePath } from "../../geometry";

export function serializeOrthogonalCommands(points: Point[], requestedCornerRadius?: number): string {
  return routePath(points, requestedCornerRadius);
}
