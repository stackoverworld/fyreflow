import type { Point } from "../../../types";
import { normalizeRoute } from "../../geometry";

export type CandidateWithRoute = { route: Point[] };

export function normalizeRoutePoints(points: Point[]): Point[] {
  return normalizeRoute(points);
}

export function normalizeRouteCandidateCollection<T extends CandidateWithRoute>(
  candidates: T[]
): Array<T> {
  return candidates.map((candidate) => ({
    ...candidate,
    route: normalizeRoute(candidate.route)
  }));
}
