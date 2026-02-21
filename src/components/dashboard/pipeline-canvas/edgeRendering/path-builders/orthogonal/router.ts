import type {
  FlowNode,
  OrchestratorLaneMeta,
  Point,
  Rect,
  ReciprocalLaneMeta,
  RouteAxis
} from "../../../types";
import { expandRect, nodeRect } from "../../../useNodeLayout";
import { DIRECT_AXIS_TOLERANCE, NEAR_DIRECT_GAP } from "../../styles";
import {
  preferredSide,
  normalizeRoute,
  rectCenter,
  routeAxisFromEndpoints,
  routeIntersections,
  sideCenterPoint
} from "../../geometry";
import { oppositeSides } from "../geometry";
import {
  buildDominantAxisCanonicalRoute,
  buildFallbackRoute,
  buildManualWaypointRoute as buildManualWaypointRouteInternal
} from "./segmentAssembly";
import {
  buildOrchestratorBusRoute as buildOrchestratorBusRouteInternal,
  buildReciprocalPairRoute as buildReciprocalPairRouteInternal
} from "./segments";

const ROUTING_OBSTACLE_PADDING = 18;

export function buildOrchestratorBusRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  orchestratorLane: OrchestratorLaneMeta
): Point[] | null {
  return buildOrchestratorBusRouteInternal(sourceNode, targetNode, orchestratorLane);
}

export function buildReciprocalPairRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  reciprocalLane: ReciprocalLaneMeta
): Point[] {
  return buildReciprocalPairRouteInternal(sourceNode, targetNode, reciprocalLane);
}

export function buildManualWaypointRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  manualWaypoint: Point,
  obstacles: Rect[]
): Point[] {
  return buildManualWaypointRouteInternal(sourceNode, targetNode, manualWaypoint, obstacles);
}

export function buildEdgeRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  allNodes: FlowNode[],
  edgeIndex: number,
  previousAxis: RouteAxis | null,
  orchestratorLane: OrchestratorLaneMeta | null,
  reciprocalLane: ReciprocalLaneMeta | null,
  manualWaypoint: Point | null
): { route: Point[]; axis: RouteAxis | null } {
  const sourceRect = nodeRect(sourceNode);
  const targetRect = nodeRect(targetNode);
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const obstacles = allNodes
    .filter((node) => node.id !== sourceNode.id && node.id !== targetNode.id)
    .map((node) => expandRect(nodeRect(node), ROUTING_OBSTACLE_PADDING));

  if (manualWaypoint) {
    const route = buildManualWaypointRoute(sourceNode, targetNode, manualWaypoint, obstacles);
    return {
      route,
      axis: routeAxisFromEndpoints(route)
    };
  }

  if (reciprocalLane) {
    const route = buildReciprocalPairRoute(sourceNode, targetNode, reciprocalLane);
    if (routeIntersections(route, obstacles) === 0) {
      return {
        route,
        axis: routeAxisFromEndpoints(route)
      };
    }
  }

  if (orchestratorLane) {
    const route = buildOrchestratorBusRoute(sourceNode, targetNode, orchestratorLane);
    if (route && routeIntersections(route, obstacles) === 0) {
      return {
        route,
        axis: routeAxisFromEndpoints(route)
      };
    }
  }

  const canonical = buildDominantAxisCanonicalRoute(sourceRect, targetRect, edgeIndex, obstacles, previousAxis);
  if (canonical && routeIntersections(canonical.route, obstacles) === 0) {
    return canonical;
  }

  const preferredSource = preferredSide(sourceRect, targetRect);
  const preferredTarget = preferredSide(targetRect, sourceRect);
  const preferredStart = sideCenterPoint(sourceRect, preferredSource);
  const preferredEnd = sideCenterPoint(targetRect, preferredTarget);

  if (oppositeSides(preferredSource, preferredTarget)) {
    const directPreferred = normalizeRoute([preferredStart, preferredEnd]);
    const verticalPair = preferredSource === "top" || preferredSource === "bottom";
    const nearEnough = verticalPair
      ? Math.abs(preferredStart.y - preferredEnd.y) <= NEAR_DIRECT_GAP
      : Math.abs(preferredStart.x - preferredEnd.x) <= NEAR_DIRECT_GAP;
    const axisAligned = verticalPair
      ? Math.abs(preferredStart.x - preferredEnd.x) <= DIRECT_AXIS_TOLERANCE
      : Math.abs(preferredStart.y - preferredEnd.y) <= DIRECT_AXIS_TOLERANCE;

    if (nearEnough && axisAligned && routeIntersections(directPreferred, obstacles) === 0) {
      return {
        route: directPreferred,
        axis: verticalPair ? "vertical" : "horizontal"
      };
    }
  }

  const fallback = buildFallbackRoute(
    sourceRect,
    targetRect,
    sourceCenter,
    targetCenter,
    edgeIndex,
    preferredSource,
    preferredTarget,
    obstacles
  );

  return fallback;
}
