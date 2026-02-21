import type { CanonicalRouteCandidate, Point, Rect, RouteAxis } from "../../../types";
import {
  AXIS_SWITCH_HYSTERESIS,
  CANONICAL_BALANCE_WEIGHT,
  HORIZONTAL_AXIS_BIAS
} from "../../styles";
import { preferredSide, rectCenter, routeIntersections, routeLength, sideCenterPoint } from "../../geometry";
import { dominantAxisPenalty, endpointDirectionPenalty, sideFacingPenalty, sidePenalty } from "./primitives";
import { candidateSegmentPenalty } from "./pathMath";

export function routeBalancePenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  if (candidate.route.length < 4) {
    return 0;
  }

  if (candidate.axis === "horizontal") {
    const start = sideCenterPoint(sourceRect, candidate.sourceSide);
    const end = sideCenterPoint(targetRect, candidate.targetSide);
    const preferredBendX = (start.x + end.x) / 2;
    const bendX = candidate.route[1]?.x ?? preferredBendX;
    return Math.abs(bendX - preferredBendX) * CANONICAL_BALANCE_WEIGHT;
  }

  const start = sideCenterPoint(sourceRect, candidate.sourceSide);
  const end = sideCenterPoint(targetRect, candidate.targetSide);
  const preferredBendY = (start.y + end.y) / 2;
  const bendY = candidate.route[1]?.y ?? preferredBendY;
  return Math.abs(bendY - preferredBendY) * CANONICAL_BALANCE_WEIGHT;
}

export function canonicalFacingPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  return sideFacingPenalty(sourceRect, targetRect, candidate.sourceSide, candidate.targetSide);
}

export function canonicalEndpointPenalty(candidate: CanonicalRouteCandidate): number {
  return endpointDirectionPenalty(candidate.route, candidate.sourceSide, candidate.targetSide);
}

export function canonicalAxisPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  return dominantAxisPenalty(sourceRect, targetRect, candidate.sourceSide, candidate.targetSide);
}

export function canonicalSidePenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  const preferredSource = preferredSide(sourceRect, targetRect);
  const preferredTarget = preferredSide(targetRect, sourceRect);
  return sidePenalty(candidate.sourceSide, preferredSource) + sidePenalty(candidate.targetSide, preferredTarget);
}

export function canonicalCenterBiasPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  const first = candidate.route[0];
  const last = candidate.route[candidate.route.length - 1];
  const sourceCenterAnchor = sideCenterPoint(sourceRect, candidate.sourceSide);
  const targetCenterAnchor = sideCenterPoint(targetRect, candidate.targetSide);
  return (
    (Math.abs(first.x - sourceCenterAnchor.x) + Math.abs(first.y - sourceCenterAnchor.y)) * 25 +
    (Math.abs(last.x - targetCenterAnchor.x) + Math.abs(last.y - targetCenterAnchor.y)) * 25
  );
}

export function canonicalAxisFitPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = Math.abs(targetCenter.x - sourceCenter.x);
  const dy = Math.abs(targetCenter.y - sourceCenter.y);
  return candidate.axis === "horizontal"
    ? Math.max(0, dy - dx * HORIZONTAL_AXIS_BIAS) * 2
    : Math.max(0, dx * HORIZONTAL_AXIS_BIAS - dy) * 2;
}

export function canonicalSwitchPenalty(candidate: CanonicalRouteCandidate, previousAxis: RouteAxis | null): number {
  return previousAxis && previousAxis !== candidate.axis ? AXIS_SWITCH_HYSTERESIS * 5 : 0;
}

export function canonicalDefaultBiasPenalty(candidate: CanonicalRouteCandidate, previousAxis: RouteAxis | null): number {
  return !previousAxis && candidate.axis === "vertical" ? 42 : 0;
}

export function canonicalIntersectionPenalty(candidate: CanonicalRouteCandidate, obstacles: Rect[]): number {
  return routeIntersections(candidate.route, obstacles) * 140000;
}

export function canonicalBendPenalty(candidate: CanonicalRouteCandidate): number {
  const bends = Math.max(candidate.route.length - 2, 0);
  return bends * 420;
}

export function canonicalLengthPenalty(candidate: CanonicalRouteCandidate): number {
  return routeLength(candidate.route);
}

export function canonicalRouteScore(
  candidate: CanonicalRouteCandidate,
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: Rect[],
  previousAxis: RouteAxis | null
): number {
  return (
    canonicalIntersectionPenalty(candidate, obstacles) +
    canonicalBendPenalty(candidate) +
    canonicalLengthPenalty(candidate) +
    canonicalCenterBiasPenalty(candidate, sourceRect, targetRect) +
    canonicalAxisFitPenalty(candidate, sourceRect, targetRect) +
    canonicalSwitchPenalty(candidate, previousAxis) +
    canonicalDefaultBiasPenalty(candidate, previousAxis) +
    canonicalSidePenalty(candidate, sourceRect, targetRect) * 40 +
    canonicalAxisPenalty(candidate, sourceRect, targetRect) +
    canonicalFacingPenalty(candidate, sourceRect, targetRect) +
    canonicalEndpointPenalty(candidate) +
    candidateSegmentPenalty(candidate.route) +
    routeBalancePenalty(candidate, sourceRect, targetRect)
  );
}

export function uniquePoints(points: Point[]): Point[] {
  const uniq: Point[] = [];
  for (const point of points) {
    if (uniq.some((entry) => entry.x === point.x && entry.y === point.y)) {
      continue;
    }
    uniq.push(point);
  }
  return uniq;
}

export function uniqueNumbers(values: number[]): number[] {
  const rounded = values.map((value) => Math.round(value));
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of rounded) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
