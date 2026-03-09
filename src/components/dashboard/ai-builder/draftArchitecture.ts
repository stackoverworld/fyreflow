import type { PipelinePayload } from "@/lib/types";

const DETERMINISTIC_PROFILE_IDS = new Set([
  "deterministic_fetch",
  "deterministic_diff",
  "deterministic_validate",
  "deterministic_publish"
]);

export interface DraftArchitectureSummary {
  deterministicStepCount: number;
  semanticRouteCount: number;
  llmStepCount: number;
}

export function summarizeDraftArchitecture(draft: PipelinePayload): DraftArchitectureSummary {
  const deterministicStepCount = draft.steps.filter((step) =>
    Array.isArray(step.policyProfileIds) &&
    step.policyProfileIds.some((profileId) => DETERMINISTIC_PROFILE_IDS.has(profileId.trim().toLowerCase()))
  ).length;

  const semanticRouteCount = draft.links.filter(
    (link) => typeof link.conditionExpression === "string" && link.conditionExpression.trim().length > 0
  ).length;

  return {
    deterministicStepCount,
    semanticRouteCount,
    llmStepCount: Math.max(0, draft.steps.length - deterministicStepCount)
  };
}
