import type { AgentRole } from "@/lib/types";

export const DEFAULT_START_X = 120;
export const DEFAULT_CENTER_Y = 300;
export const DEFAULT_LAYER_GAP = 360;
export const DEFAULT_ROW_GAP = 196;
export const DEFAULT_NODE_WIDTH = 240;
export const DEFAULT_NODE_HEIGHT = 116;

export const rolePriority: Record<AgentRole, number> = {
  orchestrator: 0,
  analysis: 1,
  planner: 2,
  executor: 3,
  tester: 4,
  review: 5
};

export const ELK_BASE_LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.feedbackEdges": "true",
  "elk.spacing.edgeEdge": "26",
  "elk.spacing.edgeNode": "80"
};

export const ROUTE_ENDPOINT_MAX_DISTANCE = 110;
export const ROUTE_PATH_STRETCH_LIMIT = 3.7;
export const ROUTE_PATH_EXTRA_LIMIT = 820;
export const ROUTE_MAX_POINTS = 36;
