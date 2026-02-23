import type { LocalStore } from "../storage.js";
import { normalizeStepLabel } from "../stepLabel.js";
import type { PipelineStep, StepRun } from "../types.js";
import type { TimelineEntry } from "./types.js";
import { formatOutputWithQualityFailures } from "./resultFormatting.js";
import { markStepCompleted } from "./scheduling.js";
import { recordStepAttempt, type StepRetryState } from "./retryPolicy.js";
import type { StepExecutionOutput } from "./execution.js";

export interface StepResultMappingInput {
  store: LocalStore;
  runId: string;
  step: PipelineStep;
  attempt: number;
  retryState: StepRetryState;
  stepExecution: StepExecutionOutput;
  latestOutputByStepId: Map<string, string>;
  timeline: TimelineEntry[];
  triggeredByStepId?: StepRun["triggeredByStepId"];
  triggeredByReason?: StepRun["triggeredByReason"];
}

export function mapStepExecutionResult(input: StepResultMappingInput): string {
  const stepLabel = normalizeStepLabel(input.step.name, input.step.id);
  const outputWithQuality = formatOutputWithQualityFailures(
    input.stepExecution.output,
    input.stepExecution.qualityGateResults,
    input.stepExecution.hasBlockingGateFailure
  );

  recordStepAttempt(input.retryState, input.step.id, input.attempt);
  input.latestOutputByStepId.set(input.step.id, outputWithQuality);
  input.timeline.push({
    stepId: input.step.id,
    stepName: stepLabel,
    output: outputWithQuality
  });

  markStepCompleted(
    input.store,
    input.runId,
    input.step,
    outputWithQuality,
    input.stepExecution.subagentNotes,
    input.stepExecution.qualityGateResults,
    input.stepExecution.workflowOutcome,
    input.attempt,
    input.triggeredByStepId,
    input.triggeredByReason
  );

  return outputWithQuality;
}
