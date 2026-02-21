import type { AgentRole, PipelinePayload } from "@/lib/types";

import { computeAutoLayoutPositionsSmart, computeEdgeRoutesSmart } from "./flow-layout/graph";
import { computeAutoLayoutPositions } from "./flow-layout/layout";

export interface RouteNodeInput {
  id: string;
  position: {
    x: number;
    y: number;
  };
  role?: AgentRole;
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

export { computeAutoLayoutPositions, computeAutoLayoutPositionsSmart, computeEdgeRoutesSmart };

export async function autoLayoutPipelineDraftSmart(
  draft: PipelinePayload,
  options: FlowLayoutOptions = {}
): Promise<PipelinePayload> {
  const positions = await computeAutoLayoutPositionsSmart(draft.steps, draft.links, options);

  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      position: positions[step.id] ?? step.position
    }))
  };
}

export function autoLayoutPipelineDraft(
  draft: PipelinePayload,
  options: FlowLayoutOptions = {}
): PipelinePayload {
  const positions = computeAutoLayoutPositions(draft.steps, draft.links, options);

  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      position: positions[step.id] ?? step.position
    }))
  };
}
