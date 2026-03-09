import type { FlowNode, Point, Rect } from "./types";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 116;
export const NODE_COLLISION_GAP = 16;
export const MAX_COLLISION_PASSES = 12;
export const DELEGATION_SPINE_HEIGHT = 8;
export const DELEGATION_CARD_HEIGHT_BASE = 52;
export const DELEGATION_CARD_ROW_HEIGHT = 22;
export const DELEGATION_BADGES_PER_ROW = 4;

export function delegationCardHeight(delegationCount: number): number {
  const visibleCount = Math.min(delegationCount, 6);
  const hasOverflow = delegationCount > 6;
  const totalBadges = visibleCount + (hasOverflow ? 1 : 0);
  const rows = Math.ceil(totalBadges / DELEGATION_BADGES_PER_ROW);
  if (rows <= 1) return DELEGATION_CARD_HEIGHT_BASE;
  return DELEGATION_CARD_HEIGHT_BASE + (rows - 1) * DELEGATION_CARD_ROW_HEIGHT;
}
export const DRAG_GRID_SIZE = 24;

/** Total visual height of a node including its delegation sub-card. */
export function nodeVisualHeight(node: FlowNode): number {
  return hasDelegationCard(node)
    ? NODE_HEIGHT + DELEGATION_SPINE_HEIGHT + delegationCardHeight(node.delegationCount!)
    : NODE_HEIGHT;
}

export function hasDelegationCard(node: FlowNode): boolean {
  return Boolean(node.enableDelegation && node.delegationCount && node.delegationCount > 0);
}

export function nodeDelegationRect(node: FlowNode): Rect | null {
  if (!hasDelegationCard(node)) {
    return null;
  }

  const top = node.position.y + NODE_HEIGHT + DELEGATION_SPINE_HEIGHT;
  const cardHeight = delegationCardHeight(node.delegationCount!);
  return {
    left: node.position.x,
    right: node.position.x + NODE_WIDTH,
    top,
    bottom: top + cardHeight
  };
}

export function nodeMainCardRect(node: FlowNode): Rect {
  return {
    left: node.position.x,
    right: node.position.x + NODE_WIDTH,
    top: node.position.y,
    bottom: node.position.y + NODE_HEIGHT
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function snapToGrid(value: number, gridSize: number = DRAG_GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

export function nodeRect(node: FlowNode): Rect {
  return {
    left: node.position.x,
    right: node.position.x + NODE_WIDTH,
    top: node.position.y,
    bottom: node.position.y + nodeVisualHeight(node)
  };
}

/** Generic anchor rect defaults to the main card. */
export function nodeAnchorRect(node: FlowNode): Rect {
  return nodeMainCardRect(node);
}

/** Outgoing edge anchors originate from the main card. */
export function nodeSourceAnchorRect(node: FlowNode): Rect {
  return nodeMainCardRect(node);
}

/** Incoming edge anchors always terminate on the main card. */
export function nodeTargetAnchorRect(node: FlowNode): Rect {
  return nodeMainCardRect(node);
}

export function expandRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    right: rect.right + padding,
    top: rect.top - padding,
    bottom: rect.bottom + padding
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y)
  };
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function findNodeAtPoint(point: Point, nodes: FlowNode[], excludeNodeId?: string): FlowNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (excludeNodeId && node.id === excludeNodeId) {
      continue;
    }

    if (pointInRect(point, nodeRect(node))) {
      return node;
    }
  }

  return null;
}

export function resolveNodeCollisionPosition(
  nodeId: string,
  position: { x: number; y: number },
  allNodes: FlowNode[]
): { x: number; y: number } {
  let resolved = {
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
  const selfNode = allNodes.find((node) => node.id === nodeId);
  const selfHeight = selfNode ? nodeVisualHeight(selfNode) : NODE_HEIGHT;
  const others = allNodes.filter((node) => node.id !== nodeId);

  for (let pass = 0; pass < MAX_COLLISION_PASSES; pass += 1) {
    const selfBaseRect = {
      left: resolved.x,
      right: resolved.x + NODE_WIDTH,
      top: resolved.y,
      bottom: resolved.y + selfHeight
    };
    const selfRect = expandRect(selfBaseRect, NODE_COLLISION_GAP / 2);
    let nextResolved: { x: number; y: number } | null = null;

    for (const other of others) {
      const otherBaseRect = nodeRect(other);
      const otherRect = expandRect(otherBaseRect, NODE_COLLISION_GAP / 2);

      if (!rectsOverlap(selfRect, otherRect)) {
        continue;
      }

      const overlapX = Math.min(selfRect.right, otherRect.right) - Math.max(selfRect.left, otherRect.left);
      const overlapY = Math.min(selfRect.bottom, otherRect.bottom) - Math.max(selfRect.top, otherRect.top);

      if (overlapX <= 0 || overlapY <= 0) {
        continue;
      }

      const selfCenter = {
        x: (selfBaseRect.left + selfBaseRect.right) / 2,
        y: (selfBaseRect.top + selfBaseRect.bottom) / 2
      };
      const otherCenter = {
        x: (otherBaseRect.left + otherBaseRect.right) / 2,
        y: (otherBaseRect.top + otherBaseRect.bottom) / 2
      };

      if (overlapX <= overlapY) {
        const direction = selfCenter.x >= otherCenter.x ? 1 : -1;
        nextResolved = {
          x: resolved.x + direction * (overlapX + 1),
          y: resolved.y
        };
      } else {
        const direction = selfCenter.y >= otherCenter.y ? 1 : -1;
        nextResolved = {
          x: resolved.x,
          y: resolved.y + direction * (overlapY + 1)
        };
      }

      break;
    }

    if (!nextResolved) {
      break;
    }

    resolved = {
      x: Math.round(nextResolved.x),
      y: Math.round(nextResolved.y)
    };
  }

  return resolved;
}
