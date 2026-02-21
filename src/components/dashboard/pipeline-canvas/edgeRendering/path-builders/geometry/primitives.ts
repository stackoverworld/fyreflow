import type { AnchorSide, Point, Rect } from "../../../types";
import { rectCenter } from "../../geometry";
import { MANUAL_LANE_MIN_GAP, MANUAL_STRAIGHT_SNAP } from "../../styles";

export const ANCHOR_SIDES: AnchorSide[] = ["left", "right", "top", "bottom"];

export function sideFacingCoordinateAnchor(rect: Rect, side: AnchorSide): Point {
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

export function anchorDirection(side: AnchorSide): Point {
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

export function sidePenalty(side: AnchorSide, preferred: AnchorSide): number {
  if (side === preferred) {
    return 0;
  }

  const isHorizontal = side === "left" || side === "right";
  const preferredHorizontal = preferred === "left" || preferred === "right";
  return isHorizontal === preferredHorizontal ? 220 : 360;
}

export function sideFacingPenalty(sourceRect: Rect, targetRect: Rect, sourceSide: AnchorSide, targetSide: AnchorSide): number {
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

export function dominantAxisPenalty(sourceRect: Rect, targetRect: Rect, sourceSide: AnchorSide, targetSide: AnchorSide): number {
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

export function sideTowardPoint(rect: Rect, point: Point): AnchorSide {
  const center = rectCenter(rect);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

export function snapManualWaypointAxis(point: Point, start: Point, end: Point): Point {
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

export function stabilizeManualLane(value: number, startLeadValue: number, endLeadValue: number): number {
  if (Math.abs(value - startLeadValue) <= MANUAL_LANE_MIN_GAP) {
    return startLeadValue;
  }
  if (Math.abs(value - endLeadValue) <= MANUAL_LANE_MIN_GAP) {
    return endLeadValue;
  }
  return value;
}

export function isVerticalSide(side: AnchorSide): boolean {
  return side === "top" || side === "bottom";
}

export function isHorizontalSide(side: AnchorSide): boolean {
  return side === "left" || side === "right";
}

export function oppositeSides(a: AnchorSide, b: AnchorSide): boolean {
  return (
    (a === "left" && b === "right") ||
    (a === "right" && b === "left") ||
    (a === "top" && b === "bottom") ||
    (a === "bottom" && b === "top")
  );
}

export function endpointDirectionPenalty(route: Point[], sourceSide: AnchorSide, targetSide: AnchorSide): number {
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

export function axisReversalPenalty(route: Point[], sourceSide: AnchorSide, targetSide: AnchorSide): number {
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

export function sidePairAllowed(sourceRect: Rect, targetRect: Rect, sourceSide: AnchorSide, targetSide: AnchorSide): boolean {
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
