import type { LocalStore } from "../storage.js";
import type { PipelineStep } from "../types.js";
import { markRunCancelled, persistRunStateSnapshot } from "./scheduling.js";

export interface StepRetryState {
  maxAttemptsPerStep: number;
  attemptsByStep: Map<string, number>;
  queue: string[];
  queued: Set<string>;
}

export function createStepRetryState(maxLoops: number): StepRetryState {
  return {
    maxAttemptsPerStep: maxLoops + 1,
    attemptsByStep: new Map<string, number>(),
    queue: [],
    queued: new Set<string>()
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

  markRunCancelled(store, runId, reason);
  await persistRunStateSnapshot(store, runId, runRootPath);
  return true;
}

export function enqueueStepForExecution(
  state: StepRetryState,
  stepById: Map<string, PipelineStep>,
  log: (message: string) => void,
  stepId: string,
  reason?: string
): boolean {
  if (!stepById.has(stepId) || state.queued.has(stepId)) {
    return false;
  }

  const attempts = state.attemptsByStep.get(stepId) ?? 0;
  if (attempts >= state.maxAttemptsPerStep) {
    log(`Skipped ${stepById.get(stepId)?.name ?? stepId}: max loop count reached`);
    return false;
  }

  state.queue.push(stepId);
  state.queued.add(stepId);

  if (reason) {
    log(`Queued ${stepById.get(stepId)?.name ?? stepId} (${reason})`);
  }

  return true;
}

export function dequeueNextStep(state: StepRetryState): string | undefined {
  const stepId = state.queue.shift();
  if (stepId !== undefined) {
    state.queued.delete(stepId);
  }
  return stepId;
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

export function findNextUnvisitedStep<TStep extends PipelineStep>(orderedSteps: TStep[], attemptsByStep: Map<string, number>): TStep | undefined {
  return orderedSteps.find((step) => (attemptsByStep.get(step.id) ?? 0) === 0);
}
