import { preferredSide, rectCenter } from "./edgeRendering";
import { nodeSourceAnchorRect, nodeTargetAnchorRect } from "./useNodeLayout";
import {
  type AnchorSide,
  type FlowLink,
  type FlowNode,
  type OrchestratorLaneMeta,
  type ReciprocalLaneMeta
} from "./types";

type OrchestratorLaneInput = {
  links: FlowLink[];
  nodeById: Map<string, FlowNode>;
};

type ReciprocalLaneInput = {
  links: FlowLink[];
  nodeById: Map<string, FlowNode>;
};

const RECIPROCAL_DIRECTION_BAND = 30;
const RECIPROCAL_LANE_STEP = 14;
const RECIPROCAL_MIN_OFFSET = 20;

function linkConditionPriority(link: FlowLink): number {
  if (link.condition === "on_fail") {
    return 0;
  }

  if (link.condition === "always" || link.condition === undefined) {
    return 1;
  }

  if (link.condition === "on_pass") {
    return 2;
  }

  return 3;
}

function reciprocalDirectionalOffset(directionSign: -1 | 1, index: number, count: number): number {
  const centered = (index - (count - 1) / 2) * RECIPROCAL_LANE_STEP;
  const magnitude = Math.max(RECIPROCAL_MIN_OFFSET, Math.round(RECIPROCAL_DIRECTION_BAND + centered));
  return directionSign * magnitude;
}

export function buildOrchestratorLaneByLinkId({ links, nodeById }: OrchestratorLaneInput): Map<string, OrchestratorLaneMeta> {
  const groups = new Map<string, Array<{ linkId: string; sortKey: number; orchestratorId: string; side: AnchorSide }>>();

  for (const link of links) {
    const sourceNode = nodeById.get(link.sourceStepId);
    const targetNode = nodeById.get(link.targetStepId);
    if (!sourceNode || !targetNode) {
      continue;
    }

    const sourceIsOrchestrator = sourceNode.role === "orchestrator";
    const targetIsOrchestrator = targetNode.role === "orchestrator";
    if (!sourceIsOrchestrator && !targetIsOrchestrator) {
      continue;
    }

    const orchestratorNode = sourceIsOrchestrator ? sourceNode : targetNode;
    const otherNode = sourceIsOrchestrator ? targetNode : sourceNode;
    const orchestratorRect = sourceIsOrchestrator
      ? nodeSourceAnchorRect(orchestratorNode)
      : nodeTargetAnchorRect(orchestratorNode);
    const otherRect = sourceIsOrchestrator
      ? nodeTargetAnchorRect(otherNode)
      : nodeSourceAnchorRect(otherNode);
    const side = preferredSide(orchestratorRect, otherRect);
    const otherCenter = rectCenter(otherRect);
    const sortKey = side === "left" || side === "right" ? otherCenter.y : otherCenter.x;
    const key = `${orchestratorNode.id}:${side}`;

    const current = groups.get(key) ?? [];
    current.push({
      linkId: link.id,
      sortKey,
      orchestratorId: orchestratorNode.id,
      side
    });
    groups.set(key, current);
  }

  const laneMap = new Map<string, OrchestratorLaneMeta>();
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.sortKey - b.sortKey);
    const count = entries.length;
    entries.forEach((entry, index) => {
      laneMap.set(entry.linkId, {
        orchestratorId: entry.orchestratorId,
        side: entry.side,
        index,
        count
      });
    });
  }

  return laneMap;
}

export function buildReciprocalLaneByLinkId({ links, nodeById }: ReciprocalLaneInput): Map<string, ReciprocalLaneMeta> {
  const grouped = new Map<string, FlowLink[]>();

  for (const link of links) {
    const sourceNode = nodeById.get(link.sourceStepId);
    const targetNode = nodeById.get(link.targetStepId);
    if (!sourceNode || !targetNode) {
      continue;
    }

    if (sourceNode.role === "orchestrator" || targetNode.role === "orchestrator") {
      continue;
    }

    const a = link.sourceStepId < link.targetStepId ? link.sourceStepId : link.targetStepId;
    const b = link.sourceStepId < link.targetStepId ? link.targetStepId : link.sourceStepId;
    const key = `${a}::${b}`;
    const current = grouped.get(key) ?? [];
    current.push(link);
    grouped.set(key, current);
  }

  const laneMap = new Map<string, ReciprocalLaneMeta>();

  for (const [key, entries] of grouped.entries()) {
    const [a, b] = key.split("::");
    if (!a || !b) {
      continue;
    }

    const forward = entries
      .filter((link) => link.sourceStepId === a && link.targetStepId === b)
      .sort((left, right) => {
        const priorityDelta = linkConditionPriority(left) - linkConditionPriority(right);
        return priorityDelta !== 0 ? priorityDelta : left.id.localeCompare(right.id);
      });
    const backward = entries
      .filter((link) => link.sourceStepId === b && link.targetStepId === a)
      .sort((left, right) => {
        const priorityDelta = linkConditionPriority(left) - linkConditionPriority(right);
        return priorityDelta !== 0 ? priorityDelta : left.id.localeCompare(right.id);
      });

    if (forward.length === 0 || backward.length === 0) {
      continue;
    }
    const totalDirectionalLinks = forward.length + backward.length;

    forward.forEach((link, index) => {
      const portIndex = index;
      laneMap.set(link.id, {
        offset: reciprocalDirectionalOffset(-1, index, forward.length),
        sourceIndex: portIndex,
        sourceCount: totalDirectionalLinks,
        targetIndex: portIndex,
        targetCount: totalDirectionalLinks
      });
    });

    backward.forEach((link, index) => {
      const portIndex = totalDirectionalLinks - backward.length + index;
      laneMap.set(link.id, {
        offset: reciprocalDirectionalOffset(1, index, backward.length),
        sourceIndex: portIndex,
        sourceCount: totalDirectionalLinks,
        targetIndex: portIndex,
        targetCount: totalDirectionalLinks
      });
    });
  }

  return laneMap;
}
