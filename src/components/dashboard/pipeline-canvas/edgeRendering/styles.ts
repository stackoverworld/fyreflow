import type { LinkCondition } from "@/lib/types";
import { clamp } from "../useNodeLayout";

export const ANCHOR_LEAD = 34;
export const EDGE_COLOR = "#d97757";
export const EDGE_PREVIEW_COLOR = "#ec9a7d";
export const EDGE_PASS_COLOR = "#4ade80";
export const EDGE_FAIL_COLOR = "#f87171";
export const CORNER_RADIUS = 22;
export const MANUAL_CORNER_RADIUS = 14;
export const EDGE_ANCHOR_INSET = 18;
export const CENTER_ANCHOR_SNAP = 28;
export const NEAR_DIRECT_GAP = 96;
export const DIRECT_AXIS_TOLERANCE = 6;
export const AXIS_ACTIVATION_DISTANCE = 24;
export const AXIS_SWITCH_HYSTERESIS = 72;
export const HORIZONTAL_AXIS_BIAS = 1.08;
export const CANONICAL_APPROACH_MIN = 40;
export const CANONICAL_BALANCE_WEIGHT = 2.2;
export const MANUAL_STRAIGHT_SNAP = 18;
export const MIN_KINK_SEGMENT = 12;
export const MIN_ROUNDED_CORNER_SEGMENT = 22;
export const MANUAL_LANE_MIN_GAP = 28;
export const TIGHT_HOOK_MAX_BRIDGE = 26;

export function edgePath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const controlOffset = clamp(Math.max(dx, 0) * 0.4 + Math.abs(dy) * 0.08, 26, 140);
  return `M ${source.x} ${source.y} C ${source.x + controlOffset} ${source.y}, ${target.x - controlOffset} ${target.y}, ${target.x} ${target.y}`;
}

export function edgeVisual(condition: LinkCondition | undefined): { stroke: string; markerId: string } {
  if (condition === "on_pass") {
    return { stroke: EDGE_PASS_COLOR, markerId: "flow-arrow-pass" };
  }
  if (condition === "on_fail") {
    return { stroke: EDGE_FAIL_COLOR, markerId: "flow-arrow-fail" };
  }
  return { stroke: EDGE_COLOR, markerId: "flow-arrow" };
}

export function edgeStrokeDasharray(sourceRole: string, targetRole: string): string | null {
  const involvesOrchestrator = sourceRole === "orchestrator" || targetRole === "orchestrator";
  return involvesOrchestrator ? null : "8 7";
}

export function edgeInvolvesOrchestrator(sourceRole: string, targetRole: string): boolean {
  return sourceRole === "orchestrator" || targetRole === "orchestrator";
}
