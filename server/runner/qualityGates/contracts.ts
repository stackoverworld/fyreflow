import type { StepQualityGateResult } from "../../types.js";
import type { PipelineStep } from "../../types.js";

export interface StepContractEvaluationResult {
  parsedJson: Record<string, unknown> | null;
  gateResults: StepQualityGateResult[];
}

const DELIVERY_STEP_NAME_PATTERN = /\bdeliver(y|ed|ing)?\b/i;

export function hasExplicitJsonStepContract(
  step: Pick<PipelineStep, "outputFormat" | "requiredOutputFields" | "requiredOutputFiles">
): boolean {
  return (
    step.outputFormat === "json" &&
    (step.requiredOutputFields.length > 0 || step.requiredOutputFiles.length > 0)
  );
}

export function isGateResultContractStep(
  step: Pick<PipelineStep, "role" | "name" | "outputFormat" | "requiredOutputFields" | "requiredOutputFiles">
): boolean {
  if (hasExplicitJsonStepContract(step)) {
    return false;
  }

  if (step.role === "review" || step.role === "tester") {
    return true;
  }

  return DELIVERY_STEP_NAME_PATTERN.test(step.name);
}
