import type { FlowNode, Point, Rect } from "./types";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 116;
export const NODE_COLLISION_GAP = 16;
export const MAX_COLLISION_PASSES = 12;
export const DELEGATION_SPINE_HEIGHT = 8;
export const DELEGATION_CARD_HEIGHT = 56;
export const DRAG_GRID_SIZE = 24;

/** Total visual height of a node including its delegation sub-card. */
export function nodeVisualHeight(node: FlowNode): number {
  return node.enableDelegation && node.delegationCount && node.delegationCount > 0
    ? NODE_HEIGHT + DELEGATION_SPINE_HEIGHT + DELEGATION_CARD_HEIGHT
    : NODE_HEIGHT;
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

export function expandRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    right: rect.right + padding,
    top: rect.top - padding,
    bottom: rect.bottom + padding
  };
}

export function rangeOverlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  const minA = Math.min(a1, a2);
  const maxA = Math.max(a1, a2);
  const minB = Math.min(b1, b2);
  const maxB = Math.max(b1, b2);
  return maxA >= minB && maxB >= minA;
}

export function segmentIntersectsRect(start: Point, end: Point, rect: Rect): boolean {
  if (start.x === end.x) {
    return start.x >= rect.left && start.x <= rect.right && rangeOverlaps(start.y, end.y, rect.top, rect.bottom);
  }

  if (start.y === end.y) {
    return start.y >= rect.top && start.y <= rect.bottom && rangeOverlaps(start.x, end.x, rect.left, rect.right);
  }

  return false;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function rectFromPosition(position: { x: number; y: number }): Rect {
  return {
    left: position.x,
    right: position.x + NODE_WIDTH,
    top: position.y,
    bottom: position.y + NODE_HEIGHT
  };
}

export function rectCenter(rect: Rect): Point {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2
  };
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
