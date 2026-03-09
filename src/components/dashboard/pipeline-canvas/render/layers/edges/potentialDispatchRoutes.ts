import {
  buildEdgeRoute,
  CORNER_RADIUS,
  normalizeRoute,
  preferredSide,
  rectCenter,
  routeIntersections,
  routeLength,
  routePath
} from "../../../edgeRendering";
import { buildPotentialDispatchRouteId } from "../../../potentialDispatchRouteId";
import type {
  AnchorSide,
  FlowLink,
  FlowNode,
  OrchestratorLaneMeta,
  Point
} from "../../../types";
import { expandRect, nodeAnchorRect, nodeRect } from "../../../useNodeLayout";

export interface PotentialDispatchRoute {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  path: string;
  route: Point[];
}

export interface PotentialDispatchRouteOptions {
  orchestratorIds?: readonly string[];
}

interface CandidateDispatchEdge {
  orchestratorNode: FlowNode;
  targetNode: FlowNode;
  side: AnchorSide;
  sortKey: number;
}
const POTENTIAL_ROUTE_OBSTACLE_PADDING = 16;
const POTENTIAL_ROUTE_EDGE_VARIANTS = [0, 1, 2, 3, 4, 5] as const;
const POTENTIAL_ROUTE_CORNER_RADIUS = Math.max(12, CORNER_RADIUS - 8);
const POTENTIAL_ROUTE_OVERLAP_PENALTY_PER_PIXEL = 90;
const POTENTIAL_ROUTE_CROSSING_PENALTY = 1_600;

function candidateKey(orchestratorNodeId: string, targetNodeId: string): string {
  return `${orchestratorNodeId}:${targetNodeId}`;
}

function candidateSortOrder(left: CandidateDispatchEdge, right: CandidateDispatchEdge): number {
  const sideRank = sideOrder(left.side) - sideOrder(right.side);
  if (sideRank !== 0) {
    return sideRank;
  }

  if (left.sortKey !== right.sortKey) {
    return left.sortKey - right.sortKey;
  }

  const orchestratorRank = left.orchestratorNode.id.localeCompare(right.orchestratorNode.id);
  if (orchestratorRank !== 0) {
    return orchestratorRank;
  }

  return left.targetNode.id.localeCompare(right.targetNode.id);
}

function sideOrder(side: AnchorSide): number {
  if (side === "left") {
    return 0;
  }

  if (side === "right") {
    return 1;
  }

  if (side === "top") {
    return 2;
  }

  return 3;
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

function segmentCrosses(aStart: Point, aEnd: Point, bStart: Point, bEnd: Point): boolean {
  const aVertical = aStart.x === aEnd.x;
  const bVertical = bStart.x === bEnd.x;
  const aHorizontal = aStart.y === aEnd.y;
  const bHorizontal = bStart.y === bEnd.y;

  if ((aVertical && bVertical) || (aHorizontal && bHorizontal)) {
    return false;
  }

  const horizontalStart = aHorizontal ? aStart : bStart;
  const horizontalEnd = aHorizontal ? aEnd : bEnd;
  const verticalStart = aVertical ? aStart : bStart;
  const verticalEnd = aVertical ? aEnd : bEnd;

  if (horizontalStart.y !== horizontalEnd.y || verticalStart.x !== verticalEnd.x) {
    return false;
  }

  const horizontalMinX = Math.min(horizontalStart.x, horizontalEnd.x);
  const horizontalMaxX = Math.max(horizontalStart.x, horizontalEnd.x);
  const verticalMinY = Math.min(verticalStart.y, verticalEnd.y);
  const verticalMaxY = Math.max(verticalStart.y, verticalEnd.y);

  return (
    verticalStart.x >= horizontalMinX &&
    verticalStart.x <= horizontalMaxX &&
    horizontalStart.y >= verticalMinY &&
    horizontalStart.y <= verticalMaxY
  );
}

function routeOverlapAndCrossingPenalty(route: Point[], existingRoutes: Point[][]): number {
  let overlapLength = 0;
  let crossings = 0;

  for (const existingRoute of existingRoutes) {
    for (let leftIndex = 1; leftIndex < route.length; leftIndex += 1) {
      const leftStart = route[leftIndex - 1];
      const leftEnd = route[leftIndex];
      for (let rightIndex = 1; rightIndex < existingRoute.length; rightIndex += 1) {
        const rightStart = existingRoute[rightIndex - 1];
        const rightEnd = existingRoute[rightIndex];
        overlapLength += segmentSharedLength(leftStart, leftEnd, rightStart, rightEnd);
        if (segmentCrosses(leftStart, leftEnd, rightStart, rightEnd)) {
          crossings += 1;
        }
      }
    }
  }

  return overlapLength * POTENTIAL_ROUTE_OVERLAP_PENALTY_PER_PIXEL + crossings * POTENTIAL_ROUTE_CROSSING_PENALTY;
}

function potentialRouteScore(
  route: Point[],
  sourceNode: FlowNode,
  targetNode: FlowNode,
  allNodes: FlowNode[],
  existingRoutes: Point[][]
): number {
  const obstacles = allNodes
    .filter((node) => node.id !== sourceNode.id && node.id !== targetNode.id)
    .map((node) => expandRect(nodeRect(node), POTENTIAL_ROUTE_OBSTACLE_PADDING));
  const intersections = routeIntersections(route, obstacles);
  const bends = Math.max(0, route.length - 2);
  const congestionPenalty = routeOverlapAndCrossingPenalty(route, existingRoutes);

  // Strongly prefer obstacle-free routes, then fewer bends, then shorter distance.
  return intersections * 100_000 + bends * 170 + routeLength(route) + congestionPenalty;
}

export function buildPotentialOrchestratorDispatchRoutes(
  nodes: FlowNode[],
  links: FlowLink[],
  options?: PotentialDispatchRouteOptions
): PotentialDispatchRoute[] {
  const orchestratorFilter = options?.orchestratorIds
    ? new Set(options.orchestratorIds.filter((id) => id.trim().length > 0))
    : null;
  const orchestratorNodes = nodes.filter(
    (node) =>
      node.role === "orchestrator" &&
      (orchestratorFilter === null || orchestratorFilter.has(node.id))
  );
  if (orchestratorNodes.length === 0) {
    return [];
  }

  const linkedTargetsBySourceNodeId = new Map<string, Set<string>>();
  for (const link of links) {
    const linkedTargets = linkedTargetsBySourceNodeId.get(link.sourceStepId) ?? new Set<string>();
    linkedTargets.add(link.targetStepId);
    linkedTargetsBySourceNodeId.set(link.sourceStepId, linkedTargets);
  }

  const candidates: CandidateDispatchEdge[] = [];
  for (const orchestratorNode of orchestratorNodes) {
    const linkedTargets = linkedTargetsBySourceNodeId.get(orchestratorNode.id) ?? new Set<string>();

    for (const targetNode of nodes) {
      if (targetNode.id === orchestratorNode.id || targetNode.role === "orchestrator") {
        continue;
      }

      if (linkedTargets.has(targetNode.id)) {
        continue;
      }

      const side = preferredSide(nodeAnchorRect(orchestratorNode), nodeAnchorRect(targetNode));
      const targetCenter = rectCenter(nodeAnchorRect(targetNode));
      const sortKey = side === "left" || side === "right" ? targetCenter.y : targetCenter.x;

      candidates.push({
        orchestratorNode,
        targetNode,
        side,
        sortKey
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const candidatesBySideGroup = new Map<string, CandidateDispatchEdge[]>();
  for (const candidate of candidates) {
    const groupId = `${candidate.orchestratorNode.id}:${candidate.side}`;
    const group = candidatesBySideGroup.get(groupId) ?? [];
    group.push(candidate);
    candidatesBySideGroup.set(groupId, group);
  }

  const laneMetaByCandidateKey = new Map<string, OrchestratorLaneMeta>();
  for (const groupedCandidates of candidatesBySideGroup.values()) {
    groupedCandidates.sort((left, right) => {
      if (left.sortKey !== right.sortKey) {
        return left.sortKey - right.sortKey;
      }
      return left.targetNode.id.localeCompare(right.targetNode.id);
    });

    const laneCount = groupedCandidates.length;
    groupedCandidates.forEach((candidate, laneIndex) => {
      laneMetaByCandidateKey.set(
        candidateKey(candidate.orchestratorNode.id, candidate.targetNode.id),
        {
          orchestratorId: candidate.orchestratorNode.id,
          side: candidate.side,
          index: laneIndex,
          count: laneCount
        }
      );
    });
  }

  const sortedCandidates = [...candidates].sort(candidateSortOrder);
  const routes: PotentialDispatchRoute[] = [];
  const selectedRoutes: Point[][] = [];

  sortedCandidates.forEach((candidate, index) => {
    const laneMeta = laneMetaByCandidateKey.get(
      candidateKey(candidate.orchestratorNode.id, candidate.targetNode.id)
    );
    if (!laneMeta) {
      return;
    }

    let bestRoute: Point[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const variantOffset of POTENTIAL_ROUTE_EDGE_VARIANTS) {
      const variant = buildEdgeRoute(
        candidate.orchestratorNode,
        candidate.targetNode,
        nodes,
        links.length + index + variantOffset,
        null,
        laneMeta,
        null,
        null
      );
      const normalizedRoute = normalizeRoute(variant.route);
      const score = potentialRouteScore(
        normalizedRoute,
        candidate.orchestratorNode,
        candidate.targetNode,
        nodes,
        selectedRoutes
      );
      if (score < bestScore) {
        bestScore = score;
        bestRoute = normalizedRoute;
      }
    }

    if (!bestRoute) {
      return;
    }

    const path = routePath(bestRoute, POTENTIAL_ROUTE_CORNER_RADIUS);
    if (!path) {
      return;
    }

    routes.push({
      id: buildPotentialDispatchRouteId(candidate.orchestratorNode.id, candidate.targetNode.id),
      sourceNodeId: candidate.orchestratorNode.id,
      targetNodeId: candidate.targetNode.id,
      path,
      route: bestRoute
    });
    selectedRoutes.push(bestRoute);
  });

  return routes;
}
