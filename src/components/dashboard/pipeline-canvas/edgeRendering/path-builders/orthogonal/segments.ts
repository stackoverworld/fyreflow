import type { AnchorSide, CanonicalRouteCandidate, FlowNode, OrchestratorLaneMeta, Point, Rect, ReciprocalLaneMeta } from "../../../types";
import {
  buildCanonicalRouteCandidatePoints,
  buildDefaultFallbackRoutePoints,
  buildFallbackRouteCandidatePoints,
  buildManualWaypointRouteCandidatePoints,
  buildOrchestratorBusRoutePoints,
  buildReciprocalPairRoutePoints
} from "./segmentPrimitives";
import {
  normalizeRouteCandidateCollection,
  normalizeRoutePoints
} from "./segmentNormalization";

export interface FallbackRouteCandidate {
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
  route: Point[];
}

export interface ManualWaypointCandidateSet {
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
  routes: Point[][];
  stabilizedWaypoint: Point;
}

export function buildOrchestratorBusRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  orchestratorLane: OrchestratorLaneMeta
): Point[] | null {
  const route = buildOrchestratorBusRoutePoints(sourceNode, targetNode, orchestratorLane);
  return route ? normalizeRoutePoints(route) : null;
}

export function buildReciprocalPairRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  reciprocalLane: ReciprocalLaneMeta
): Point[] {
  return normalizeRoutePoints(buildReciprocalPairRoutePoints(sourceNode, targetNode, reciprocalLane));
}

export function buildManualWaypointRouteCandidates(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  manualWaypoint: Point
): ManualWaypointCandidateSet {
  const candidateSet = buildManualWaypointRouteCandidatePoints(sourceNode, targetNode, manualWaypoint);
  return candidateSet;
}

export function buildFallbackRouteCandidates(
  sourceRect: Rect,
  targetRect: Rect,
  sourceCenter: Point,
  targetCenter: Point,
  edgeIndex: number,
  obstacles: Rect[]
): FallbackRouteCandidate[] {
  return normalizeRouteCandidateCollection(
    buildFallbackRouteCandidatePoints(sourceRect, targetRect, sourceCenter, targetCenter, edgeIndex, obstacles)
  );
}

export function buildDefaultFallbackRoute(sourceRect: Rect, targetRect: Rect): Point[] {
  return normalizeRoutePoints(buildDefaultFallbackRoutePoints(sourceRect, targetRect));
}

export function buildCanonicalRouteCandidates(
  sourceRect: Rect,
  targetRect: Rect,
  edgeIndex: number
): CanonicalRouteCandidate[] {
  return normalizeRouteCandidateCollection(buildCanonicalRouteCandidatePoints(sourceRect, targetRect, edgeIndex));
}
