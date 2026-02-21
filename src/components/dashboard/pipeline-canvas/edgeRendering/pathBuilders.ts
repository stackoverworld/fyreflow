import type { FlowNode, OrchestratorLaneMeta, Point, ReciprocalLaneMeta, RouteAxis } from "../types";
import { nodeRect } from "../useNodeLayout";
import { preferredSide } from "./geometry";
import { buildEdgeRoute as buildOrthogonalEdgeRoute } from "./path-builders/orthogonal";

export function simpleOrchestratorLaneMeta(
  sourceNode: FlowNode,
  targetNode: FlowNode
): OrchestratorLaneMeta | null {
  const sourceIsOrchestrator = sourceNode.role === "orchestrator";
  const targetIsOrchestrator = targetNode.role === "orchestrator";
  if (!sourceIsOrchestrator && !targetIsOrchestrator) {
    return null;
  }

  const orchestratorNode = sourceIsOrchestrator ? sourceNode : targetNode;
  const otherNode = sourceIsOrchestrator ? targetNode : sourceNode;
  const side = preferredSide(nodeRect(orchestratorNode), nodeRect(otherNode));

  return {
    orchestratorId: orchestratorNode.id,
    side,
    index: 0,
    count: 1
  };
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
  return buildOrthogonalEdgeRoute(
    sourceNode,
    targetNode,
    allNodes,
    edgeIndex,
    previousAxis,
    orchestratorLane,
    reciprocalLane,
    manualWaypoint
  );
}
