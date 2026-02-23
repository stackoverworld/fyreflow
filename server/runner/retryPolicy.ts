import type { LocalStore } from "../storage.js";
import { normalizeStepLabel } from "../stepLabel.js";
import type { PipelineStep } from "../types.js";
import { markRunCancelled, persistRunStateSnapshot } from "./scheduling.js";

export type StepEnqueueReason =
  | "entry_step"
  | "cycle_bootstrap"
  | "route"
  | "skip_if_artifacts"
  | "disconnected_fallback";

export interface StepRetryState {
  maxAttemptsPerStep: number;
  attemptsByStep: Map<string, number>;
  queue: StepQueueItem[];
  queued: Set<string>;
  inFlight: Set<string>;
}

export interface StepQueueItem {
  stepId: string;
  queuedByStepId?: string;
  queuedByReason: StepEnqueueReason;
}

export function createStepRetryState(maxLoops: number): StepRetryState {
  return {
    maxAttemptsPerStep: maxLoops + 1,
    attemptsByStep: new Map<string, number>(),
    queue: [],
    queued: new Set<string>(),
    inFlight: new Set<string>()
  };
}

export async function checkRunAbort(
  abortSignal: AbortSignal | undefined,
  store: LocalStore,
  runId: string,
  runRootPath: string,
  reason = "Stopped by user"
): Promise<boolean> {
  if (!abortSignal?.aborted) {
    return false;
  }

  const run = store.getRun(runId);
  if (run?.status === "paused") {
    await persistRunStateSnapshot(store, runId, runRootPath);
    return true;
  }

  markRunCancelled(store, runId, reason);
  await persistRunStateSnapshot(store, runId, runRootPath);
  return true;
}

export function enqueueStepForExecution(
  state: StepRetryState,
  stepById: Map<string, PipelineStep>,
  log: (message: string) => void,
  stepId: string,
  reason?: string,
  queuedByStepId?: string,
  queuedByReason: StepEnqueueReason = "route"
): boolean {
  if (!stepById.has(stepId)) {
    return false;
  }

  if (state.queued.has(stepId)) {
    if (queuedByStepId) {
      const queuedItem = state.queue.find((item) => item.stepId === stepId);
      if (queuedItem) {
        queuedItem.queuedByStepId = queuedByStepId;
        queuedItem.queuedByReason = queuedByReason;
      }
    }
    return false;
  }

  const attempts = state.attemptsByStep.get(stepId) ?? 0;
  if (attempts >= state.maxAttemptsPerStep) {
    log(`Skipped ${normalizeStepLabel(stepById.get(stepId)?.name, stepId)}: max loop count reached`);
    return false;
  }

  state.queue.push({
    stepId,
    queuedByStepId,
    queuedByReason
  });
  state.queued.add(stepId);

  if (reason) {
    log(`Queued ${normalizeStepLabel(stepById.get(stepId)?.name, stepId)} (${reason})`);
  }

  return true;
}

export function dequeueNextStep(state: StepRetryState): StepQueueItem | undefined {
  const queuedItem = state.queue.shift();
  if (queuedItem) {
    state.queued.delete(queuedItem.stepId);
    state.inFlight.add(queuedItem.stepId);
  }
  return queuedItem;
}

export function getStepAttempt(state: StepRetryState, stepId: string): number {
  return (state.attemptsByStep.get(stepId) ?? 0) + 1;
}

export function canAttemptStep(state: StepRetryState, stepId: string): boolean {
  return getStepAttempt(state, stepId) <= state.maxAttemptsPerStep;
}

export function recordStepAttempt(state: StepRetryState, stepId: string, attempt: number): void {
  state.attemptsByStep.set(stepId, attempt);
}

export function markStepExecutionSettled(state: StepRetryState, stepId: string): void {
  state.inFlight.delete(stepId);
}

export function findNextUnvisitedStep<TStep extends PipelineStep>(
  orderedSteps: TStep[],
  state: Pick<StepRetryState, "attemptsByStep" | "queued" | "inFlight">
): TStep | undefined {
  return orderedSteps.find(
    (step) =>
      (state.attemptsByStep.get(step.id) ?? 0) === 0 &&
      !state.queued.has(step.id) &&
      !state.inFlight.has(step.id)
  );
}
