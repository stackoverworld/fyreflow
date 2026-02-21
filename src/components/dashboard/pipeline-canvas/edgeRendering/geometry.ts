import type { AnchorSide, Point, Rect, RouteAxis } from "../types";
import { clamp } from "../useNodeLayout";
import { CENTER_ANCHOR_SNAP, CORNER_RADIUS, EDGE_ANCHOR_INSET, MIN_KINK_SEGMENT, MIN_ROUNDED_CORNER_SEGMENT, TIGHT_HOOK_MAX_BRIDGE } from "./styles";

export function rectCenter(rect: Rect): Point {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2
  };
}

export function anchorPoint(rect: Rect, side: AnchorSide, toward: Point): Point {
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

export function preferredSide(from: Rect, to: Rect): AnchorSide {
  const fromCenter = rectCenter(from);
  const toCenter = rectCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }

  return dy >= 0 ? "bottom" : "top";
}

export function sideCenterPoint(rect: Rect, side: AnchorSide): Point {
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

export function routePath(points: Point[], requestedCornerRadius: number = CORNER_RADIUS): string {
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

export function normalizeRoute(points: Point[]): Point[] {
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

export function routeLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return total;
}

export function routeIntersections(points: Point[], obstacles: Rect[]): number {
  let count = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];

    for (const obstacle of obstacles) {
      if (segmentIntersectsRoute(start, end, obstacle)) {
        count += 1;
      }
    }
  }

  return count;
}

function segmentIntersectsRoute(start: Point, end: Point, obstacle: Rect): boolean {
  if (start.x === end.x) {
    return start.x >= obstacle.left && start.x <= obstacle.right && rangeOverlaps(start.y, end.y, obstacle.top, obstacle.bottom);
  }

  if (start.y === end.y) {
    return start.y >= obstacle.top && start.y <= obstacle.bottom && rangeOverlaps(start.x, end.x, obstacle.left, obstacle.right);
  }

  return false;
}

function rangeOverlaps(a: number, b: number, min: number, max: number): boolean {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return Math.max(low, min) <= Math.min(high, max);
}

export function routeAxisFromEndpoints(route: Point[]): RouteAxis | null {
  if (route.length < 2) {
    return null;
  }

  const start = route[0];
  const end = route[route.length - 1];
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? "horizontal" : "vertical";
}

export { sideDistributedPoint };
