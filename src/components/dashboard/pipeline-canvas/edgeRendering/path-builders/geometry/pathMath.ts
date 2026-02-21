import type { Point } from "../../../types";
import { CANONICAL_APPROACH_MIN } from "../../styles";

export function routeBacktrackPenalty(route: Point[]): number {
  if (route.length < 3) {
    return 0;
  }

  let horizontalSign = 0;
  let verticalSign = 0;
  let penalty = 0;

  for (let index = 1; index < route.length; index += 1) {
    const dx = route[index].x - route[index - 1].x;
    const dy = route[index].y - route[index - 1].y;

    if (dx !== 0) {
      const sign = dx > 0 ? 1 : -1;
      if (horizontalSign !== 0 && horizontalSign !== sign) {
        penalty += 26000;
      }
      horizontalSign = sign;
    }

    if (dy !== 0) {
      const sign = dy > 0 ? 1 : -1;
      if (verticalSign !== 0 && verticalSign !== sign) {
        penalty += 26000;
      }
      verticalSign = sign;
    }
  }

  return penalty;
}

export function routeShortSegmentPenalty(route: Point[], minLength: number): number {
  if (route.length < 2) {
    return 0;
  }

  let penalty = 0;
  for (let index = 1; index < route.length; index += 1) {
    const length = segmentLength(route[index - 1], route[index]);
    const endpointSegment = index === 1 || index === route.length - 1;
    const threshold = endpointSegment ? Math.max(CANONICAL_APPROACH_MIN, minLength) : minLength;
    if (length < threshold) {
      penalty += (threshold - length) * (endpointSegment ? 1800 : 1050);
    }
  }

  return penalty;
}

export function segmentLength(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function candidateSegmentPenalty(route: Point[]): number {
  if (route.length < 2) {
    return 0;
  }

  const first = route[0];
  const second = route[1];
  const beforeLast = route[route.length - 2];
  const last = route[route.length - 1];
  const exitLength = segmentLength(first, second);
  const entryLength = segmentLength(beforeLast, last);
  const shortExitPenalty = exitLength < CANONICAL_APPROACH_MIN ? (CANONICAL_APPROACH_MIN - exitLength) * 1400 : 0;
  const shortEntryPenalty = entryLength < CANONICAL_APPROACH_MIN ? (CANONICAL_APPROACH_MIN - entryLength) * 1400 : 0;
  return shortExitPenalty + shortEntryPenalty;
}

