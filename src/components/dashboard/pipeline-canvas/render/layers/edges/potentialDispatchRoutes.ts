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
import { expandRect, nodeRect } from "../../../useNodeLayout";

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

function potentialRouteScore(route: Point[], sourceNode: FlowNode, targetNode: FlowNode, allNodes: FlowNode[]): number {
  const obstacles = allNodes
    .filter((node) => node.id !== sourceNode.id && node.id !== targetNode.id)
    .map((node) => expandRect(nodeRect(node), POTENTIAL_ROUTE_OBSTACLE_PADDING));
  const intersections = routeIntersections(route, obstacles);
  const bends = Math.max(0, route.length - 2);

  // Strongly prefer obstacle-free routes, then fewer bends, then shorter distance.
  return intersections * 100_000 + bends * 170 + routeLength(route);
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

      const side = preferredSide(nodeRect(orchestratorNode), nodeRect(targetNode));
      const targetCenter = rectCenter(nodeRect(targetNode));
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
      const score = potentialRouteScore(normalizedRoute, candidate.orchestratorNode, candidate.targetNode, nodes);
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
  });

  return routes;
}
