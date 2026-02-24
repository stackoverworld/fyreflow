export type TooltipSide = "top" | "right" | "bottom" | "left";

export interface TooltipRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TooltipCoords {
  top: number;
  left: number;
}

export interface TooltipHorizontalBounds {
  left: number;
  right: number;
}

const TOOLTIP_OFFSET = 8;
const TOOLTIP_EDGE_GUTTER = 8;
const TOOLTIP_ARROW_EDGE_GUTTER = 10;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function computeTooltipPosition(
  trigger: Pick<TooltipRect, "top" | "left" | "right" | "bottom" | "width" | "height">,
  tip: Pick<TooltipRect, "width" | "height">,
  side: TooltipSide,
  offset = TOOLTIP_OFFSET
): TooltipCoords {
  switch (side) {
    case "right":
      return { top: trigger.top + trigger.height / 2 - tip.height / 2, left: trigger.right + offset };
    case "left":
      return { top: trigger.top + trigger.height / 2 - tip.height / 2, left: trigger.left - tip.width - offset };
    case "top":
      return { top: trigger.top - tip.height - offset, left: trigger.left + trigger.width / 2 - tip.width / 2 };
    case "bottom":
      return { top: trigger.bottom + offset, left: trigger.left + trigger.width / 2 - tip.width / 2 };
  }
}

export function clampTooltipLeft(
  left: number,
  tooltipWidth: number,
  bounds: TooltipHorizontalBounds,
  gutter = TOOLTIP_EDGE_GUTTER
): number {
  const minLeft = bounds.left + gutter;
  const maxLeft = bounds.right - tooltipWidth - gutter;

  if (maxLeft <= minLeft) {
    return minLeft;
  }

  return clamp(left, minLeft, maxLeft);
}

export function clampTooltipHorizontal(
  coords: TooltipCoords,
  tooltipWidth: number,
  bounds: TooltipHorizontalBounds,
  gutter = TOOLTIP_EDGE_GUTTER
): TooltipCoords {
  return {
    ...coords,
    left: clampTooltipLeft(coords.left, tooltipWidth, bounds, gutter),
  };
}

export function computeTooltipArrowLeft(
  trigger: Pick<TooltipRect, "left" | "width">,
  tooltipLeft: number,
  tooltipWidth: number,
  gutter = TOOLTIP_ARROW_EDGE_GUTTER
): number {
  const triggerCenter = trigger.left + trigger.width / 2;
  const minLeft = gutter;
  const maxLeft = tooltipWidth - gutter;

  if (maxLeft <= minLeft) {
    return tooltipWidth / 2;
  }

  return clamp(triggerCenter - tooltipLeft, minLeft, maxLeft);
}
