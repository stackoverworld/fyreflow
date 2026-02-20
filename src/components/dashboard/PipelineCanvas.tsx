import { Hand, Move, MousePointer2, PlusCircle, Trash2, Unlink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRole, LinkCondition, ProviderId } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Badge } from "@/components/optics/badge";
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarDivider,
  FloatingToolbarText,
} from "@/components/optics/floating-toolbar";
import { cn } from "@/lib/cn";
import { computeEdgeRoutesSmart } from "@/lib/flowLayout";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 116;
const CANVAS_HEIGHT = 430;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.8;
const EDGE_COLOR = "#d97757";
const EDGE_PREVIEW_COLOR = "#ec9a7d";
const EDGE_PASS_COLOR = "#4ade80";
const EDGE_FAIL_COLOR = "#f87171";
const CORNER_RADIUS = 22;
const MANUAL_CORNER_RADIUS = 14;
const ANCHOR_LEAD = 34;
const PORT_HIT_SIZE = 22;
const NODE_COLLISION_GAP = 16;
const MAX_COLLISION_PASSES = 12;
const NEAR_DIRECT_GAP = 96;
const DIRECT_AXIS_TOLERANCE = 6;
const EDGE_ANCHOR_INSET = 18;
const CENTER_ANCHOR_SNAP = 28;
const AXIS_ACTIVATION_DISTANCE = 24;
const AXIS_SWITCH_HYSTERESIS = 72;
const HORIZONTAL_AXIS_BIAS = 1.08;
const CANONICAL_APPROACH_MIN = 40;
const CANONICAL_BALANCE_WEIGHT = 2.2;
const MANUAL_STRAIGHT_SNAP = 18;
const MIN_KINK_SEGMENT = 12;
const MIN_ROUNDED_CORNER_SEGMENT = 22;
const MANUAL_LANE_MIN_GAP = 28;
const TIGHT_HOOK_MAX_BRIDGE = 26;
const ROUTE_HISTORY_LIMIT = 80;

interface FlowNode {
  id: string;
  name: string;
  role: AgentRole;
  providerId: ProviderId;
  model: string;
  position: {
    x: number;
    y: number;
  };
}

interface FlowLink {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  condition?: LinkCondition;
}

interface PipelineCanvasSelection {
  nodeIds: string[];
  primaryNodeId: string | null;
  linkId: string | null;
  isDragStart?: boolean;
}

interface NodePositionUpdate {
  nodeId: string;
  position: {
    x: number;
    y: number;
  };
}

interface PipelineCanvasProps {
  nodes: FlowNode[];
  links: FlowLink[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedLinkId: string | null;
  onSelectionChange: (selection: PipelineCanvasSelection) => void;
  onAddNode: () => void;
  onAutoLayout?: () => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onMoveNodes?: (updates: NodePositionUpdate[]) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDeleteLink?: (linkId: string) => void;
  className?: string;
  showToolbar?: boolean;
  canvasHeight?: number | string;
}

interface DragState {
  anchorNodeId: string;
  offsetX: number;
  offsetY: number;
  initialPositions: NodePositionUpdate[];
}

interface PanState {
  startPointerX: number;
  startPointerY: number;
  startViewportX: number;
  startViewportY: number;
}

interface ConnectingState {
  sourceNodeId: string;
  pointer: {
    x: number;
    y: number;
  };
  targetNodeId: string | null;
}

interface MarqueeState {
  additive: boolean;
  startCanvas: Point;
  currentCanvas: Point;
  startWorld: Point;
  currentWorld: Point;
}

interface RouteAdjustState {
  linkId: string;
  offsetX: number;
  offsetY: number;
}

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type AnchorSide = "left" | "right" | "top" | "bottom";
type RouteAxis = "horizontal" | "vertical";

interface CanonicalRouteCandidate {
  axis: RouteAxis;
  route: Point[];
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
}

interface OrchestratorLaneMeta {
  orchestratorId: string;
  side: AnchorSide;
  index: number;
  count: number;
}

interface ReciprocalLaneMeta {
  offset: number;
}

const ANCHOR_SIDES: AnchorSide[] = ["left", "right", "top", "bottom"];

function cloneManualRoutePoints(points: Record<string, Point>): Record<string, Point> {
  return Object.fromEntries(
    Object.entries(points).map(([linkId, point]) => [linkId, { x: point.x, y: point.y }])
  );
}

function manualRoutePointsEqual(left: Record<string, Point>, right: Record<string, Point>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    const leftPoint = left[key];
    const rightPoint = right[key];
    if (!leftPoint || !rightPoint) {
      return false;
    }

    if (leftPoint.x !== rightPoint.x || leftPoint.y !== rightPoint.y) {
      return false;
    }
  }

  return true;
}

function pushRouteHistorySnapshot(
  stack: Record<string, Point>[],
  snapshot: Record<string, Point>
): Record<string, Point>[] {
  if (stack.length >= ROUTE_HISTORY_LIMIT) {
    return [...stack.slice(stack.length - ROUTE_HISTORY_LIMIT + 1), cloneManualRoutePoints(snapshot)];
  }

  return [...stack, cloneManualRoutePoints(snapshot)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function edgePath(source: Point, target: Point): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const controlOffset = clamp(Math.max(dx, 0) * 0.4 + Math.abs(dy) * 0.08, 26, 140);
  return `M ${source.x} ${source.y} C ${source.x + controlOffset} ${source.y}, ${target.x - controlOffset} ${target.y}, ${target.x} ${target.y}`;
}

function nodeRect(node: FlowNode): Rect {
  return {
    left: node.position.x,
    right: node.position.x + NODE_WIDTH,
    top: node.position.y,
    bottom: node.position.y + NODE_HEIGHT
  };
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    right: rect.right + padding,
    top: rect.top - padding,
    bottom: rect.bottom + padding
  };
}

function rangeOverlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  const minA = Math.min(a1, a2);
  const maxA = Math.max(a1, a2);
  const minB = Math.min(b1, b2);
  const maxB = Math.max(b1, b2);
  return maxA >= minB && maxB >= minA;
}

function segmentIntersectsRect(start: Point, end: Point, rect: Rect): boolean {
  if (start.x === end.x) {
    return start.x >= rect.left && start.x <= rect.right && rangeOverlaps(start.y, end.y, rect.top, rect.bottom);
  }

  if (start.y === end.y) {
    return start.y >= rect.top && start.y <= rect.bottom && rangeOverlaps(start.x, end.x, rect.left, rect.right);
  }

  return false;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function rectFromPosition(position: { x: number; y: number }): Rect {
  return {
    left: position.x,
    right: position.x + NODE_WIDTH,
    top: position.y,
    bottom: position.y + NODE_HEIGHT
  };
}

function rectFromPoints(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y)
  };
}

function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function findNodeAtPoint(point: Point, nodes: FlowNode[], excludeNodeId?: string): FlowNode | null {
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

function isMultiSelectModifier(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

function resolveNodeCollisionPosition(
  nodeId: string,
  position: { x: number; y: number },
  allNodes: FlowNode[]
): { x: number; y: number } {
  let resolved = {
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
  const others = allNodes.filter((node) => node.id !== nodeId);

  for (let pass = 0; pass < MAX_COLLISION_PASSES; pass += 1) {
    const selfBaseRect = rectFromPosition(resolved);
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

      const selfCenter = rectCenter(selfBaseRect);
      const otherCenter = rectCenter(otherBaseRect);

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

function normalizeRoute(points: Point[]): Point[] {
  if (points.length <= 2) {
    return points;
  }

  const compact: Point[] = [];

  for (const point of points) {
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

  let changed = true;
  while (changed) {
    changed = false;

    for (let index = 1; index < compact.length; index += 1) {
      const prev = compact[index - 1];
      const current = compact[index];
      if (prev.x === current.x && prev.y === current.y) {
        compact.splice(index, 1);
        changed = true;
        index -= 1;
      }
    }

    for (let index = 1; index < compact.length - 1; index += 1) {
      const prev = compact[index - 1];
      const current = compact[index];
      const next = compact[index + 1];
      const inLen = Math.abs(current.x - prev.x) + Math.abs(current.y - prev.y);
      const outLen = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
      const returnsToAxis = prev.x === next.x || prev.y === next.y;
      if (returnsToAxis && (inLen <= MIN_KINK_SEGMENT || outLen <= MIN_KINK_SEGMENT)) {
        compact.splice(index, 1);
        changed = true;
        index = Math.max(index - 2, 0);
      }
    }

    for (let index = 0; index < compact.length - 3; index += 1) {
      const a = compact[index];
      const b = compact[index + 1];
      const c = compact[index + 2];
      const d = compact[index + 3];

      const bridgeHorizontal = b.y === c.y && Math.abs(c.x - b.x) <= TIGHT_HOOK_MAX_BRIDGE;
      const bridgeVertical = b.x === c.x && Math.abs(c.y - b.y) <= TIGHT_HOOK_MAX_BRIDGE;

      if (bridgeHorizontal && a.x === b.x && c.x === d.x) {
        const inSign = Math.sign(b.y - a.y);
        const outSign = Math.sign(d.y - c.y);
        if (inSign !== 0 && outSign !== 0 && inSign !== outSign) {
          const pivot: Point = { x: a.x, y: d.y };
          compact.splice(index + 1, 2, pivot);
          changed = true;
          index = Math.max(index - 2, -1);
          continue;
        }
      }

      if (bridgeVertical && a.y === b.y && c.y === d.y) {
        const inSign = Math.sign(b.x - a.x);
        const outSign = Math.sign(d.x - c.x);
        if (inSign !== 0 && outSign !== 0 && inSign !== outSign) {
          const pivot: Point = { x: d.x, y: a.y };
          compact.splice(index + 1, 2, pivot);
          changed = true;
          index = Math.max(index - 2, -1);
        }
      }
    }

    for (let index = 2; index < compact.length; index += 1) {
      const prev2 = compact[index - 2];
      const current = compact[index];
      if (prev2.x === current.x && prev2.y === current.y) {
        compact.splice(index - 1, 2);
        changed = true;
        index = Math.max(index - 2, 1);
      }
    }
  }

  return compact;
}

function routeLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return total;
}

function routeIntersections(points: Point[], obstacles: Rect[]): number {
  let count = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];

    for (const obstacle of obstacles) {
      if (segmentIntersectsRect(start, end, obstacle)) {
        count += 1;
      }
    }
  }

  return count;
}

function routeMidpoint(points: Point[]): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }

  const total = routeLength(points);
  if (total <= 0) {
    return points[0];
  }

  const half = total / 2;
  let walked = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (walked + segment < half) {
      walked += segment;
      continue;
    }

    const remain = half - walked;
    if (start.x === end.x) {
      const sign = end.y >= start.y ? 1 : -1;
      return {
        x: start.x,
        y: start.y + sign * remain
      };
    }

    const sign = end.x >= start.x ? 1 : -1;
    return {
      x: start.x + sign * remain,
      y: start.y
    };
  }

  return points[points.length - 1];
}

function routePath(points: Point[], requestedCornerRadius: number = CORNER_RADIUS): string {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y}`;
  }

  const normalize = (value: number): number => (value === 0 ? 0 : value / Math.abs(value));
  const first = points[0];
  const commands: string[] = [`M ${first.x} ${first.y}`];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    const dx1 = current.x - previous.x;
    const dy1 = current.y - previous.y;
    const dx2 = next.x - current.x;
    const dy2 = next.y - current.y;

    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 < MIN_ROUNDED_CORNER_SEGMENT || len2 < MIN_ROUNDED_CORNER_SEGMENT) {
      commands.push(`L ${current.x} ${current.y}`);
      continue;
    }

    const cornerRadius = Math.min(requestedCornerRadius, len1 / 2, len2 / 2);

    if (cornerRadius <= 0.001) {
      commands.push(`L ${current.x} ${current.y}`);
      continue;
    }

    const p1 = {
      x: current.x - normalize(dx1) * cornerRadius,
      y: current.y - normalize(dy1) * cornerRadius
    };
    const p2 = {
      x: current.x + normalize(dx2) * cornerRadius,
      y: current.y + normalize(dy2) * cornerRadius
    };

    commands.push(`L ${p1.x} ${p1.y}`);
    commands.push(`Q ${current.x} ${current.y} ${p2.x} ${p2.y}`);
  }

  const last = points[points.length - 1];
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

function edgeVisual(condition: LinkCondition | undefined): { stroke: string; markerId: string } {
  if (condition === "on_pass") {
    return { stroke: EDGE_PASS_COLOR, markerId: "flow-arrow-pass" };
  }
  if (condition === "on_fail") {
    return { stroke: EDGE_FAIL_COLOR, markerId: "flow-arrow-fail" };
  }
  return { stroke: EDGE_COLOR, markerId: "flow-arrow" };
}

function edgeStrokeDasharray(sourceRole: AgentRole, targetRole: AgentRole): string | null {
  const involvesOrchestrator = sourceRole === "orchestrator" || targetRole === "orchestrator";
  return involvesOrchestrator ? null : "8 7";
}

function edgeInvolvesOrchestrator(sourceRole: AgentRole, targetRole: AgentRole): boolean {
  return sourceRole === "orchestrator" || targetRole === "orchestrator";
}

function rectCenter(rect: Rect): Point {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2
  };
}

function anchorPoint(rect: Rect, side: AnchorSide, toward: Point): Point {
  const center = rectCenter(rect);

  if (side === "left") {
    const clampedY = clamp(toward.y, rect.top + EDGE_ANCHOR_INSET, rect.bottom - EDGE_ANCHOR_INSET);
    const snappedY = Math.abs(clampedY - center.y) <= CENTER_ANCHOR_SNAP ? center.y : clampedY;
    return {
      x: rect.left,
      y: snappedY
    };
  }

  if (side === "right") {
    const clampedY = clamp(toward.y, rect.top + EDGE_ANCHOR_INSET, rect.bottom - EDGE_ANCHOR_INSET);
    const snappedY = Math.abs(clampedY - center.y) <= CENTER_ANCHOR_SNAP ? center.y : clampedY;
    return {
      x: rect.right,
      y: snappedY
    };
  }

  if (side === "top") {
    const clampedX = clamp(toward.x, rect.left + EDGE_ANCHOR_INSET, rect.right - EDGE_ANCHOR_INSET);
    const snappedX = Math.abs(clampedX - center.x) <= CENTER_ANCHOR_SNAP ? center.x : clampedX;
    return {
      x: snappedX,
      y: rect.top
    };
  }

  const clampedX = clamp(toward.x, rect.left + EDGE_ANCHOR_INSET, rect.right - EDGE_ANCHOR_INSET);
  const snappedX = Math.abs(clampedX - center.x) <= CENTER_ANCHOR_SNAP ? center.x : clampedX;
  return {
    x: snappedX,
    y: rect.bottom
  };
}

function sideCenterPoint(rect: Rect, side: AnchorSide): Point {
  const center = rectCenter(rect);

  if (side === "left") {
    return { x: rect.left, y: center.y };
  }

  if (side === "right") {
    return { x: rect.right, y: center.y };
  }

  if (side === "top") {
    return { x: center.x, y: rect.top };
  }

  return { x: center.x, y: rect.bottom };
}

function sideDistributedPoint(rect: Rect, side: AnchorSide, index: number, count: number): Point {
  if (count <= 1) {
    return sideCenterPoint(rect, side);
  }

  const safeCount = Math.max(count, 1);
  const t = (index + 1) / (safeCount + 1);

  if (side === "left" || side === "right") {
    const minY = rect.top + EDGE_ANCHOR_INSET;
    const maxY = rect.bottom - EDGE_ANCHOR_INSET;
    const y = Math.round(minY + (maxY - minY) * t);
    return { x: side === "left" ? rect.left : rect.right, y };
  }

  const minX = rect.left + EDGE_ANCHOR_INSET;
  const maxX = rect.right - EDGE_ANCHOR_INSET;
  const x = Math.round(minX + (maxX - minX) * t);
  return { x, y: side === "top" ? rect.top : rect.bottom };
}

function sideFacingCoordinateAnchor(rect: Rect, side: AnchorSide): Point {
  const center = rectCenter(rect);
  if (side === "left") {
    return { x: rect.left, y: center.y };
  }
  if (side === "right") {
    return { x: rect.right, y: center.y };
  }
  if (side === "top") {
    return { x: center.x, y: rect.top };
  }
  return { x: center.x, y: rect.bottom };
}

function uniquePoints(points: Point[]): Point[] {
  const uniq: Point[] = [];
  for (const point of points) {
    if (uniq.some((entry) => entry.x === point.x && entry.y === point.y)) {
      continue;
    }
    uniq.push(point);
  }
  return uniq;
}

function anchorDirection(side: AnchorSide): Point {
  if (side === "left") {
    return { x: -1, y: 0 };
  }

  if (side === "right") {
    return { x: 1, y: 0 };
  }

  if (side === "top") {
    return { x: 0, y: -1 };
  }

  return { x: 0, y: 1 };
}

function preferredSide(from: Rect, to: Rect): AnchorSide {
  const fromCenter = rectCenter(from);
  const toCenter = rectCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }

  return dy >= 0 ? "bottom" : "top";
}

function sidePenalty(side: AnchorSide, preferred: AnchorSide): number {
  if (side === preferred) {
    return 0;
  }

  const isHorizontal = side === "left" || side === "right";
  const preferredHorizontal = preferred === "left" || preferred === "right";
  return isHorizontal === preferredHorizontal ? 220 : 360;
}

function sideFacingPenalty(sourceRect: Rect, targetRect: Rect, sourceSide: AnchorSide, targetSide: AnchorSide): number {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const sourceDirection = anchorDirection(sourceSide);
  const targetDirection = anchorDirection(targetSide);

  const sourceToTarget = {
    x: targetCenter.x - sourceCenter.x,
    y: targetCenter.y - sourceCenter.y
  };
  const targetToSource = {
    x: sourceCenter.x - targetCenter.x,
    y: sourceCenter.y - targetCenter.y
  };

  const sourceFacing = sourceToTarget.x * sourceDirection.x + sourceToTarget.y * sourceDirection.y;
  const targetFacing = targetToSource.x * targetDirection.x + targetToSource.y * targetDirection.y;

  let penalty = 0;

  if (sourceFacing < 0) {
    penalty += 50000;
  } else if (sourceFacing < 14) {
    penalty += 4000;
  }

  if (targetFacing < 0) {
    penalty += 50000;
  } else if (targetFacing < 14) {
    penalty += 4000;
  }

  return penalty;
}

function dominantAxisPenalty(sourceRect: Rect, targetRect: Rect, sourceSide: AnchorSide, targetSide: AnchorSide): number {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = Math.abs(targetCenter.x - sourceCenter.x);
  const dy = Math.abs(targetCenter.y - sourceCenter.y);
  const verticalDominant = dy >= dx * 1.25;
  const horizontalDominant = dx >= dy * 1.25;

  if (!verticalDominant && !horizontalDominant) {
    return 0;
  }

  let penalty = 0;

  if (verticalDominant) {
    if (!isVerticalSide(sourceSide)) {
      penalty += 26000;
    }
    if (!isVerticalSide(targetSide)) {
      penalty += 26000;
    }
    return penalty;
  }

  if (!isHorizontalSide(sourceSide)) {
    penalty += 26000;
  }
  if (!isHorizontalSide(targetSide)) {
    penalty += 26000;
  }

  return penalty;
}

function uniqueNumbers(values: number[]): number[] {
  const rounded = values.map((value) => Math.round(value));
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of rounded) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function segmentLength(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function candidateSegmentPenalty(route: Point[]): number {
  if (route.length < 2) {
    return 0;
  }

  const first = route[0];
  const second = route[1];
  const beforeLast = route[route.length - 2];
  const last = route[route.length - 1];
  const exitLength = segmentLength(first, second);
  const entryLength = segmentLength(beforeLast, last);
  const shortExitPenalty = exitLength < CANONICAL_APPROACH_MIN ? (CANONICAL_APPROACH_MIN - exitLength) * 1400 : 0;
  const shortEntryPenalty = entryLength < CANONICAL_APPROACH_MIN ? (CANONICAL_APPROACH_MIN - entryLength) * 1400 : 0;
  return shortExitPenalty + shortEntryPenalty;
}

function routeBalancePenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  if (candidate.route.length < 4) {
    return 0;
  }

  if (candidate.axis === "horizontal") {
    const start = sideCenterPoint(sourceRect, candidate.sourceSide);
    const end = sideCenterPoint(targetRect, candidate.targetSide);
    const preferredBendX = (start.x + end.x) / 2;
    const bendX = candidate.route[1]?.x ?? preferredBendX;
    return Math.abs(bendX - preferredBendX) * CANONICAL_BALANCE_WEIGHT;
  }

  const start = sideCenterPoint(sourceRect, candidate.sourceSide);
  const end = sideCenterPoint(targetRect, candidate.targetSide);
  const preferredBendY = (start.y + end.y) / 2;
  const bendY = candidate.route[1]?.y ?? preferredBendY;
  return Math.abs(bendY - preferredBendY) * CANONICAL_BALANCE_WEIGHT;
}

function buildHorizontalCanonicalCandidates(sourceRect: Rect, targetRect: Rect): CanonicalRouteCandidate[] {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = targetCenter.x - sourceCenter.x;
  const sourceSide: AnchorSide = dx >= 0 ? "right" : "left";
  const targetSide: AnchorSide = dx >= 0 ? "left" : "right";
  const start = sideCenterPoint(sourceRect, sourceSide);
  const end = sideCenterPoint(targetRect, targetSide);
  const candidates: CanonicalRouteCandidate[] = [];

  const direct = normalizeRoute([start, end]);
  if (start.y === end.y) {
    candidates.push({
      axis: "horizontal",
      route: direct,
      sourceSide,
      targetSide
    });
  }

  const minLane = Math.min(start.x, end.x) + CANONICAL_APPROACH_MIN;
  const maxLane = Math.max(start.x, end.x) - CANONICAL_APPROACH_MIN;
  const laneRangeValid = minLane <= maxLane;
  const centerLane = (start.x + end.x) / 2;
  const towardSourceLane = start.x + (end.x - start.x) * 0.38;
  const towardTargetLane = start.x + (end.x - start.x) * 0.62;
  const laneCandidates = laneRangeValid
    ? uniqueNumbers([
        clamp(centerLane, minLane, maxLane),
        clamp(towardSourceLane, minLane, maxLane),
        clamp(towardTargetLane, minLane, maxLane)
      ])
    : uniqueNumbers([centerLane]);

  for (const laneX of laneCandidates) {
    candidates.push({
      axis: "horizontal",
      route: normalizeRoute([
        start,
        { x: laneX, y: start.y },
        { x: laneX, y: end.y },
        end
      ]),
      sourceSide,
      targetSide
    });
  }

  return candidates;
}

function buildVerticalCanonicalCandidates(sourceRect: Rect, targetRect: Rect): CanonicalRouteCandidate[] {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dy = targetCenter.y - sourceCenter.y;
  const sourceSide: AnchorSide = dy >= 0 ? "bottom" : "top";
  const targetSide: AnchorSide = dy >= 0 ? "top" : "bottom";
  const start = sideCenterPoint(sourceRect, sourceSide);
  const end = sideCenterPoint(targetRect, targetSide);
  const candidates: CanonicalRouteCandidate[] = [];

  const direct = normalizeRoute([start, end]);
  if (start.x === end.x) {
    candidates.push({
      axis: "vertical",
      route: direct,
      sourceSide,
      targetSide
    });
  }

  const minLane = Math.min(start.y, end.y) + CANONICAL_APPROACH_MIN;
  const maxLane = Math.max(start.y, end.y) - CANONICAL_APPROACH_MIN;
  const laneRangeValid = minLane <= maxLane;
  const centerLane = (start.y + end.y) / 2;
  const towardSourceLane = start.y + (end.y - start.y) * 0.38;
  const towardTargetLane = start.y + (end.y - start.y) * 0.62;
  const laneCandidates = laneRangeValid
    ? uniqueNumbers([
        clamp(centerLane, minLane, maxLane),
        clamp(towardSourceLane, minLane, maxLane),
        clamp(towardTargetLane, minLane, maxLane)
      ])
    : uniqueNumbers([centerLane]);

  for (const laneY of laneCandidates) {
    candidates.push({
      axis: "vertical",
      route: normalizeRoute([
        start,
        { x: start.x, y: laneY },
        { x: end.x, y: laneY },
        end
      ]),
      sourceSide,
      targetSide
    });
  }

  return candidates;
}

function canonicalFacingPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  return sideFacingPenalty(sourceRect, targetRect, candidate.sourceSide, candidate.targetSide);
}

function canonicalEndpointPenalty(candidate: CanonicalRouteCandidate): number {
  return endpointDirectionPenalty(candidate.route, candidate.sourceSide, candidate.targetSide);
}

function canonicalAxisPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  return dominantAxisPenalty(sourceRect, targetRect, candidate.sourceSide, candidate.targetSide);
}

function canonicalSidePenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  const preferredSource = preferredSide(sourceRect, targetRect);
  const preferredTarget = preferredSide(targetRect, sourceRect);
  return sidePenalty(candidate.sourceSide, preferredSource) + sidePenalty(candidate.targetSide, preferredTarget);
}

function canonicalCenterBiasPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  const first = candidate.route[0];
  const last = candidate.route[candidate.route.length - 1];
  const sourceCenterAnchor = sideCenterPoint(sourceRect, candidate.sourceSide);
  const targetCenterAnchor = sideCenterPoint(targetRect, candidate.targetSide);
  return (
    (Math.abs(first.x - sourceCenterAnchor.x) + Math.abs(first.y - sourceCenterAnchor.y)) * 25 +
    (Math.abs(last.x - targetCenterAnchor.x) + Math.abs(last.y - targetCenterAnchor.y)) * 25
  );
}

function canonicalAxisFitPenalty(candidate: CanonicalRouteCandidate, sourceRect: Rect, targetRect: Rect): number {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = Math.abs(targetCenter.x - sourceCenter.x);
  const dy = Math.abs(targetCenter.y - sourceCenter.y);
  return candidate.axis === "horizontal"
    ? Math.max(0, dy - dx * HORIZONTAL_AXIS_BIAS) * 2
    : Math.max(0, dx * HORIZONTAL_AXIS_BIAS - dy) * 2;
}

function canonicalSwitchPenalty(candidate: CanonicalRouteCandidate, previousAxis: RouteAxis | null): number {
  return previousAxis && previousAxis !== candidate.axis ? AXIS_SWITCH_HYSTERESIS * 5 : 0;
}

function canonicalDefaultBiasPenalty(candidate: CanonicalRouteCandidate, previousAxis: RouteAxis | null): number {
  return !previousAxis && candidate.axis === "vertical" ? 42 : 0;
}

function canonicalIntersectionPenalty(candidate: CanonicalRouteCandidate, obstacles: Rect[]): number {
  return routeIntersections(candidate.route, obstacles) * 140000;
}

function canonicalBendPenalty(candidate: CanonicalRouteCandidate): number {
  const bends = Math.max(candidate.route.length - 2, 0);
  return bends * 420;
}

function canonicalLengthPenalty(candidate: CanonicalRouteCandidate): number {
  return routeLength(candidate.route);
}

function canonicalRouteScore(
  candidate: CanonicalRouteCandidate,
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: Rect[],
  previousAxis: RouteAxis | null
): number {
  return (
    canonicalIntersectionPenalty(candidate, obstacles) +
    canonicalBendPenalty(candidate) +
    canonicalLengthPenalty(candidate) +
    canonicalCenterBiasPenalty(candidate, sourceRect, targetRect) +
    canonicalAxisFitPenalty(candidate, sourceRect, targetRect) +
    canonicalSwitchPenalty(candidate, previousAxis) +
    canonicalDefaultBiasPenalty(candidate, previousAxis) +
    canonicalSidePenalty(candidate, sourceRect, targetRect) * 40 +
    canonicalAxisPenalty(candidate, sourceRect, targetRect) +
    canonicalFacingPenalty(candidate, sourceRect, targetRect) +
    canonicalEndpointPenalty(candidate) +
    candidateSegmentPenalty(candidate.route) +
    routeBalancePenalty(candidate, sourceRect, targetRect)
  );
}

function canonicalCandidateScore(
  candidate: CanonicalRouteCandidate,
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: Rect[],
  previousAxis: RouteAxis | null
): number {
  return canonicalRouteScore(candidate, sourceRect, targetRect, obstacles, previousAxis);
}

function dominantAxisCanonicalRoute(
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: Rect[],
  previousAxis: RouteAxis | null
): { route: Point[]; axis: RouteAxis } | null {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = Math.abs(targetCenter.x - sourceCenter.x);
  const dy = Math.abs(targetCenter.y - sourceCenter.y);

  if (dx < AXIS_ACTIVATION_DISTANCE && dy < AXIS_ACTIVATION_DISTANCE) {
    return null;
  }

  const candidates: CanonicalRouteCandidate[] = [
    ...buildHorizontalCanonicalCandidates(sourceRect, targetRect),
    ...buildVerticalCanonicalCandidates(sourceRect, targetRect)
  ];

  let best: CanonicalRouteCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = canonicalCandidateScore(candidate, sourceRect, targetRect, obstacles, previousAxis);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best ? { route: best.route, axis: best.axis } : null;
}

function sidePairAllowed(sourceRect: Rect, targetRect: Rect, sourceSide: AnchorSide, targetSide: AnchorSide): boolean {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const verticalDominant = absY >= absX * 1.25;
  const horizontalDominant = absX >= absY * 1.25;

  if (verticalDominant) {
    const expectedSource: AnchorSide = dy >= 0 ? "bottom" : "top";
    const expectedTarget: AnchorSide = dy >= 0 ? "top" : "bottom";
    return sourceSide === expectedSource && targetSide === expectedTarget;
  }

  if (horizontalDominant) {
    const expectedSource: AnchorSide = dx >= 0 ? "right" : "left";
    const expectedTarget: AnchorSide = dx >= 0 ? "left" : "right";
    return sourceSide === expectedSource && targetSide === expectedTarget;
  }

  return true;
}

function isVerticalSide(side: AnchorSide): boolean {
  return side === "top" || side === "bottom";
}

function isHorizontalSide(side: AnchorSide): boolean {
  return side === "left" || side === "right";
}

function oppositeSides(a: AnchorSide, b: AnchorSide): boolean {
  return (
    (a === "left" && b === "right") ||
    (a === "right" && b === "left") ||
    (a === "top" && b === "bottom") ||
    (a === "bottom" && b === "top")
  );
}

function endpointDirectionPenalty(route: Point[], sourceSide: AnchorSide, targetSide: AnchorSide): number {
  if (route.length < 2) {
    return 0;
  }

  const first = route[0];
  const second = route[1];
  const beforeLast = route[route.length - 2];
  const last = route[route.length - 1];
  const sourceDir = anchorDirection(sourceSide);
  const targetDir = anchorDirection(targetSide);
  const fromSource = {
    x: second.x - first.x,
    y: second.y - first.y
  };
  const intoTarget = {
    x: last.x - beforeLast.x,
    y: last.y - beforeLast.y
  };
  const sourceDot = fromSource.x * sourceDir.x + fromSource.y * sourceDir.y;
  const targetDot = intoTarget.x * -targetDir.x + intoTarget.y * -targetDir.y;
  let penalty = 0;

  if (sourceDot < 0) {
    penalty += 90000;
  } else if (sourceDot === 0) {
    penalty += 1200;
  }

  if (targetDot < 0) {
    penalty += 90000;
  } else if (targetDot === 0) {
    penalty += 1200;
  }

  return penalty;
}

function axisReversalPenalty(route: Point[], sourceSide: AnchorSide, targetSide: AnchorSide): number {
  if (route.length < 3) {
    return 0;
  }

  const verticalPair = isVerticalSide(sourceSide) && isVerticalSide(targetSide);
  const horizontalPair = isHorizontalSide(sourceSide) && isHorizontalSide(targetSide);
  if (!verticalPair && !horizontalPair) {
    return 0;
  }

  let reversals = 0;
  let prevSign = 0;

  for (let index = 1; index < route.length; index += 1) {
    const delta = verticalPair ? route[index].y - route[index - 1].y : route[index].x - route[index - 1].x;
    if (delta === 0) {
      continue;
    }

    const sign = delta > 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== prevSign) {
      reversals += 1;
    }
    prevSign = sign;
  }

  return reversals > 1 ? (reversals - 1) * 70000 : 0;
}

function routeAxisFromEndpoints(route: Point[]): RouteAxis | null {
  if (route.length < 2) {
    return null;
  }

  const start = route[0];
  const end = route[route.length - 1];
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? "horizontal" : "vertical";
}

function simpleOrchestratorLaneMeta(sourceNode: FlowNode, targetNode: FlowNode): OrchestratorLaneMeta | null {
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

function buildOrchestratorBusRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  orchestratorLane: OrchestratorLaneMeta
): Point[] | null {
  const orchestratorNode = sourceNode.id === orchestratorLane.orchestratorId
    ? sourceNode
    : targetNode.id === orchestratorLane.orchestratorId
      ? targetNode
      : null;
  if (!orchestratorNode) {
    return null;
  }

  const otherNode = orchestratorNode.id === sourceNode.id ? targetNode : sourceNode;
  const outgoing = orchestratorNode.id === sourceNode.id;
  const orchestratorRect = nodeRect(orchestratorNode);
  const otherRect = nodeRect(otherNode);
  const side = orchestratorLane.side;
  const spread = (orchestratorLane.index - (orchestratorLane.count - 1) / 2) * 18;
  const baseDistance = ANCHOR_LEAD + 42;
  const orchestratorAnchor = sideDistributedPoint(
    orchestratorRect,
    side,
    orchestratorLane.index,
    orchestratorLane.count
  );
  const otherCenter = rectCenter(otherRect);

  if (side === "left" || side === "right") {
    const busX =
      side === "right"
        ? orchestratorRect.right + baseDistance + spread
        : orchestratorRect.left - baseDistance - spread;
    const otherSide: AnchorSide = busX >= otherCenter.x ? "right" : "left";
    const otherAnchor = sideFacingCoordinateAnchor(otherRect, otherSide);
    const route = normalizeRoute([
      orchestratorAnchor,
      { x: busX, y: orchestratorAnchor.y },
      { x: busX, y: otherAnchor.y },
      otherAnchor
    ]);
    return outgoing ? route : normalizeRoute([...route].reverse());
  }

  const busY =
    side === "bottom"
      ? orchestratorRect.bottom + baseDistance + spread
      : orchestratorRect.top - baseDistance - spread;
  const otherSide: AnchorSide = busY >= otherCenter.y ? "bottom" : "top";
  const otherAnchor = sideFacingCoordinateAnchor(otherRect, otherSide);
  const route = normalizeRoute([
    orchestratorAnchor,
    { x: orchestratorAnchor.x, y: busY },
    { x: otherAnchor.x, y: busY },
    otherAnchor
  ]);
  return outgoing ? route : normalizeRoute([...route].reverse());
}

function buildReciprocalPairRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  reciprocalLane: ReciprocalLaneMeta
): Point[] {
  const sourceRect = nodeRect(sourceNode);
  const targetRect = nodeRect(targetNode);
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const leg = Math.max(CANONICAL_APPROACH_MIN, ANCHOR_LEAD + 12);

  if (Math.abs(dx) >= Math.abs(dy)) {
    const sourceSide: AnchorSide = dx >= 0 ? "right" : "left";
    const targetSide: AnchorSide = dx >= 0 ? "left" : "right";
    const start = sideCenterPoint(sourceRect, sourceSide);
    const end = sideCenterPoint(targetRect, targetSide);
    const dir = dx >= 0 ? 1 : -1;
    const laneY = Math.round((start.y + end.y) / 2 + reciprocalLane.offset);

    return normalizeRoute([
      start,
      { x: start.x + dir * leg, y: start.y },
      { x: start.x + dir * leg, y: laneY },
      { x: end.x - dir * leg, y: laneY },
      { x: end.x - dir * leg, y: end.y },
      end
    ]);
  }

  const sourceSide: AnchorSide = dy >= 0 ? "bottom" : "top";
  const targetSide: AnchorSide = dy >= 0 ? "top" : "bottom";
  const start = sideCenterPoint(sourceRect, sourceSide);
  const end = sideCenterPoint(targetRect, targetSide);
  const dir = dy >= 0 ? 1 : -1;
  const laneX = Math.round((start.x + end.x) / 2 + reciprocalLane.offset);

  return normalizeRoute([
    start,
    { x: start.x, y: start.y + dir * leg },
    { x: laneX, y: start.y + dir * leg },
    { x: laneX, y: end.y - dir * leg },
    { x: end.x, y: end.y - dir * leg },
    end
  ]);
}

function sideTowardPoint(rect: Rect, point: Point): AnchorSide {
  const center = rectCenter(rect);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

function snapManualWaypointAxis(point: Point, start: Point, end: Point): Point {
  const verticalDominant = Math.abs(end.y - start.y) >= Math.abs(end.x - start.x);

  if (verticalDominant) {
    const candidates = [start.x, end.x, (start.x + end.x) / 2];
    let snapX: number | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const delta = Math.abs(point.x - candidate);
      if (delta <= MANUAL_STRAIGHT_SNAP && delta < bestDelta) {
        bestDelta = delta;
        snapX = candidate;
      }
    }

    return {
      x: Math.round(snapX ?? point.x),
      y: Math.round(point.y)
    };
  }

  const candidates = [start.y, end.y, (start.y + end.y) / 2];
  let snapY: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const delta = Math.abs(point.y - candidate);
    if (delta <= MANUAL_STRAIGHT_SNAP && delta < bestDelta) {
      bestDelta = delta;
      snapY = candidate;
    }
  }

  return {
    x: Math.round(point.x),
    y: Math.round(snapY ?? point.y)
  };
}

function stabilizeManualLane(value: number, startLeadValue: number, endLeadValue: number): number {
  if (Math.abs(value - startLeadValue) <= MANUAL_LANE_MIN_GAP) {
    return startLeadValue;
  }
  if (Math.abs(value - endLeadValue) <= MANUAL_LANE_MIN_GAP) {
    return endLeadValue;
  }
  return value;
}

function pointToOrthogonalSegmentDistance(point: Point, start: Point, end: Point): number {
  if (start.x === end.x) {
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const clampedY = clamp(point.y, minY, maxY);
    return Math.hypot(point.x - start.x, point.y - clampedY);
  }

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const clampedX = clamp(point.x, minX, maxX);
  return Math.hypot(point.x - clampedX, point.y - start.y);
}

function routeDistanceToPoint(route: Point[], point: Point): number {
  if (route.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (route.length === 1) {
    return Math.hypot(route[0].x - point.x, route[0].y - point.y);
  }

  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < route.length; index += 1) {
    const distance = pointToOrthogonalSegmentDistance(point, route[index - 1], route[index]);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

function routeShortSegmentPenalty(route: Point[], minLength: number): number {
  if (route.length < 2) {
    return 0;
  }

  let penalty = 0;
  for (let index = 1; index < route.length; index += 1) {
    const length = segmentLength(route[index - 1], route[index]);
    const endpointSegment = index === 1 || index === route.length - 1;
    const threshold = endpointSegment ? Math.max(CANONICAL_APPROACH_MIN, minLength) : minLength;
    if (length < threshold) {
      penalty += (threshold - length) * (endpointSegment ? 1800 : 1050);
    }
  }

  return penalty;
}

function routeBacktrackPenalty(route: Point[]): number {
  if (route.length < 3) {
    return 0;
  }

  let horizontalSign = 0;
  let verticalSign = 0;
  let penalty = 0;

  for (let index = 1; index < route.length; index += 1) {
    const dx = route[index].x - route[index - 1].x;
    const dy = route[index].y - route[index - 1].y;

    if (dx !== 0) {
      const sign = dx > 0 ? 1 : -1;
      if (horizontalSign !== 0 && horizontalSign !== sign) {
        penalty += 26000;
      }
      horizontalSign = sign;
    }

    if (dy !== 0) {
      const sign = dy > 0 ? 1 : -1;
      if (verticalSign !== 0 && verticalSign !== sign) {
        penalty += 26000;
      }
      verticalSign = sign;
    }
  }

  return penalty;
}

function buildManualWaypointRoute(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  manualWaypoint: Point,
  obstacles: Rect[]
): Point[] {
  const sourceRect = nodeRect(sourceNode);
  const targetRect = nodeRect(targetNode);
  const sourceSide = sideTowardPoint(sourceRect, manualWaypoint);
  const targetSide = sideTowardPoint(targetRect, manualWaypoint);
  const start = anchorPoint(sourceRect, sourceSide, manualWaypoint);
  const end = anchorPoint(targetRect, targetSide, manualWaypoint);
  const sourceDir = anchorDirection(sourceSide);
  const targetDir = anchorDirection(targetSide);
  const snappedWaypoint = snapManualWaypointAxis(manualWaypoint, start, end);
  const startLead: Point = {
    x: start.x + sourceDir.x * ANCHOR_LEAD,
    y: start.y + sourceDir.y * ANCHOR_LEAD
  };
  const endLead: Point = {
    x: end.x + targetDir.x * ANCHOR_LEAD,
    y: end.y + targetDir.y * ANCHOR_LEAD
  };
  const stabilizedWaypoint: Point = {
    x: Math.round(stabilizeManualLane(snappedWaypoint.x, startLead.x, endLead.x)),
    y: Math.round(stabilizeManualLane(snappedWaypoint.y, startLead.y, endLead.y))
  };
  const verticalDominant = Math.abs(endLead.y - startLead.y) >= Math.abs(endLead.x - startLead.x);
  const laneXCandidates = uniqueNumbers([
    stabilizedWaypoint.x,
    (startLead.x + endLead.x) / 2,
    startLead.x,
    endLead.x
  ]).map((laneX) => Math.round(stabilizeManualLane(laneX, startLead.x, endLead.x)));
  const laneYCandidates = uniqueNumbers([
    stabilizedWaypoint.y,
    (startLead.y + endLead.y) / 2,
    startLead.y,
    endLead.y
  ]).map((laneY) => Math.round(stabilizeManualLane(laneY, startLead.y, endLead.y)));
  const candidates: Point[][] = [];

  for (const laneX of laneXCandidates) {
    candidates.push([
      start,
      startLead,
      { x: laneX, y: startLead.y },
      { x: laneX, y: endLead.y },
      endLead,
      end
    ]);
  }

  for (const laneY of laneYCandidates) {
    candidates.push([
      start,
      startLead,
      { x: startLead.x, y: laneY },
      { x: endLead.x, y: laneY },
      endLead,
      end
    ]);
  }

  if (verticalDominant) {
    candidates.push([
      start,
      startLead,
      { x: stabilizedWaypoint.x, y: startLead.y },
      { x: stabilizedWaypoint.x, y: endLead.y },
      endLead,
      end
    ]);
  } else {
    candidates.push([
      start,
      startLead,
      { x: startLead.x, y: stabilizedWaypoint.y },
      { x: endLead.x, y: stabilizedWaypoint.y },
      endLead,
      end
    ]);
  }

  candidates.push([start, startLead, endLead, end]);

  let bestRoute = normalizeRoute(candidates[0]);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const route = normalizeRoute(candidate);
    const intersections = routeIntersections(route, obstacles);
    const bends = Math.max(route.length - 2, 0);
    const directionPenalty = endpointDirectionPenalty(route, sourceSide, targetSide);
    const reversalPenalty = axisReversalPenalty(route, sourceSide, targetSide) + routeBacktrackPenalty(route);
    const shortSegmentPenalty = routeShortSegmentPenalty(route, MANUAL_LANE_MIN_GAP);
    const waypointPenalty = routeDistanceToPoint(route, stabilizedWaypoint) * 180;
    const score =
      intersections * 130000 +
      bends * 580 +
      directionPenalty +
      reversalPenalty +
      shortSegmentPenalty +
      waypointPenalty +
      routeLength(route);

    if (score < bestScore) {
      bestScore = score;
      bestRoute = route;
    }
  }

  return bestRoute;
}

function buildEdgeRoute(
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
    .map((node) => expandRect(nodeRect(node), 10));

  if (manualWaypoint) {
    const manualRoute = buildManualWaypointRoute(sourceNode, targetNode, manualWaypoint, obstacles);
    return {
      route: manualRoute,
      axis: routeAxisFromEndpoints(manualRoute)
    };
  }

  if (reciprocalLane) {
    const reciprocalRoute = buildReciprocalPairRoute(sourceNode, targetNode, reciprocalLane);
    return {
      route: reciprocalRoute,
      axis: routeAxisFromEndpoints(reciprocalRoute)
    };
  }

  if (orchestratorLane) {
    const orchestratorRoute = buildOrchestratorBusRoute(sourceNode, targetNode, orchestratorLane);
    if (orchestratorRoute) {
      return {
        route: orchestratorRoute,
        axis: routeAxisFromEndpoints(orchestratorRoute)
      };
    }
  }

  const canonical = dominantAxisCanonicalRoute(sourceRect, targetRect, obstacles, previousAxis);
  if (canonical) {
    return canonical;
  }

  const preferredSource = preferredSide(sourceRect, targetRect);
  const preferredTarget = preferredSide(targetRect, sourceRect);
  const preferredStart = sideCenterPoint(sourceRect, preferredSource);
  const preferredEnd = sideCenterPoint(targetRect, preferredTarget);

  if (oppositeSides(preferredSource, preferredTarget)) {
    const directPreferred = normalizeRoute([preferredStart, preferredEnd]);
    const verticalPair = isVerticalSide(preferredSource) && isVerticalSide(preferredTarget);
    const horizontalPair = isHorizontalSide(preferredSource) && isHorizontalSide(preferredTarget);
    const nearEnough =
      (verticalPair && Math.abs(preferredStart.y - preferredEnd.y) <= NEAR_DIRECT_GAP) ||
      (horizontalPair && Math.abs(preferredStart.x - preferredEnd.x) <= NEAR_DIRECT_GAP);
    const axisAligned =
      (verticalPair && Math.abs(preferredStart.x - preferredEnd.x) <= DIRECT_AXIS_TOLERANCE) ||
      (horizontalPair && Math.abs(preferredStart.y - preferredEnd.y) <= DIRECT_AXIS_TOLERANCE);

    if (nearEnough && axisAligned && routeIntersections(directPreferred, obstacles) === 0) {
      const axis: RouteAxis = verticalPair ? "vertical" : "horizontal";
      return {
        route: directPreferred,
        axis
      };
    }
  }

  let bestRoute = normalizeRoute([
    sideCenterPoint(sourceRect, "right"),
    {
      x: sourceRect.right + ANCHOR_LEAD,
      y: sourceRect.top + NODE_HEIGHT / 2
    },
    {
      x: targetRect.left - ANCHOR_LEAD,
      y: targetRect.top + NODE_HEIGHT / 2
    },
    sideCenterPoint(targetRect, "left")
  ]);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const sourceSide of ANCHOR_SIDES) {
    for (const targetSide of ANCHOR_SIDES) {
      if (!sidePairAllowed(sourceRect, targetRect, sourceSide, targetSide)) {
        continue;
      }

      const sourceDirection = anchorDirection(sourceSide);
      const targetDirection = anchorDirection(targetSide);
      const sourceCenterAnchor = sideCenterPoint(sourceRect, sourceSide);
      const targetCenterAnchor = sideCenterPoint(targetRect, targetSide);
      const sourceAdaptiveAnchor = anchorPoint(sourceRect, sourceSide, targetCenter);
      const targetAdaptiveAnchor = anchorPoint(targetRect, targetSide, sourceCenter);
      const sourceAnchors = uniquePoints([sourceCenterAnchor, sourceAdaptiveAnchor]);
      const targetAnchors = uniquePoints([targetCenterAnchor, targetAdaptiveAnchor]);

      for (const start of sourceAnchors) {
        for (const end of targetAnchors) {
          const startLead: Point = {
            x: start.x + sourceDirection.x * ANCHOR_LEAD,
            y: start.y + sourceDirection.y * ANCHOR_LEAD
          };
          const endLead: Point = {
            x: end.x + targetDirection.x * ANCHOR_LEAD,
            y: end.y + targetDirection.y * ANCHOR_LEAD
          };
          const laneOffset = (edgeIndex % 2 === 0 ? -1 : 1) * (12 + (edgeIndex % 3) * 4);
          const midX = (startLead.x + endLead.x) / 2 + laneOffset;
          const midY = (startLead.y + endLead.y) / 2 + laneOffset;

          const candidates: Point[][] = [
            [start, startLead, { x: endLead.x, y: startLead.y }, endLead, end],
            [start, startLead, { x: startLead.x, y: endLead.y }, endLead, end],
            [start, startLead, { x: midX, y: startLead.y }, { x: midX, y: endLead.y }, endLead, end],
            [start, startLead, { x: startLead.x, y: midY }, { x: endLead.x, y: midY }, endLead, end]
          ];

          for (const candidate of candidates) {
            const route = normalizeRoute(candidate);
            const intersections = routeIntersections(route, obstacles);
            const bends = Math.max(route.length - 2, 0);
            const sideScore = sidePenalty(sourceSide, preferredSource) + sidePenalty(targetSide, preferredTarget);
            const oppositePairBonus = oppositeSides(sourceSide, targetSide) ? -220 : 0;
            const facingPenalty = sideFacingPenalty(sourceRect, targetRect, sourceSide, targetSide);
            const axisPenalty = dominantAxisPenalty(sourceRect, targetRect, sourceSide, targetSide);
            const last = route[route.length - 1];
            const beforeLast = route[route.length - 2];
            const first = route[0];
            const second = route[1];
            const finalSegmentLength =
              beforeLast && last ? Math.abs(last.x - beforeLast.x) + Math.abs(last.y - beforeLast.y) : 0;
            const firstSegmentLength =
              first && second ? Math.abs(second.x - first.x) + Math.abs(second.y - first.y) : 0;
            const shortEntryPenalty = finalSegmentLength < 18 ? (18 - finalSegmentLength) * 1200 : 0;
            const shortExitPenalty = firstSegmentLength < 18 ? (18 - firstSegmentLength) * 1200 : 0;
            const directionPenalty = endpointDirectionPenalty(route, sourceSide, targetSide);
            const reversalPenalty = axisReversalPenalty(route, sourceSide, targetSide);
            const centerBiasPenalty =
              (Math.abs(start.x - sourceCenterAnchor.x) + Math.abs(start.y - sourceCenterAnchor.y)) * 70 +
              (Math.abs(end.x - targetCenterAnchor.x) + Math.abs(end.y - targetCenterAnchor.y)) * 70;
            const score =
              intersections * 100000 +
              (sideScore + oppositePairBonus) * 40 +
              centerBiasPenalty +
              facingPenalty +
              axisPenalty +
              shortEntryPenalty +
              shortExitPenalty +
              directionPenalty +
              reversalPenalty +
              bends * 480 +
              routeLength(route);

            if (score < bestScore) {
              bestScore = score;
              bestRoute = route;
            }
          }
        }
      }
    }
  }

  const fallbackAxis: RouteAxis =
    Math.abs(targetCenter.x - sourceCenter.x) * HORIZONTAL_AXIS_BIAS >= Math.abs(targetCenter.y - sourceCenter.y)
      ? "horizontal"
      : "vertical";

  return {
    route: bestRoute,
    axis: fallbackAxis
  };
}

export function PipelineCanvas({
  nodes,
  links,
  selectedNodeId,
  selectedNodeIds,
  selectedLinkId,
  onSelectionChange,
  onAddNode,
  onAutoLayout,
  onMoveNode,
  onMoveNodes,
  onConnectNodes,
  onDeleteNodes,
  onDeleteLink,
  className,
  showToolbar = true,
  canvasHeight = CANVAS_HEIGHT
}: PipelineCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const routeAxisMemoryRef = useRef<Map<string, RouteAxis>>(new Map());
  const [manualRoutePoints, setManualRoutePoints] = useState<Record<string, Point>>({});
  const manualRoutePointsRef = useRef<Record<string, Point>>({});
  const routeUndoStackRef = useRef<Record<string, Point>[]>([]);
  const routeRedoStackRef = useRef<Record<string, Point>[]>([]);
  const routeAdjustStartSnapshotRef = useRef<Record<string, Point> | null>(null);
  const [smartRouteByLinkId, setSmartRouteByLinkId] = useState<Record<string, Point[]>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);
  const nodeDragDidMoveRef = useRef(false);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [connectingState, setConnectingState] = useState<ConnectingState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [routeAdjustState, setRouteAdjustState] = useState<RouteAdjustState | null>(null);
  const [toolMode, setToolMode] = useState<"select" | "pan">("pan");
  const [viewport, setViewport] = useState<ViewportState>({ x: 80, y: 80, scale: 1 });

  useEffect(() => {
    manualRoutePointsRef.current = manualRoutePoints;
  }, [manualRoutePoints]);

  const clearRouteHistory = useCallback(() => {
    routeUndoStackRef.current = [];
    routeRedoStackRef.current = [];
    routeAdjustStartSnapshotRef.current = null;
  }, []);

  const undoManualRoutePlacement = useCallback((): boolean => {
    const previous = routeUndoStackRef.current[routeUndoStackRef.current.length - 1];
    if (!previous) {
      return false;
    }

    routeUndoStackRef.current = routeUndoStackRef.current.slice(0, -1);
    routeRedoStackRef.current = pushRouteHistorySnapshot(routeRedoStackRef.current, manualRoutePointsRef.current);
    routeAdjustStartSnapshotRef.current = null;
    setRouteAdjustState(null);
    setManualRoutePoints(cloneManualRoutePoints(previous));
    return true;
  }, []);

  const redoManualRoutePlacement = useCallback((): boolean => {
    const next = routeRedoStackRef.current[routeRedoStackRef.current.length - 1];
    if (!next) {
      return false;
    }

    routeRedoStackRef.current = routeRedoStackRef.current.slice(0, -1);
    routeUndoStackRef.current = pushRouteHistorySnapshot(routeUndoStackRef.current, manualRoutePointsRef.current);
    routeAdjustStartSnapshotRef.current = null;
    setRouteAdjustState(null);
    setManualRoutePoints(cloneManualRoutePoints(next));
    return true;
  }, []);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNodeSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const canDeleteSelection = selectedNodeIds.length > 0 || Boolean(selectedLinkId);

  const orchestratorLaneByLinkId = useMemo(() => {
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
      const side = preferredSide(nodeRect(orchestratorNode), nodeRect(otherNode));
      const otherCenter = rectCenter(nodeRect(otherNode));
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
  }, [links, nodeById]);

  const reciprocalLaneByLinkId = useMemo(() => {
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
        .sort((left, right) => left.id.localeCompare(right.id));
      const backward = entries
        .filter((link) => link.sourceStepId === b && link.targetStepId === a)
        .sort((left, right) => left.id.localeCompare(right.id));

      if (forward.length === 0 || backward.length === 0) {
        continue;
      }

      forward.forEach((link, index) => {
        laneMap.set(link.id, { offset: -(24 + index * 12) });
      });

      backward.forEach((link, index) => {
        laneMap.set(link.id, { offset: 24 + index * 12 });
      });
    }

    return laneMap;
  }, [links, nodeById]);

  useEffect(() => {
    const existing = new Set(links.map((link) => link.id));
    const hadRemovedLinks = Object.keys(manualRoutePointsRef.current).some((linkId) => !existing.has(linkId));
    setManualRoutePoints((current) => {
      const entries = Object.entries(current).filter(([linkId]) => existing.has(linkId));
      if (entries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(entries);
    });
    if (hadRemovedLinks) {
      clearRouteHistory();
    }
  }, [clearRouteHistory, links]);

  const canUseSmartRoutes = dragState === null && connectingState === null && routeAdjustState === null;

  useEffect(() => {
    let cancelled = false;

    if (links.length === 0) {
      setSmartRouteByLinkId((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }

    if (!canUseSmartRoutes) {
      return;
    }

    const timer = window.setTimeout(() => {
      void computeEdgeRoutesSmart(
        nodes.map((node) => ({
          id: node.id,
          position: {
            x: node.position.x,
            y: node.position.y
          },
          role: node.role
        })),
        links.map((link) => ({
          id: link.id,
          sourceStepId: link.sourceStepId,
          targetStepId: link.targetStepId,
          condition: link.condition
        }))
      ).then((routes) => {
        if (cancelled) {
          return;
        }
        setSmartRouteByLinkId(routes);
      });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canUseSmartRoutes, links, nodes]);

  const renderedLinks = useMemo(
    () =>
      links
        .map((link, index) => {
          const sourceNode = nodeById.get(link.sourceStepId);
          const targetNode = nodeById.get(link.targetStepId);

          if (!sourceNode || !targetNode) {
            return null;
          }

          const previousAxis = routeAxisMemoryRef.current.get(link.id) ?? null;
          const orchestratorLane = orchestratorLaneByLinkId.get(link.id) ?? null;
          const reciprocalLane = reciprocalLaneByLinkId.get(link.id) ?? null;
          const manualWaypoint = manualRoutePoints[link.id] ?? null;
          const useSmartRoute = canUseSmartRoutes && !manualWaypoint;
          const smartRouteCandidate = useSmartRoute ? smartRouteByLinkId[link.id] : undefined;
          const normalizedSmartRoute =
            smartRouteCandidate && smartRouteCandidate.length >= 2 ? normalizeRoute(smartRouteCandidate) : null;

          const { route, axis } =
            normalizedSmartRoute && normalizedSmartRoute.length >= 2
              ? {
                  route: normalizedSmartRoute,
                  axis: routeAxisFromEndpoints(normalizedSmartRoute)
                }
              : buildEdgeRoute(
                  sourceNode,
                  targetNode,
                  nodes,
                  index,
                  previousAxis,
                  orchestratorLane,
                  reciprocalLane,
                  manualWaypoint
                );
          const path = routePath(route, manualWaypoint ? MANUAL_CORNER_RADIUS : CORNER_RADIUS);
          const endPoint = route[route.length - 1];
          if (!path || !endPoint) {
            return null;
          }

          return {
            id: link.id,
            path,
            route,
            endPoint,
            axis,
            dasharray: edgeStrokeDasharray(sourceNode.role, targetNode.role),
            hasOrchestrator: edgeInvolvesOrchestrator(sourceNode.role, targetNode.role),
            controlPoint: manualWaypoint ?? routeMidpoint(route),
            hasManualRoute: Boolean(manualWaypoint),
            visual: edgeVisual(link.condition)
          };
        })
        .filter(
          (entry): entry is {
            id: string;
            path: string;
            route: Point[];
            endPoint: Point;
            axis: RouteAxis | null;
            dasharray: string | null;
            hasOrchestrator: boolean;
            controlPoint: Point;
            hasManualRoute: boolean;
            visual: { stroke: string; markerId: string };
          } =>
            entry !== null
        ),
    [
      canUseSmartRoutes,
      links,
      manualRoutePoints,
      nodeById,
      nodes,
      orchestratorLaneByLinkId,
      reciprocalLaneByLinkId,
      smartRouteByLinkId
    ]
  );

  useEffect(() => {
    const next = new Map<string, RouteAxis>();
    for (const link of renderedLinks) {
      if (link.axis) {
        next.set(link.id, link.axis);
      }
    }
    routeAxisMemoryRef.current = next;
  }, [renderedLinks]);

  const toCanvasPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }, []);

  const toWorldPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const canvasPoint = toCanvasPoint(event);
    if (!canvasPoint) {
      return null;
    }

    return {
      x: (canvasPoint.x - viewport.x) / viewport.scale,
      y: (canvasPoint.y - viewport.y) / viewport.scale
    };
  }, [toCanvasPoint, viewport.scale, viewport.x, viewport.y]);

  const clearSelection = useCallback(() => {
    onSelectionChange({
      nodeIds: [],
      primaryNodeId: null,
      linkId: null
    });
  }, [onSelectionChange]);

  const triggerAutoLayout = useCallback(() => {
    if (!onAutoLayout) {
      return;
    }

    // Manual control points are tied to previous geometry; reset before global re-layout.
    setManualRoutePoints({});
    setSmartRouteByLinkId({});
    setRouteAdjustState(null);
    clearRouteHistory();
    onAutoLayout();
  }, [clearRouteHistory, onAutoLayout]);

  const handleDeleteSelection = useCallback(() => {
    if (selectedNodeIds.length > 0) {
      onDeleteNodes?.(selectedNodeIds);
      return;
    }

    if (selectedLinkId) {
      onDeleteLink?.(selectedLinkId);
    }
  }, [onDeleteLink, onDeleteNodes, selectedLinkId, selectedNodeIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true
      ) {
        return;
      }

      const isUndoShortcut = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z";
      if (isUndoShortcut && selectedLinkId) {
        const handled = event.shiftKey ? redoManualRoutePlacement() : undoManualRoutePlacement();
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
      }

      if (event.key === "v" || event.key === "V") {
        setToolMode("select");
      } else if (event.key === "h" || event.key === "H") {
        setToolMode("pan");
      } else if ((event.key === "l" || event.key === "L") && onAutoLayout) {
        event.preventDefault();
        triggerAutoLayout();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onAutoLayout, redoManualRoutePlacement, selectedLinkId, triggerAutoLayout, undoManualRoutePlacement]);

  const marqueeFrame = useMemo(() => {
    if (!marqueeState) {
      return null;
    }

    return rectFromPoints(marqueeState.startCanvas, marqueeState.currentCanvas);
  }, [marqueeState]);

  useEffect(() => {
    if (!dragState && !panState && !connectingState && !marqueeState && !routeAdjustState) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (routeAdjustState) {
        const worldPoint = toWorldPoint(event);
        if (!worldPoint) {
          return;
        }

        setManualRoutePoints((current) => ({
          ...current,
          [routeAdjustState.linkId]: {
            x: Math.round(worldPoint.x - routeAdjustState.offsetX),
            y: Math.round(worldPoint.y - routeAdjustState.offsetY)
          }
        }));
      }

      if (dragState) {
        const worldPoint = toWorldPoint(event);
        if (!worldPoint) {
          return;
        }

        const anchorStart = dragState.initialPositions.find((entry) => entry.nodeId === dragState.anchorNodeId);
        if (!anchorStart) {
          return;
        }

        const nextAnchorPosition = {
          x: Math.round(worldPoint.x - dragState.offsetX),
          y: Math.round(worldPoint.y - dragState.offsetY)
        };
        const deltaX = nextAnchorPosition.x - anchorStart.position.x;
        const deltaY = nextAnchorPosition.y - anchorStart.position.y;

        if (!nodeDragDidMoveRef.current && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
          nodeDragDidMoveRef.current = true;
        }

        const updates = dragState.initialPositions.map((entry) => ({
          nodeId: entry.nodeId,
          position: {
            x: Math.round(entry.position.x + deltaX),
            y: Math.round(entry.position.y + deltaY)
          }
        }));

        if (updates.length === 1) {
          updates[0] = {
            nodeId: updates[0].nodeId,
            position: resolveNodeCollisionPosition(updates[0].nodeId, updates[0].position, nodes)
          };
        }

        if (onMoveNodes) {
          onMoveNodes(updates);
        } else {
          updates.forEach((entry) => onMoveNode(entry.nodeId, entry.position));
        }
      }

      if (panState) {
        setViewport((current) => ({
          ...current,
          x: panState.startViewportX + (event.clientX - panState.startPointerX),
          y: panState.startViewportY + (event.clientY - panState.startPointerY)
        }));
      }

      if (connectingState) {
        const worldPoint = toWorldPoint(event);
        if (!worldPoint) {
          return;
        }

        const targetNode = findNodeAtPoint(worldPoint, nodes, connectingState.sourceNodeId);
        setConnectingState((current) =>
          current
            ? {
                ...current,
                pointer: worldPoint,
                targetNodeId: targetNode?.id ?? null
              }
            : null
        );
      }

      if (marqueeState) {
        const canvasPoint = toCanvasPoint(event);
        const worldPoint = toWorldPoint(event);
        if (!canvasPoint || !worldPoint) {
          return;
        }

        setMarqueeState((current) =>
          current
            ? {
                ...current,
                currentCanvas: canvasPoint,
                currentWorld: worldPoint
              }
            : null
        );
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (connectingState) {
        let targetNodeId = connectingState.targetNodeId;
        if (!targetNodeId) {
          const worldPoint = toWorldPoint(event);
          if (worldPoint) {
            targetNodeId = findNodeAtPoint(worldPoint, nodes, connectingState.sourceNodeId)?.id ?? null;
          }
        }

        if (targetNodeId && targetNodeId !== connectingState.sourceNodeId) {
          onConnectNodes(connectingState.sourceNodeId, targetNodeId);
          onSelectionChange({
            nodeIds: [targetNodeId],
            primaryNodeId: targetNodeId,
            linkId: null
          });
        }
      }

      if (marqueeState) {
        const travelX = Math.abs(marqueeState.currentCanvas.x - marqueeState.startCanvas.x);
        const travelY = Math.abs(marqueeState.currentCanvas.y - marqueeState.startCanvas.y);
        const dragged = travelX > 4 || travelY > 4;

        if (dragged) {
          const selectRect = rectFromPoints(marqueeState.startWorld, marqueeState.currentWorld);
          const selectedIds = nodes.filter((node) => rectsOverlap(nodeRect(node), selectRect)).map((node) => node.id);
          const mergedSelection = marqueeState.additive
            ? Array.from(new Set([...selectedNodeIds, ...selectedIds]))
            : selectedIds;
          const primaryNodeId =
            mergedSelection.length === 0
              ? null
              : selectedNodeId && mergedSelection.includes(selectedNodeId)
                ? selectedNodeId
                : mergedSelection[mergedSelection.length - 1];

          onSelectionChange({
            nodeIds: mergedSelection,
            primaryNodeId,
            linkId: null
          });
        } else if (!marqueeState.additive) {
          clearSelection();
        }
      }

      if (dragState && !nodeDragDidMoveRef.current) {
        onSelectionChange({
          nodeIds: dragState.initialPositions.map((entry) => entry.nodeId),
          primaryNodeId: dragState.anchorNodeId,
          linkId: null
        });
      }

      if (routeAdjustState) {
        const startSnapshot = routeAdjustStartSnapshotRef.current;
        const currentSnapshot = manualRoutePointsRef.current;
        if (startSnapshot && !manualRoutePointsEqual(startSnapshot, currentSnapshot)) {
          routeUndoStackRef.current = pushRouteHistorySnapshot(routeUndoStackRef.current, startSnapshot);
          routeRedoStackRef.current = [];
        }
        routeAdjustStartSnapshotRef.current = null;
      }

      setDragState(null);
      setPanState(null);
      setConnectingState(null);
      setMarqueeState(null);
      setRouteAdjustState(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [
    clearSelection,
    connectingState,
    dragState,
    marqueeState,
    nodes,
    onMoveNode,
    onMoveNodes,
    onConnectNodes,
    onSelectionChange,
    panState,
    routeAdjustState,
    selectedNodeId,
    selectedNodeIds,
    toCanvasPoint,
    toWorldPoint
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      const canvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };

      const zoomFactor = Math.exp(-event.deltaY * 0.001);

      setViewport((current) => {
        const nextScale = clamp(current.scale * zoomFactor, ZOOM_MIN, ZOOM_MAX);
        if (nextScale === current.scale) {
          return current;
        }

        const worldX = (canvasPoint.x - current.x) / current.scale;
        const worldY = (canvasPoint.y - current.y) / current.scale;

        return {
          x: canvasPoint.x - worldX * nextScale,
          y: canvasPoint.y - worldY * nextScale,
          scale: nextScale
        };
      });
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className={cn("space-y-3", className)}>
      {showToolbar ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Flow Canvas</p>
            <p className="text-xs text-ink-500">Select mode: drag to multi-select. Pan mode/Alt-drag to move viewport. Wheel to zoom.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onAddNode}>
            <PlusCircle className="mr-1 h-4 w-4" /> Add step
          </Button>
        </div>
      ) : null}

      <div
        ref={canvasRef}
        className={cn(
          "relative overflow-hidden rounded-2xl rounded-bl-none rounded-tr-none border border-ink-800 bg-ink-950/50",
          panState ? "cursor-grabbing" : toolMode === "pan" ? "cursor-grab" : "cursor-crosshair"
        )}
        style={{
          height: canvasHeight,
          backgroundImage:
            "radial-gradient(circle, rgba(154, 154, 163, 0.09) 1px, transparent 1px)",
          backgroundSize: `${18 * viewport.scale}px ${18 * viewport.scale}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`
        }}
        onPointerDown={(event) => {
          if ((event.button !== 0 && event.button !== 1) || event.target !== event.currentTarget) {
            return;
          }

          if (toolMode === "pan" || event.button === 1 || event.altKey) {
            setPanState({
              startPointerX: event.clientX,
              startPointerY: event.clientY,
              startViewportX: viewport.x,
              startViewportY: viewport.y
            });
            return;
          }

          const canvasPoint = toCanvasPoint(event);
          const worldPoint = toWorldPoint(event);
          if (!canvasPoint || !worldPoint) {
            return;
          }

          setMarqueeState({
            additive: isMultiSelectModifier(event),
            startCanvas: canvasPoint,
            currentCanvas: canvasPoint,
            startWorld: worldPoint,
            currentWorld: worldPoint
          });
        }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <defs>
            <marker
              id="flow-arrow"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 14 14"
              markerWidth="14"
              markerHeight="14"
              refX="13"
              refY="7"
              orient="auto-start-reverse"
            >
              <path
                d="M1 1.4 Q3.1 7 1 12.6 L13 7 Z"
                fill={EDGE_COLOR}
                stroke={EDGE_COLOR}
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
            </marker>
            <marker
              id="flow-arrow-pass"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 14 14"
              markerWidth="14"
              markerHeight="14"
              refX="13"
              refY="7"
              orient="auto-start-reverse"
            >
              <path
                d="M1 1.4 Q3.1 7 1 12.6 L13 7 Z"
                fill={EDGE_PASS_COLOR}
                stroke={EDGE_PASS_COLOR}
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
            </marker>
            <marker
              id="flow-arrow-fail"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 14 14"
              markerWidth="14"
              markerHeight="14"
              refX="13"
              refY="7"
              orient="auto-start-reverse"
            >
              <path
                d="M1 1.4 Q3.1 7 1 12.6 L13 7 Z"
                fill={EDGE_FAIL_COLOR}
                stroke={EDGE_FAIL_COLOR}
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
            </marker>
          </defs>

          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {renderedLinks.map((link) => {
              const isSelected = selectedLinkId === link.id;
              const baseStrokeWidth = link.hasOrchestrator ? 2.35 : 1.95;
              const selectedStrokeWidth = link.hasOrchestrator ? 3.35 : 2.85;
              const edgeOpacity = link.hasOrchestrator ? 0.98 : 0.88;
              const selectedHaloOpacity = link.hasOrchestrator ? 0.24 : 0.18;

              return (
                <g key={link.id}>
                  {isSelected ? (
                    <path
                      d={link.path}
                      fill="none"
                      stroke={link.visual.stroke}
                      strokeWidth={8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray={link.dasharray ?? undefined}
                      opacity={selectedHaloOpacity}
                    />
                  ) : null}
                  <path
                    d={link.path}
                    fill="none"
                    stroke={link.visual.stroke}
                    strokeWidth={isSelected ? selectedStrokeWidth : baseStrokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={link.dasharray ?? undefined}
                    opacity={edgeOpacity}
                    markerEnd={`url(#${link.visual.markerId})`}
                  />
                </g>
              );
            })}

            {connectingState ? (() => {
              const sourceNode = nodeById.get(connectingState.sourceNodeId);
              if (!sourceNode) {
                return null;
              }

              if (connectingState.targetNodeId) {
                const targetNode = nodeById.get(connectingState.targetNodeId);
                if (targetNode && targetNode.id !== sourceNode.id) {
                  const previewLane = simpleOrchestratorLaneMeta(sourceNode, targetNode);
                  const previewRoute = buildEdgeRoute(
                    sourceNode,
                    targetNode,
                    nodes,
                    links.length,
                    null,
                    previewLane,
                    null,
                    null
                  );
                  const dasharray = edgeStrokeDasharray(sourceNode.role, targetNode.role);
                  const previewHasOrchestrator = edgeInvolvesOrchestrator(sourceNode.role, targetNode.role);
                  return (
                    <path
                      d={routePath(previewRoute.route, CORNER_RADIUS)}
                      fill="none"
                      stroke={EDGE_PREVIEW_COLOR}
                      strokeWidth={previewHasOrchestrator ? 2.25 : 1.95}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray={dasharray ?? undefined}
                      opacity={previewHasOrchestrator ? 0.98 : 0.86}
                      markerEnd="url(#flow-arrow)"
                    />
                  );
                }
              }

              const sourceAnchor = {
                x: sourceNode.position.x + NODE_WIDTH,
                y: sourceNode.position.y + NODE_HEIGHT / 2
              };

              return (
                <path
                  d={edgePath(sourceAnchor, connectingState.pointer)}
                  fill="none"
                  stroke={EDGE_PREVIEW_COLOR}
                  strokeWidth={2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={sourceNode.role === "orchestrator" ? undefined : "8 7"}
                />
              );
            })() : null}
          </g>
        </svg>

        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {renderedLinks.map((link) => (
              <g key={`hit-${link.id}`}>
                <path
                  d={link.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }

                    event.stopPropagation();
                    const worldPoint = toWorldPoint(event);
                    if (selectedLinkId === link.id && worldPoint) {
                      routeAdjustStartSnapshotRef.current = cloneManualRoutePoints(manualRoutePointsRef.current);
                      setManualRoutePoints((current) => ({
                        ...current,
                        [link.id]: {
                          x: Math.round(worldPoint.x),
                          y: Math.round(worldPoint.y)
                        }
                      }));
                      setRouteAdjustState({
                        linkId: link.id,
                        offsetX: 0,
                        offsetY: 0
                      });
                    }

                    onSelectionChange({
                      nodeIds: [],
                      primaryNodeId: null,
                      linkId: link.id
                    });
                  }}
                />
                {selectedLinkId === link.id ? (
                  <circle
                    cx={link.controlPoint.x}
                    cy={link.controlPoint.y}
                    r={7.5}
                    fill={link.hasManualRoute ? "rgba(236, 154, 125, 0.3)" : "rgba(236, 154, 125, 0.18)"}
                    stroke={link.visual.stroke}
                    strokeWidth={1.5}
                    pointerEvents="all"
                    className="pointer-events-auto cursor-grab active:cursor-grabbing"
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }

                      event.stopPropagation();
                      const worldPoint = toWorldPoint(event);
                      if (!worldPoint) {
                        return;
                      }

                      routeAdjustStartSnapshotRef.current = cloneManualRoutePoints(manualRoutePointsRef.current);
                      setManualRoutePoints((current) => ({
                        ...current,
                        [link.id]: {
                          x: Math.round(link.controlPoint.x),
                          y: Math.round(link.controlPoint.y)
                        }
                      }));

                      setRouteAdjustState({
                        linkId: link.id,
                        offsetX: worldPoint.x - link.controlPoint.x,
                        offsetY: worldPoint.y - link.controlPoint.y
                      });
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      const previous = cloneManualRoutePoints(manualRoutePointsRef.current);
                      if (!(link.id in previous)) {
                        return;
                      }

                      const next = cloneManualRoutePoints(previous);
                      delete next[link.id];
                      if (manualRoutePointsEqual(previous, next)) {
                        return;
                      }

                      routeUndoStackRef.current = pushRouteHistorySnapshot(routeUndoStackRef.current, previous);
                      routeRedoStackRef.current = [];
                      routeAdjustStartSnapshotRef.current = null;
                      setManualRoutePoints(next);
                    }}
                  />
                ) : null}
                <circle
                  cx={link.endPoint.x}
                  cy={link.endPoint.y}
                  r={12}
                  fill="transparent"
                  pointerEvents="all"
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }

                    event.stopPropagation();
                    onSelectionChange({
                      nodeIds: [],
                      primaryNodeId: null,
                      linkId: link.id
                    });
                  }}
                />
              </g>
            ))}
          </g>
        </svg>

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: "0 0"
          }}
        >
          {nodes.map((node) => (
            <div
              key={node.id}
              className={cn(
                "group pointer-events-auto absolute select-none rounded-2xl border bg-ink-900/95 p-3 shadow-lg transition-colors",
                "cursor-grab active:cursor-grabbing",
                selectedNodeSet.has(node.id)
                  ? selectedNodeId === node.id
                    ? "border-ember-500 ring-2 ring-ember-500/40"
                    : "border-ember-400/80 ring-1 ring-ember-500/30"
                  : "border-ink-700 hover:border-ink-600"
              )}
              style={{
                left: node.position.x,
                top: node.position.y,
                width: NODE_WIDTH,
                height: NODE_HEIGHT
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }

                event.stopPropagation();

                const target = event.target as HTMLElement;
                if (target.closest("[data-node-control='true']")) {
                  return;
                }

                const worldPoint = toWorldPoint(event);
                if (!worldPoint) {
                  return;
                }

                if (isMultiSelectModifier(event)) {
                  const nextSelection = selectedNodeSet.has(node.id)
                    ? selectedNodeIds.filter((entry) => entry !== node.id)
                    : [...selectedNodeIds, node.id];

                  onSelectionChange({
                    nodeIds: nextSelection,
                    primaryNodeId: nextSelection.length > 0 ? nextSelection[nextSelection.length - 1] : null,
                    linkId: null
                  });
                  return;
                }

                const dragNodeIds = selectedNodeSet.has(node.id) && selectedNodeIds.length > 1 ? selectedNodeIds : [node.id];
                const initialPositions = dragNodeIds
                  .map((nodeId) => {
                    const currentNode = nodeById.get(nodeId);
                    if (!currentNode) {
                      return null;
                    }

                    return {
                      nodeId,
                      position: {
                        x: currentNode.position.x,
                        y: currentNode.position.y
                      }
                    };
                  })
                  .filter((entry): entry is NodePositionUpdate => entry !== null);

                if (initialPositions.length === 0) {
                  return;
                }

                nodeDragDidMoveRef.current = false;
                onSelectionChange({
                  nodeIds: dragNodeIds,
                  primaryNodeId: node.id,
                  linkId: null,
                  isDragStart: true
                });

                setDragState({
                  anchorNodeId: node.id,
                  offsetX: worldPoint.x - node.position.x,
                  offsetY: worldPoint.y - node.position.y,
                  initialPositions
                });
              }}
            >
              <button
                type="button"
                aria-label={`Connect input to ${node.name}`}
                data-node-control="true"
                className={cn(
                  "absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-opacity",
                  connectingState?.targetNodeId === node.id
                    ? "border-ember-400 bg-ember-500/25 opacity-100"
                    : connectingState
                    ? "border-ember-300/70 bg-ember-500/15 opacity-100"
                    : "border-transparent bg-transparent opacity-0"
                )}
                style={{ width: PORT_HIT_SIZE, height: PORT_HIT_SIZE }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  if (connectingState && connectingState.sourceNodeId !== node.id) {
                    onConnectNodes(connectingState.sourceNodeId, node.id);
                  }
                  onSelectionChange({
                    nodeIds: [node.id],
                    primaryNodeId: node.id,
                    linkId: null
                  });
                  setConnectingState(null);
                }}
              />

              <button
                type="button"
                aria-label={`Connect output from ${node.name}`}
                data-node-control="true"
                className={cn(
                  "absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 rounded-full border transition-opacity",
                  connectingState?.sourceNodeId === node.id
                    ? "border-ember-600/80 bg-ember-700/20 opacity-100"
                    : "border-ember-500/40 bg-ember-700/10 opacity-0 group-hover:opacity-100"
                )}
                style={{ width: PORT_HIT_SIZE, height: PORT_HIT_SIZE }}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  event.stopPropagation();
                  onSelectionChange({
                    nodeIds: [node.id],
                    primaryNodeId: node.id,
                    linkId: null
                  });

                  const worldPoint = toWorldPoint(event);
                  if (!worldPoint) {
                    return;
                  }

                  setConnectingState({
                    sourceNodeId: node.id,
                    pointer: worldPoint,
                    targetNodeId: null
                  });
                }}
              />

              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="line-clamp-1 text-sm font-semibold text-ink-50">{node.name}</p>
                <div className="flex items-center gap-1">
                  {onDeleteNodes && selectedNodeSet.has(node.id) ? (
                    <button
                      type="button"
                      data-node-control="true"
                      aria-label={`Delete ${node.name}`}
                      className="rounded-md p-1 text-ink-500 transition hover:bg-red-500/15 hover:text-red-300"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteNodes([node.id]);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <Move className="h-4 w-4 text-ink-500" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <Badge variant="neutral">{node.role}</Badge>
                <span className="line-clamp-1">{node.providerId}</span>
              </div>
              <p className="mt-2 line-clamp-1 text-xs text-ink-500">{node.model}</p>
            </div>
          ))}
        </div>

        {marqueeFrame ? (
          <div
            className="pointer-events-none absolute rounded-lg border border-ember-400/70 bg-ember-500/10"
            style={{
              left: marqueeFrame.left,
              top: marqueeFrame.top,
              width: marqueeFrame.right - marqueeFrame.left,
              height: marqueeFrame.bottom - marqueeFrame.top
            }}
          />
        ) : null}

        <FloatingToolbar>
          <FloatingToolbarButton active={toolMode === "select"} onClick={() => setToolMode("select")} shortcut="V">
            <MousePointer2 className="h-3.5 w-3.5" /> Select
          </FloatingToolbarButton>

          <FloatingToolbarButton active={toolMode === "pan"} onClick={() => setToolMode("pan")} shortcut="H">
            <Hand className="h-3.5 w-3.5" /> Pan
          </FloatingToolbarButton>

          {onAutoLayout ? (
            <FloatingToolbarButton onClick={triggerAutoLayout} shortcut="L">
              Auto layout
            </FloatingToolbarButton>
          ) : null}

          <FloatingToolbarDivider />

          <FloatingToolbarText muted className="px-2 tabular-nums">
            {Math.round(viewport.scale * 100)}%
          </FloatingToolbarText>

          {(selectedNodeIds.length > 0 || selectedLinkId) && (
            <>
              <FloatingToolbarDivider />

              <FloatingToolbarText>
                {selectedLinkId ? "1 link" : `${selectedNodeIds.length} node${selectedNodeIds.length > 1 ? "s" : ""}`}
              </FloatingToolbarText>

              <FloatingToolbarButton
                danger
                disabled={!canDeleteSelection || (!onDeleteNodes && !onDeleteLink)}
                onClick={handleDeleteSelection}
              >
                {selectedLinkId ? <Unlink className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
              </FloatingToolbarButton>

              <FloatingToolbarButton onClick={clearSelection}>
                Clear
              </FloatingToolbarButton>
            </>
          )}
        </FloatingToolbar>
      </div>
    </div>
  );
}
