import {
  findNodeAtPoint,
  nodeRect,
  rectFromPoints,
  rectsOverlap,
  resolveNodeCollisionPosition,
  snapToGrid
} from "../../useNodeLayout";
import type {
  DragState,
  FlowNode,
  MarqueeState,
  ConnectingState,
  Point,
  RouteAdjustState,
  NodePositionUpdate
} from "../../types";

const DRAG_SELECTION_THRESHOLD = 4;
const NODE_DRAG_THRESHOLD = 3;

function hasAxisMovement(start: number, end: number, threshold: number): boolean {
  return Math.abs(end - start) > threshold;
}

export function isPointerDrag(end: Point, start: Point, threshold = DRAG_SELECTION_THRESHOLD): boolean {
  return hasAxisMovement(end.x, start.x, threshold) || hasAxisMovement(end.y, start.y, threshold);
}

function isNodeDrag(end: Point, start: Point): boolean {
  return hasAxisMovement(end.x, start.x, NODE_DRAG_THRESHOLD) || hasAxisMovement(end.y, start.y, NODE_DRAG_THRESHOLD);
}

export function buildRouteAdjustPoint(worldPoint: Point, routeAdjustState: RouteAdjustState): Point {
  return {
    x: Math.round(worldPoint.x - routeAdjustState.offsetX),
    y: Math.round(worldPoint.y - routeAdjustState.offsetY)
  };
}

export function buildDragUpdates(
  dragState: DragState,
  worldPoint: Point,
  nodes: FlowNode[]
): { hasDragged: boolean; updates: NodePositionUpdate[] } | null {
  const anchorStart = dragState.initialPositions.find((entry) => entry.nodeId === dragState.anchorNodeId);
  if (!anchorStart) {
    return null;
  }

  const rawAnchorPosition = {
    x: worldPoint.x - dragState.offsetX,
    y: worldPoint.y - dragState.offsetY
  };
  const deltaX = snapToGrid(rawAnchorPosition.x - anchorStart.position.x);
  const deltaY = snapToGrid(rawAnchorPosition.y - anchorStart.position.y);
  const nextAnchorPosition = {
    x: anchorStart.position.x + deltaX,
    y: anchorStart.position.y + deltaY
  };

  const hasDragged = isNodeDrag(nextAnchorPosition, anchorStart.position);

  let updates = dragState.initialPositions.map((entry) => ({
    nodeId: entry.nodeId,
    position: {
      x: Math.round(entry.position.x + deltaX),
      y: Math.round(entry.position.y + deltaY)
    }
  }));

  if (updates.length === 1) {
    const resolved = resolveNodeCollisionPosition(updates[0].nodeId, updates[0].position, nodes);
    updates = [
      {
        nodeId: updates[0].nodeId,
        position: {
          x: snapToGrid(resolved.x),
          y: snapToGrid(resolved.y)
        }
      }
    ];
  }

  return {
    hasDragged,
    updates
  };
}

export function resolveTargetNodeIdForConnection(
  connectingState: ConnectingState,
  worldPoint: Point | null,
  nodes: FlowNode[]
): string | null {
  if (connectingState.targetNodeId) {
    return connectingState.targetNodeId;
  }

  if (!worldPoint) {
    return null;
  }

  return findNodeAtPoint(worldPoint, nodes, connectingState.sourceNodeId)?.id ?? null;
}

export function buildMarqueeSelection({
  marqueeState,
  selectedNodeIds,
  selectedNodeId,
  additive,
  nodes
}: {
  marqueeState: MarqueeState;
  selectedNodeIds: string[];
  selectedNodeId: string | null;
  additive: boolean;
  nodes: FlowNode[];
}): {
  nodeIds: string[];
  primaryNodeId: string | null;
} {
  const selectRect = rectFromPoints(marqueeState.startWorld, marqueeState.currentWorld);
  const selectedIds = nodes.filter((node) => rectsOverlap(nodeRect(node), selectRect)).map((node) => node.id);
  const nodeIds = additive ? Array.from(new Set([...selectedNodeIds, ...selectedIds])) : selectedIds;
  const primaryNodeId = nodeIds.length === 0 ? null : selectedNodeId && nodeIds.includes(selectedNodeId) ? selectedNodeId : nodeIds[nodeIds.length - 1];

  return {
    nodeIds,
    primaryNodeId
  };
}
