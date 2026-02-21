import type { StepQualityGateResult } from "../../types.js";

export interface StepContractEvaluationResult {
  parsedJson: Record<string, unknown> | null;
  gateResults: StepQualityGateResult[];
}
