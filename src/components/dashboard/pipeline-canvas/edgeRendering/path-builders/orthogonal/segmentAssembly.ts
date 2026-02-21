import type {
  AnchorSide,
  CanonicalRouteCandidate,
  FlowNode,
  Point,
  Rect,
  RouteAxis
} from "../../../types";
import {
  AXIS_ACTIVATION_DISTANCE,
  HORIZONTAL_AXIS_BIAS,
  MANUAL_LANE_MIN_GAP
} from "../../styles";
import {
  FALLBACK_BEND_PENALTY,
  FALLBACK_INTERSECTION_PENALTY,
  FALLBACK_OPPOSITE_PAIR_BONUS,
  FALLBACK_SHORT_SEGMENT_PENALTY,
  FALLBACK_SHORT_SEGMENT_THRESHOLD,
  FALLBACK_SIDE_ALIGNMENT_PENALTY_WEIGHT,
  MANUAL_BEND_PENALTY,
  MANUAL_INTERSECTION_PENALTY,
  MANUAL_WAYPOINT_PENALTY
} from "./constants";
import { normalizeRoute, rectCenter, routeIntersections, routeLength, sideCenterPoint } from "../../geometry";
import {
  canonicalRouteScore,
  dominantAxisPenalty,
  endpointDirectionPenalty,
  routeBacktrackPenalty,
  routeShortSegmentPenalty,
  sideFacingPenalty,
  sidePenalty,
  axisReversalPenalty
} from "../geometry";
import {
  oppositeSides,
  routeDistanceToPoint
} from "../geometry";
import {
  buildCanonicalRouteCandidates,
  buildDefaultFallbackRoute,
  buildFallbackRouteCandidates,
  buildManualWaypointRouteCandidates,
  FallbackRouteCandidate,
} from "./segments";

export function buildManualWaypointRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  manualWaypoint: Point,
  obstacles: Rect[]
): Point[] {
  const candidateSet = buildManualWaypointRouteCandidates(sourceNode, targetNode, manualWaypoint);
  let bestRoute = normalizeRoute(candidateSet.routes[0]);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const route of candidateSet.routes) {
    const normalizedRoute = normalizeRoute(route);
    const score = scoreManualRoute(
      normalizedRoute,
      obstacles,
      candidateSet.sourceSide,
      candidateSet.targetSide,
      candidateSet.stabilizedWaypoint
    );

    if (score < bestScore) {
      bestScore = score;
      bestRoute = normalizedRoute;
    }
  }

  return bestRoute;
}

export function buildDominantAxisCanonicalRoute(
  sourceRect: Rect,
  targetRect: Rect,
  edgeIndex: number,
  obstacles: Rect[],
  previousAxis: RouteAxis | null
): { route: Point[]; axis: RouteAxis } | null {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = Math.abs(targetCenter.x - sourceCenter.x);
  const dy = Math.abs(targetCenter.y - sourceCenter.y);

  if (dx < AXIS_ACTIVATION_DISTANCE && dy < AXIS_ACTIVATION_DISTANCE) {
    return null;
  }

  const candidates = buildCanonicalRouteCandidates(sourceRect, targetRect, edgeIndex);
  const nonIntersectingCandidates = candidates.filter((candidate) => routeIntersections(candidate.route, obstacles) === 0);
  const candidatePool = nonIntersectingCandidates.length > 0 ? nonIntersectingCandidates : candidates;
  let best: CanonicalRouteCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidatePool) {
    const score = canonicalRouteScore(candidate, sourceRect, targetRect, obstacles, previousAxis);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best ? { route: best.route, axis: best.axis } : null;
}

export function buildFallbackRoute(
  sourceRect: Rect,
  targetRect: Rect,
  sourceCenter: Point,
  targetCenter: Point,
  edgeIndex: number,
  preferredSource: AnchorSide,
  preferredTarget: AnchorSide,
  obstacles: Rect[]
): { route: Point[]; axis: RouteAxis } {
  let bestRoute = buildDefaultFallbackRoute(sourceRect, targetRect);
  let bestScore = Number.POSITIVE_INFINITY;
  const candidates = buildFallbackRouteCandidates(sourceRect, targetRect, sourceCenter, targetCenter, edgeIndex, obstacles);
  const nonIntersectingCandidates = candidates.filter((candidate) => routeIntersections(candidate.route, obstacles) === 0);
  const candidatePool = nonIntersectingCandidates.length > 0 ? nonIntersectingCandidates : candidates;

  for (const candidate of candidatePool) {
    const score = scoreFallbackRoute(candidate, preferredSource, preferredTarget, sourceRect, targetRect, obstacles);
    if (score < bestScore) {
      bestScore = score;
      bestRoute = candidate.route;
    }
  }

  const fallbackAxis: RouteAxis =
    Math.abs(targetCenter.x - sourceCenter.x) * HORIZONTAL_AXIS_BIAS >= Math.abs(targetCenter.y - sourceCenter.y)
      ? "horizontal"
      : "vertical";

  return {
    route: bestRoute,
    axis: fallbackAxis
  };
}

function scoreManualRoute(
  route: Point[],
  obstacles: Rect[],
  sourceSide: AnchorSide,
  targetSide: AnchorSide,
  stabilizedWaypoint: Point
): number {
  const intersections = routeIntersections(route, obstacles);
  const bends = Math.max(route.length - 2, 0);
  const directionPenalty = endpointDirectionPenalty(route, sourceSide, targetSide);
  const reversalPenalty = axisReversalPenalty(route, sourceSide, targetSide) + routeBacktrackPenalty(route);
  const shortSegmentPenalty = routeShortSegmentPenalty(route, MANUAL_LANE_MIN_GAP);
  const waypointPenalty = routeDistanceToPoint(route, stabilizedWaypoint) * MANUAL_WAYPOINT_PENALTY;

  return (
    intersections * MANUAL_INTERSECTION_PENALTY +
    bends * MANUAL_BEND_PENALTY +
    directionPenalty +
    reversalPenalty +
    shortSegmentPenalty +
    waypointPenalty +
    routeLength(route)
  );
}

function scoreFallbackRoute(
  candidate: FallbackRouteCandidate,
  preferredSource: AnchorSide,
  preferredTarget: AnchorSide,
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: Rect[]
): number {
  const route = candidate.route;
  const sourceSide = candidate.sourceSide;
  const targetSide = candidate.targetSide;
  const intersections = routeIntersections(route, obstacles);
  const bends = Math.max(route.length - 2, 0);
  const sideScore = sidePenalty(sourceSide, preferredSource) + sidePenalty(targetSide, preferredTarget);
  const oppositePairBonus = oppositeSides(sourceSide, targetSide) ? FALLBACK_OPPOSITE_PAIR_BONUS : 0;
  const facingPenalty = sideFacingPenalty(sourceRect, targetRect, sourceSide, targetSide);
  const axisPenalty = dominantAxisPenalty(sourceRect, targetRect, sourceSide, targetSide);
  const last = route[route.length - 1];
  const beforeLast = route[route.length - 2];
  const first = route[0];
  const second = route[1];
  const finalSegmentLength = beforeLast && last ? Math.abs(last.x - beforeLast.x) + Math.abs(last.y - beforeLast.y) : 0;
  const firstSegmentLength = first && second ? Math.abs(second.x - first.x) + Math.abs(second.y - first.y) : 0;
  const shortEntryPenalty = firstSegmentLength < FALLBACK_SHORT_SEGMENT_THRESHOLD
    ? (FALLBACK_SHORT_SEGMENT_THRESHOLD - firstSegmentLength) * FALLBACK_SHORT_SEGMENT_PENALTY
    : 0;
  const shortExitPenalty = finalSegmentLength < FALLBACK_SHORT_SEGMENT_THRESHOLD
    ? (FALLBACK_SHORT_SEGMENT_THRESHOLD - finalSegmentLength) * FALLBACK_SHORT_SEGMENT_PENALTY
    : 0;
  const directionPenalty = endpointDirectionPenalty(route, sourceSide, targetSide);
  const reversalPenalty = axisReversalPenalty(route, sourceSide, targetSide);
  const sourceCenterAnchor = sideCenterPoint(sourceRect, sourceSide);
  const targetCenterAnchor = sideCenterPoint(targetRect, targetSide);
  const centerBiasPenalty =
    (Math.abs(first.x - sourceCenterAnchor.x) + Math.abs(first.y - sourceCenterAnchor.y)) * 70 +
    (Math.abs(last.x - targetCenterAnchor.x) + Math.abs(last.y - targetCenterAnchor.y)) * 70;

  return (
    intersections * FALLBACK_INTERSECTION_PENALTY +
    (sideScore + oppositePairBonus) * FALLBACK_SIDE_ALIGNMENT_PENALTY_WEIGHT +
    centerBiasPenalty +
    facingPenalty +
    axisPenalty +
    shortEntryPenalty +
    shortExitPenalty +
    directionPenalty +
    reversalPenalty +
    bends * FALLBACK_BEND_PENALTY +
    routeLength(route)
  );
}
