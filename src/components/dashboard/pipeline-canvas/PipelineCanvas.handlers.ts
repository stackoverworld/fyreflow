import type { MutableRefObject } from "react";
import {
  CORNER_RADIUS,
  MANUAL_CORNER_RADIUS,
  buildEdgeRoute,
  edgeInvolvesOrchestrator,
  edgeStrokeDasharray,
  edgeVisual,
  normalizeRoute,
  routeAxisFromEndpoints,
  routeIntersections,
  routeLength,
  routeMidpoint,
  routePath
} from "./edgeRendering";
import { expandRect, nodeRect } from "./useNodeLayout";
import { type FlowLink, type FlowNode, type OrchestratorLaneMeta, type Point, type RenderedLink, type ReciprocalLaneMeta, type RouteAxis } from "./types";

const SMART_ROUTE_ENDPOINT_MAX_DISTANCE = 14;
const SMART_ROUTE_OBSTACLE_PADDING = 18;
const SMART_ROUTE_CORRIDOR_MARGIN = 72;
const SMART_ROUTE_INTERSECTION_PENALTY = 90000;
const SMART_ROUTE_BEND_PENALTY = 420;
const SMART_ROUTE_DETOUR_PENALTY = 8;
const SMART_ROUTE_OVERSHOOT_PENALTY = 220;
const ROUTE_OVERLAP_PENALTY_PER_PIXEL = 180;
const ROUTE_LANE_SEPARATION_STEP = 20;
const ROUTE_LANE_SEPARATION_LEVELS = 6;
const ROUTE_LANE_SEPARATION_TRIGGER = 12;
const ROUTE_LANE_SEPARATION_MIN_BRIDGE = 27;
const ROUTE_LANE_SEPARATION_MIN_LEG = 12;
const ROUTE_LANE_SEPARATION_MAX_LEG = 20;
const ROUTE_EDGE_INDEX_VARIANTS = [0, 1, 2, 3, 4, 5] as const;

function pointDistanceToNodePerimeter(point: Point, node: FlowNode): number {
  const rect = nodeRect(node);
  const outsideDx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
  const outsideDy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;

  if (outsideDx > 0 || outsideDy > 0) {
    return Math.hypot(outsideDx, outsideDy);
  }

  const toLeft = Math.abs(point.x - rect.left);
  const toRight = Math.abs(rect.right - point.x);
  const toTop = Math.abs(point.y - rect.top);
  const toBottom = Math.abs(rect.bottom - point.y);
  return Math.min(toLeft, toRight, toTop, toBottom);
}

function smartRouteMatchesNodes(route: Point[], sourceNode: FlowNode, targetNode: FlowNode): boolean {
  const start = route[0];
  const end = route[route.length - 1];
  if (!start || !end) {
    return false;
  }

  return (
    pointDistanceToNodePerimeter(start, sourceNode) <= SMART_ROUTE_ENDPOINT_MAX_DISTANCE &&
    pointDistanceToNodePerimeter(end, targetNode) <= SMART_ROUTE_ENDPOINT_MAX_DISTANCE
  );
}

function routeBounds(route: Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of route) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
}

function routeQualityScore(route: Point[], sourceNode: FlowNode, targetNode: FlowNode, allNodes: FlowNode[]): number {
  const sourceRect = nodeRect(sourceNode);
  const targetRect = nodeRect(targetNode);
  const sourceCenterX = (sourceRect.left + sourceRect.right) / 2;
  const sourceCenterY = (sourceRect.top + sourceRect.bottom) / 2;
  const targetCenterX = (targetRect.left + targetRect.right) / 2;
  const targetCenterY = (targetRect.top + targetRect.bottom) / 2;
  const baselineLength = Math.abs(targetCenterX - sourceCenterX) + Math.abs(targetCenterY - sourceCenterY);
  const pathLength = routeLength(route);
  const detourLength = Math.max(0, pathLength - baselineLength);
  const bends = Math.max(route.length - 2, 0);
  const obstacles = allNodes
    .filter((node) => node.id !== sourceNode.id && node.id !== targetNode.id)
    .map((node) => expandRect(nodeRect(node), SMART_ROUTE_OBSTACLE_PADDING));
  const intersections = routeIntersections(route, obstacles);
  const bounds = routeBounds(route);
  const corridorLeft = Math.min(sourceRect.left, targetRect.left) - SMART_ROUTE_CORRIDOR_MARGIN;
  const corridorRight = Math.max(sourceRect.right, targetRect.right) + SMART_ROUTE_CORRIDOR_MARGIN;
  const corridorTop = Math.min(sourceRect.top, targetRect.top) - SMART_ROUTE_CORRIDOR_MARGIN;
  const corridorBottom = Math.max(sourceRect.bottom, targetRect.bottom) + SMART_ROUTE_CORRIDOR_MARGIN;
  const overshoot =
    Math.max(0, corridorLeft - bounds.minX) +
    Math.max(0, bounds.maxX - corridorRight) +
    Math.max(0, corridorTop - bounds.minY) +
    Math.max(0, bounds.maxY - corridorBottom);

  return (
    intersections * SMART_ROUTE_INTERSECTION_PENALTY +
    bends * SMART_ROUTE_BEND_PENALTY +
    pathLength +
    detourLength * SMART_ROUTE_DETOUR_PENALTY +
    overshoot * SMART_ROUTE_OVERSHOOT_PENALTY
  );
}

function rangeOverlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const left = Math.max(Math.min(aStart, aEnd), Math.min(bStart, bEnd));
  const right = Math.min(Math.max(aStart, aEnd), Math.max(bStart, bEnd));
  return Math.max(0, right - left);
}

function segmentSharedLength(aStart: Point, aEnd: Point, bStart: Point, bEnd: Point): number {
  const aVertical = aStart.x === aEnd.x;
  const bVertical = bStart.x === bEnd.x;
  if (aVertical && bVertical) {
    if (aStart.x !== bStart.x) {
      return 0;
    }
    return rangeOverlapLength(aStart.y, aEnd.y, bStart.y, bEnd.y);
  }

  const aHorizontal = aStart.y === aEnd.y;
  const bHorizontal = bStart.y === bEnd.y;
  if (aHorizontal && bHorizontal) {
    if (aStart.y !== bStart.y) {
      return 0;
    }
    return rangeOverlapLength(aStart.x, aEnd.x, bStart.x, bEnd.x);
  }

  return 0;
}

function routeSharedLength(leftRoute: Point[], rightRoute: Point[]): number {
  let shared = 0;
  for (let leftIndex = 1; leftIndex < leftRoute.length; leftIndex += 1) {
    const leftStart = leftRoute[leftIndex - 1];
    const leftEnd = leftRoute[leftIndex];
    for (let rightIndex = 1; rightIndex < rightRoute.length; rightIndex += 1) {
      const rightStart = rightRoute[rightIndex - 1];
      const rightEnd = rightRoute[rightIndex];
      shared += segmentSharedLength(leftStart, leftEnd, rightStart, rightEnd);
    }
  }
  return shared;
}

function routeOverlapPenalty(route: Point[], existingRoutes: Point[][]): number {
  let shared = 0;
  for (const existingRoute of existingRoutes) {
    shared += routeSharedLength(route, existingRoute);
  }
  return shared * ROUTE_OVERLAP_PENALTY_PER_PIXEL;
}

function routeSharedLengthWithExisting(route: Point[], existingRoutes: Point[][]): number {
  let shared = 0;
  for (const existingRoute of existingRoutes) {
    shared += routeSharedLength(route, existingRoute);
  }
  return shared;
}

function routeScoreWithOverlap(
  route: Point[],
  sourceNode: FlowNode,
  targetNode: FlowNode,
  allNodes: FlowNode[],
  existingRoutes: Point[][]
): number {
  return routeQualityScore(route, sourceNode, targetNode, allNodes) + routeOverlapPenalty(route, existingRoutes);
}

function routeKey(route: Point[]): string {
  return route.map((point) => `${point.x},${point.y}`).join("|");
}

function segmentAxis(start: Point | undefined, end: Point | undefined): RouteAxis | null {
  if (!start || !end) {
    return null;
  }
  if (start.y === end.y && start.x !== end.x) {
    return "horizontal";
  }
  if (start.x === end.x && start.y !== end.y) {
    return "vertical";
  }
  return null;
}

function ensureEndpointOrthogonality(route: Point[], axis: RouteAxis, baselineRoute: Point[] = route): Point[] {
  if (route.length < 2) {
    return route;
  }

  const baselineStartAxis = segmentAxis(baselineRoute[0], baselineRoute[1]);
  const baselineEndAxis = segmentAxis(
    baselineRoute[baselineRoute.length - 2],
    baselineRoute[baselineRoute.length - 1]
  );

  const adjusted = [...route];
  const start = adjusted[0];
  const first = adjusted[1];
  if (start && first && start.x !== first.x && start.y !== first.y) {
    const startAxis = baselineStartAxis ?? (axis === "horizontal" ? "vertical" : "horizontal");
    adjusted.splice(1, 0, startAxis === "horizontal" ? { x: first.x, y: start.y } : { x: start.x, y: first.y });
  }

  const end = adjusted[adjusted.length - 1];
  const beforeEnd = adjusted[adjusted.length - 2];
  if (end && beforeEnd && end.x !== beforeEnd.x && end.y !== beforeEnd.y) {
    const endAxis = baselineEndAxis ?? (axis === "horizontal" ? "vertical" : "horizontal");
    adjusted.splice(
      adjusted.length - 1,
      0,
      endAxis === "horizontal" ? { x: beforeEnd.x, y: end.y } : { x: end.x, y: beforeEnd.y }
    );
  }

  return adjusted;
}

function buildSeparatedDirectRoute(route: Point[], axis: RouteAxis, offset: number): Point[] {
  const start = route[0];
  const end = route[route.length - 1];
  if (!start || !end) {
    return route;
  }

  if (axis === "horizontal") {
    const direction = end.x >= start.x ? 1 : -1;
    const distance = Math.abs(end.x - start.x);
    const maxLegByBridge = Math.floor((distance - ROUTE_LANE_SEPARATION_MIN_BRIDGE) / 2);
    const leg = Math.min(ROUTE_LANE_SEPARATION_MAX_LEG, maxLegByBridge);
    if (leg < ROUTE_LANE_SEPARATION_MIN_LEG) {
      return route;
    }
    const laneY = Math.round((start.y + end.y) / 2 + offset);
    return normalizeRoute([
      start,
      { x: start.x + direction * leg, y: start.y },
      { x: start.x + direction * leg, y: laneY },
      { x: end.x - direction * leg, y: laneY },
      { x: end.x - direction * leg, y: end.y },
      end
    ]);
  }

  const direction = end.y >= start.y ? 1 : -1;
  const distance = Math.abs(end.y - start.y);
  const maxLegByBridge = Math.floor((distance - ROUTE_LANE_SEPARATION_MIN_BRIDGE) / 2);
  const leg = Math.min(ROUTE_LANE_SEPARATION_MAX_LEG, maxLegByBridge);
  if (leg < ROUTE_LANE_SEPARATION_MIN_LEG) {
    return route;
  }
  const laneX = Math.round((start.x + end.x) / 2 + offset);
  return normalizeRoute([
    start,
    { x: start.x, y: start.y + direction * leg },
    { x: laneX, y: start.y + direction * leg },
    { x: laneX, y: end.y - direction * leg },
    { x: end.x, y: end.y - direction * leg },
    end
  ]);
}

function offsetRoutePerpendicular(route: Point[], axis: RouteAxis, offset: number): Point[] {
  if (offset === 0) {
    return route;
  }
  if (route.length <= 2) {
    return buildSeparatedDirectRoute(route, axis, offset);
  }

  const shifted = route.map((point, index) => {
    if (index === 0 || index === route.length - 1) {
      return point;
    }

    return axis === "horizontal"
      ? { x: point.x, y: Math.round(point.y + offset) }
      : { x: Math.round(point.x + offset), y: point.y };
  });

  return normalizeRoute(ensureEndpointOrthogonality(shifted, axis, route));
}

function laneSeparationOffsets(): number[] {
  const offsets = [0];
  for (let level = 1; level <= ROUTE_LANE_SEPARATION_LEVELS; level += 1) {
    const value = level * ROUTE_LANE_SEPARATION_STEP;
    offsets.push(-value, value);
  }
  return offsets;
}

function resolveRouteLaneSeparation(
  route: Point[],
  axis: RouteAxis | null,
  sourceNode: FlowNode,
  targetNode: FlowNode,
  allNodes: FlowNode[],
  existingRoutes: Point[][]
): Point[] {
  const effectiveAxis = axis ?? routeAxisFromEndpoints(route);
  if (!effectiveAxis || existingRoutes.length === 0) {
    return route;
  }

  const baseShared = routeSharedLengthWithExisting(route, existingRoutes);
  if (baseShared < ROUTE_LANE_SEPARATION_TRIGGER) {
    return route;
  }

  const obstacles = allNodes
    .filter((node) => node.id !== sourceNode.id && node.id !== targetNode.id)
    .map((node) => expandRect(nodeRect(node), SMART_ROUTE_OBSTACLE_PADDING));

  let bestRoute = route;
  let bestShared = baseShared;
  let bestScore = routeScoreWithOverlap(route, sourceNode, targetNode, allNodes, existingRoutes);

  for (const offset of laneSeparationOffsets()) {
    if (offset === 0) {
      continue;
    }

    const shiftedRoute = offsetRoutePerpendicular(route, effectiveAxis, offset);
    if (shiftedRoute.length < 2 || routeIntersections(shiftedRoute, obstacles) > 0) {
      continue;
    }

    const shared = routeSharedLengthWithExisting(shiftedRoute, existingRoutes);
    const score = routeScoreWithOverlap(shiftedRoute, sourceNode, targetNode, allNodes, existingRoutes);
    const improvesShared = shared < bestShared;
    const improvesScore = shared === bestShared && score < bestScore;

    if (improvesShared || improvesScore) {
      bestRoute = shiftedRoute;
      bestShared = shared;
      bestScore = score;
    }
  }

  return bestRoute;
}

function shouldUseSmartRoute(
  smartRoute: Point[],
  fallbackRoute: Point[],
  sourceNode: FlowNode,
  targetNode: FlowNode,
  allNodes: FlowNode[],
  existingRoutes: Point[][]
): boolean {
  const obstacles = allNodes
    .filter((node) => node.id !== sourceNode.id && node.id !== targetNode.id)
    .map((node) => expandRect(nodeRect(node), SMART_ROUTE_OBSTACLE_PADDING));
  if (routeIntersections(smartRoute, obstacles) > 0) {
    return false;
  }

  return (
    routeScoreWithOverlap(smartRoute, sourceNode, targetNode, allNodes, existingRoutes) <=
    routeScoreWithOverlap(fallbackRoute, sourceNode, targetNode, allNodes, existingRoutes)
  );
}

type RenderedLinksInput = {
  links: FlowLink[];
  nodes: FlowNode[];
  nodeById: Map<string, FlowNode>;
  previousAxisByLinkId: ReadonlyMap<string, RouteAxis>;
  manualRoutePoints: Record<string, Point | undefined>;
  canUseSmartRoutes: boolean;
  smartRouteByLinkId: Record<string, Point[] | undefined>;
  orchestratorLaneByLinkId: Map<string, OrchestratorLaneMeta>;
  reciprocalLaneByLinkId: Map<string, ReciprocalLaneMeta>;
};

export function buildRenderedLinks({
  links,
  nodes,
  nodeById,
  previousAxisByLinkId,
  manualRoutePoints,
  canUseSmartRoutes,
  smartRouteByLinkId,
  orchestratorLaneByLinkId,
  reciprocalLaneByLinkId
}: RenderedLinksInput): RenderedLink[] {
  const renderedLinks: RenderedLink[] = [];
  const selectedRoutes: Point[][] = [];

  for (const [index, link] of links.entries()) {
    const sourceNode = nodeById.get(link.sourceStepId);
    const targetNode = nodeById.get(link.targetStepId);
    if (!sourceNode || !targetNode) {
      continue;
    }

    const previousAxis = previousAxisByLinkId.get(link.id) ?? null;
    const orchestratorLane = orchestratorLaneByLinkId.get(link.id) ?? null;
    const reciprocalLane = reciprocalLaneByLinkId.get(link.id) ?? null;
    const manualWaypoint = manualRoutePoints[link.id] ?? null;
    const fallbackEdgeIndexVariants = manualWaypoint ? [0] : [...ROUTE_EDGE_INDEX_VARIANTS];
    const fallbackVariants: Array<{ route: Point[]; axis: RouteAxis | null }> = [];
    const seenFallbackRoutes = new Set<string>();

    for (const variantOffset of fallbackEdgeIndexVariants) {
      const variant = buildEdgeRoute(
        sourceNode,
        targetNode,
        nodes,
        index + variantOffset,
        previousAxis,
        orchestratorLane,
        reciprocalLane,
        manualWaypoint
      );
      const key = routeKey(variant.route);
      if (seenFallbackRoutes.has(key)) {
        continue;
      }
      seenFallbackRoutes.add(key);
      fallbackVariants.push(variant);
    }

    let fallbackRouteResult = fallbackVariants[0];
    let fallbackScore = Number.POSITIVE_INFINITY;
    for (const variant of fallbackVariants) {
      const score = routeScoreWithOverlap(variant.route, sourceNode, targetNode, nodes, selectedRoutes);
      if (score < fallbackScore) {
        fallbackScore = score;
        fallbackRouteResult = variant;
      }
    }

    if (!fallbackRouteResult) {
      continue;
    }

    const useSmartRoute = canUseSmartRoutes && !manualWaypoint;
    const smartRouteCandidate = useSmartRoute ? smartRouteByLinkId[link.id] : undefined;
    const normalizedSmartRouteCandidate =
      smartRouteCandidate && smartRouteCandidate.length >= 2 ? normalizeRoute(smartRouteCandidate) : null;
    const normalizedSmartRoute =
      normalizedSmartRouteCandidate &&
      normalizedSmartRouteCandidate.length >= 2 &&
      smartRouteMatchesNodes(normalizedSmartRouteCandidate, sourceNode, targetNode)
        ? normalizedSmartRouteCandidate
        : null;
    const useValidatedSmartRoute =
      normalizedSmartRoute &&
      normalizedSmartRoute.length >= 2 &&
      shouldUseSmartRoute(normalizedSmartRoute, fallbackRouteResult.route, sourceNode, targetNode, nodes, selectedRoutes);

    const { route, axis } =
      useValidatedSmartRoute
        ? {
            route: normalizedSmartRoute,
            axis: routeAxisFromEndpoints(normalizedSmartRoute)
          }
        : fallbackRouteResult;
    const resolvedRoute = manualWaypoint
      ? route
      : resolveRouteLaneSeparation(route, axis, sourceNode, targetNode, nodes, selectedRoutes);
    const resolvedAxis = axis ?? routeAxisFromEndpoints(resolvedRoute);

    const path = routePath(resolvedRoute, manualWaypoint ? MANUAL_CORNER_RADIUS : CORNER_RADIUS);
    const endPoint = resolvedRoute[resolvedRoute.length - 1];
    if (!path || !endPoint) {
      continue;
    }
    const pathDistance = Math.max(routeLength(resolvedRoute), 1);

    renderedLinks.push({
      id: link.id,
      path,
      route: resolvedRoute,
      pathDistance,
      endPoint,
      axis: resolvedAxis,
      dasharray: edgeStrokeDasharray(sourceNode.role, targetNode.role),
      hasOrchestrator: edgeInvolvesOrchestrator(sourceNode.role, targetNode.role),
      controlPoint: manualWaypoint ?? routeMidpoint(resolvedRoute),
      hasManualRoute: Boolean(manualWaypoint),
      visual: edgeVisual(link.condition)
    });
    selectedRoutes.push(resolvedRoute);
  }

  return renderedLinks;
}

export function syncRouteAxisMemory(
  routeAxisMemoryRef: MutableRefObject<Map<string, RouteAxis>>,
  renderedLinks: readonly RenderedLink[]
): void {
  const next = new Map<string, RouteAxis>();
  for (const link of renderedLinks) {
    if (link.axis) {
      next.set(link.id, link.axis);
    }
  }
  routeAxisMemoryRef.current = next;
}
