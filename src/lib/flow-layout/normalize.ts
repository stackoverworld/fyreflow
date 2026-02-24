import type { AgentRole, PipelinePayload } from "@/lib/types";

import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, ROUTE_ENDPOINT_MAX_DISTANCE } from "./constants";

export interface Position {
  x: number;
  y: number;
}

export interface RouteNodeInput {
  id: string;
  position: Position;
  role?: AgentRole;
  enableDelegation?: boolean;
  delegationCount?: number;
}

export interface RouteLinkInput {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  condition?: string;
}

export interface FlowLayoutOptions {
  startX?: number;
  centerY?: number;
  layerGap?: number;
  rowGap?: number;
}

export type LayoutStep = PipelinePayload["steps"][number];
export type LayoutLink = PipelinePayload["links"][number];

export interface ElkPointLike {
  x?: number;
  y?: number;
}

export interface ElkEdgeSectionLike {
  id?: string;
  startPoint?: ElkPointLike;
  endPoint?: ElkPointLike;
  bendPoints?: ElkPointLike[];
  incomingSections?: string[];
  outgoingSections?: string[];
}

interface RouteRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function toRoundedPoint(point: Position): Position {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y)
  };
}

export function normalizeElkRoute(points: Position[]): Position[] {
  if (points.length <= 2) {
    return points.map(toRoundedPoint);
  }

  const compact: Position[] = [];

  for (const point of points.map(toRoundedPoint)) {
    const last = compact[compact.length - 1];
    if (last && last.x === point.x && last.y === point.y) {
      continue;
    }

    compact.push(point);
    if (compact.length < 3) {
      continue;
    }

    const a = compact[compact.length - 3];
    const b = compact[compact.length - 2];
    const c = compact[compact.length - 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (collinear) {
      compact.splice(compact.length - 2, 1);
    }
  }

  return compact;
}

export function routeNodeRect(node: RouteNodeInput): RouteRect {
  return {
    left: node.position.x,
    right: node.position.x + DEFAULT_NODE_WIDTH,
    top: node.position.y,
    bottom: node.position.y + DEFAULT_NODE_HEIGHT
  };
}

export function pointDistanceToRect(point: Position, rect: RouteRect): number {
  const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
  const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

export function routeLength(points: Position[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return total;
}

export function routePointFromElk(point: ElkPointLike | undefined): Position | null {
  if (typeof point?.x !== "number" || typeof point?.y !== "number") {
    return null;
  }

  return {
    x: point.x,
    y: point.y
  };
}

export function routeEndpointsAreValid(route: Position[], sourceNode: RouteNodeInput, targetNode: RouteNodeInput): boolean {
  const start = route[0];
  const end = route[route.length - 1];
  if (!start || !end) {
    return false;
  }

  const sourceDistance = pointDistanceToRect(start, routeNodeRect(sourceNode));
  const targetDistance = pointDistanceToRect(end, routeNodeRect(targetNode));

  return sourceDistance <= ROUTE_ENDPOINT_MAX_DISTANCE && targetDistance <= ROUTE_ENDPOINT_MAX_DISTANCE;
}
