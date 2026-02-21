import type { StepQualityGateResult, WorkflowOutcome } from "../types.js";
import { formatBlockingGateFailures } from "./remediation.js";

export function formatOutputWithQualityFailures(
  output: string,
  qualityGateResults: StepQualityGateResult[],
  hasBlockingGateFailure: boolean
): string {
  if (!hasBlockingGateFailure) {
    return output;
  }

  const blockingFailureSummary = formatBlockingGateFailures(qualityGateResults);
  return blockingFailureSummary.length > 0 ? `${output}\n\n${blockingFailureSummary}` : output;
}

export function formatManualInputStopReason(stepName: string, summary?: string): string {
  return summary
    ? `${stepName} requested additional input: ${summary}`
    : `${stepName} requested additional input`;
}

export function formatBlockingGateFailureLog(stepName: string, qualityGateResults: StepQualityGateResult[]): string | undefined {
  const failedGates = qualityGateResults
    .filter((result) => result.status === "fail" && result.blocking)
    .map((result) => `${result.gateName}: ${result.message}`);

  if (failedGates.length === 0) {
    return undefined;
  }

  return `${stepName} blocked by quality gates -> ${failedGates.join(" | ")}`;
}

export function formatNoRouteMatchLog(stepName: string, workflowOutcome: WorkflowOutcome): string {
  return `${stepName} produced ${workflowOutcome}; no conditional route matched`;
}

export function formatRouteEnqueueReason(stepName: string, condition?: string | null): string {
  return `${stepName} -> ${condition ?? "always"}`;
}
