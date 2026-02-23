import type { LocalStore } from "../storage.js";
import type { StepEnqueueReason } from "./retryPolicy.js";
import { appendRunLog, markRunFailed } from "./scheduling.js";
import {
  formatBlockingGateFailureLog,
  formatManualInputStopReason,
  formatNoRouteMatchLog,
  formatRouteEnqueueReason
} from "./resultFormatting.js";
import type { StepExecutionOutput } from "./execution.js";

export interface RemediationLoopInput {
  store: LocalStore;
  runId: string;
  stepId: string;
  stepName: string;
  stepExecution: StepExecutionOutput;
  enqueue: (
    stepId: string,
    reason: string,
    queuedByStepId?: string,
    queuedByReason?: StepEnqueueReason
  ) => void;
}

export interface RemediationLoopResult {
  stoppedForInput: boolean;
  stoppedForFailure: boolean;
}

export function runRemediationLoop(input: RemediationLoopInput): RemediationLoopResult {
  if (input.stepExecution.shouldStopForInput) {
    const reason = formatManualInputStopReason(input.stepName, input.stepExecution.inputSummary);
    appendRunLog(input.store, input.runId, `${input.stepName} requires user input; stopping run for remediation.`);
    markRunFailed(input.store, input.runId, reason);
    return { stoppedForInput: true, stoppedForFailure: false };
  }

  const blockingGateLog = formatBlockingGateFailureLog(input.stepName, input.stepExecution.qualityGateResults);
  if (blockingGateLog) {
    appendRunLog(input.store, input.runId, blockingGateLog);
  }

  if (input.stepExecution.hasBlockingGateFailure && input.stepExecution.routedLinks.length === 0) {
    const reason = `${input.stepName} failed blocking quality gates and has no on_fail remediation route.`;
    appendRunLog(input.store, input.runId, reason);
    markRunFailed(input.store, input.runId, reason);
    return { stoppedForInput: false, stoppedForFailure: true };
  }

  if (input.stepExecution.outgoingLinks.length > 0 && input.stepExecution.routedLinks.length === 0) {
    appendRunLog(input.store, input.runId, formatNoRouteMatchLog(input.stepName, input.stepExecution.workflowOutcome));
  }

  for (const link of input.stepExecution.routedLinks) {
    input.enqueue(link.targetStepId, formatRouteEnqueueReason(input.stepName, link.condition), input.stepId, "route");
  }

  return { stoppedForInput: false, stoppedForFailure: false };
}
