import type { LocalStore } from "../../storage.js";
import { normalizeStepLabel } from "../../stepLabel.js";
import type {
  PipelineRun,
  PipelineStep,
  StepTriggerReason,
  StepQualityGateResult,
  StepRun,
  WorkflowOutcome
} from "../../types.js";
import { nowIso } from "./time.js";

function createRunStep(step: PipelineStep): StepRun {
  return {
    stepId: step.id,
    stepName: normalizeStepLabel(step.name, step.id),
    role: step.role,
    status: "pending",
    attempts: 0,
    workflowOutcome: "neutral",
    inputContext: "",
    output: "",
    subagentNotes: [],
    qualityGateResults: []
  };
}

function updateRunStep(run: PipelineRun, step: PipelineStep, updater: (current: StepRun) => StepRun): PipelineRun {
  const index = run.steps.findIndex((entry) => entry.stepId === step.id);
  const current = index >= 0 ? run.steps[index] : createRunStep(step);
  const nextEntry = updater(current);
  const steps = [...run.steps];

  if (index >= 0) {
    steps[index] = nextEntry;
  } else {
    steps.push(nextEntry);
  }

  return {
    ...run,
    steps
  };
}

export function appendRunLog(store: LocalStore, runId: string, message: string): void {
  store.updateRun(runId, (run) => ({
    ...run,
    logs: [...run.logs, message]
  }));
}

export function markRunStart(store: LocalStore, runId: string): void {
  const startedAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") {
      return run;
    }

    const status: PipelineRun["status"] =
      run.status === "paused" || run.status === "awaiting_approval" ? run.status : "running";

    return {
      ...run,
      status,
      logs: [...run.logs, `Run started at ${startedAt}`]
    };
  });
}

export function markRunCompleted(store: LocalStore, runId: string): void {
  const finishedAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled") {
      return run;
    }

    return {
      ...run,
      status: "completed",
      finishedAt,
      logs: [...run.logs, `Run completed at ${finishedAt}`]
    };
  });
}

export function markRunFailed(store: LocalStore, runId: string, reason: string): void {
  const failedAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled") {
      return run;
    }

    return {
      ...run,
      status: "failed",
      finishedAt: failedAt,
      logs: [...run.logs, `Run failed: ${reason}`]
    };
  });
}

export function markRunCancelled(store: LocalStore, runId: string, reason: string): void {
  const cancelledAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled") {
      return run;
    }

    if (run.status !== "queued" && run.status !== "running" && run.status !== "paused" && run.status !== "awaiting_approval") {
      return run;
    }

    return {
      ...run,
      status: "cancelled",
      finishedAt: run.finishedAt ?? cancelledAt,
      logs: [...run.logs, `Run stopped: ${reason}`],
      steps: run.steps.map((step) =>
        step.status === "running"
          ? {
              ...step,
              status: "failed",
              workflowOutcome: "fail",
              error: step.error ?? reason,
              finishedAt: step.finishedAt ?? cancelledAt
            }
          : step
      )
    };
  });
}

export function markStepRunning(
  store: LocalStore,
  runId: string,
  step: PipelineStep,
  context: string,
  attempt: number,
  triggeredByStepId?: string,
  triggeredByReason?: StepTriggerReason
): void {
  store.updateRun(runId, (run) => {
    const stepLabel = normalizeStepLabel(step.name, step.id);
    const nextRun = updateRunStep(run, step, (current) => ({
      ...current,
      status: "running",
      attempts: attempt,
      triggeredByStepId,
      triggeredByReason,
      inputContext: context,
      error: undefined,
      qualityGateResults: [],
      startedAt: nowIso()
    }));

    return {
      ...nextRun,
      logs: [...nextRun.logs, `${stepLabel} started (attempt ${attempt})`]
    };
  });
}

export function markStepCompleted(
  store: LocalStore,
  runId: string,
  step: PipelineStep,
  output: string,
  subagentNotes: string[],
  qualityGateResults: StepQualityGateResult[],
  workflowOutcome: WorkflowOutcome,
  attempt: number,
  triggeredByStepId?: StepRun["triggeredByStepId"],
  triggeredByReason?: StepRun["triggeredByReason"]
): void {
  store.updateRun(runId, (run) => {
    const stepLabel = normalizeStepLabel(step.name, step.id);
    const nextRun = updateRunStep(run, step, (current) => ({
      ...current,
      status: "completed",
      attempts: attempt,
      triggeredByStepId: triggeredByStepId ?? current.triggeredByStepId,
      triggeredByReason: triggeredByReason ?? current.triggeredByReason,
      workflowOutcome,
      output,
      subagentNotes,
      qualityGateResults,
      finishedAt: nowIso()
    }));

    return {
      ...nextRun,
      logs: [...nextRun.logs, `${stepLabel} completed (${workflowOutcome})`]
    };
  });
}

export function markStepFailed(store: LocalStore, runId: string, step: PipelineStep, error: string, attempt: number): void {
  store.updateRun(runId, (run) => {
    const stepLabel = normalizeStepLabel(step.name, step.id);
    const nextRun = updateRunStep(run, step, (current) => ({
      ...current,
      status: "failed",
      attempts: attempt,
      error,
      qualityGateResults: [],
      finishedAt: nowIso()
    }));

    return {
      ...nextRun,
      status: "failed",
      finishedAt: nowIso(),
      logs: [...nextRun.logs, `${stepLabel} failed: ${error}`]
    };
  });
}

export function markStepPaused(store: LocalStore, runId: string, step: PipelineStep, attempt: number): void {
  store.updateRun(runId, (run) => {
    const stepLabel = normalizeStepLabel(step.name, step.id);
    const nextRun = updateRunStep(run, step, (current) => ({
      ...current,
      status: "pending",
      attempts: Math.max(current.attempts, attempt),
      workflowOutcome: "neutral",
      error: undefined,
      finishedAt: undefined
    }));

    return {
      ...nextRun,
      logs: [...nextRun.logs, `${stepLabel} paused (attempt ${attempt})`]
    };
  });
}
