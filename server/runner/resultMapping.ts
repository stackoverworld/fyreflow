import type { LocalStore } from "../storage.js";
import type { PipelineStep } from "../types.js";
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
}

export function mapStepExecutionResult(input: StepResultMappingInput): string {
  const outputWithQuality = formatOutputWithQualityFailures(
    input.stepExecution.output,
    input.stepExecution.qualityGateResults,
    input.stepExecution.hasBlockingGateFailure
  );

  recordStepAttempt(input.retryState, input.step.id, input.attempt);
  input.latestOutputByStepId.set(input.step.id, outputWithQuality);
  input.timeline.push({
    stepId: input.step.id,
    stepName: input.step.name,
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
    input.attempt
  );

  return outputWithQuality;
}
