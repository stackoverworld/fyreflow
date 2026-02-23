import type { StepQualityGateResult } from "../../types.js";
import type { PipelineStep } from "../../types.js";

export interface StepContractEvaluationResult {
  parsedJson: Record<string, unknown> | null;
  gateResults: StepQualityGateResult[];
}

const DELIVERY_STEP_NAME_PATTERN = /\bdeliver(y|ed|ing)?\b/i;

export function isGateResultContractStep(step: Pick<PipelineStep, "role" | "name">): boolean {
  if (step.role === "review" || step.role === "tester") {
    return true;
  }

  return DELIVERY_STEP_NAME_PATTERN.test(step.name);
}
