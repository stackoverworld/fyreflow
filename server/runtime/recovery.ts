import { orderPipelineSteps } from "../pipelineGraph.js";
import { cancelRun, runPipeline } from "../runner.js";
import { filterPipelineForScenario } from "../scenarios.js";
import { normalizeStepLabel } from "../stepLabel.js";
import { getPipelineSecureInputs, maskSensitiveInputs, mergeRunInputsWithSecure } from "../secureInputs.js";
import type { LocalStore } from "../storage.js";
import type { Pipeline, PipelineRun, RunStatus } from "../types.js";

export interface RunRecoveryRuntimeDependencies {
  store: LocalStore;
  activeRunControllers: Map<string, AbortController>;
}

export function createRunRecoveryRuntime(deps: RunRecoveryRuntimeDependencies): {
  attachWorkerToExistingRun: (run: PipelineRun, pipeline: Pipeline, reason: string) => Promise<void>;
  listActivePipelineIds: () => Set<string>;
  recoverInterruptedRuns: () => Promise<void>;
} {
  async function attachWorkerToExistingRun(
    run: PipelineRun,
    pipeline: Pipeline,
    reason: string
  ): Promise<void> {
    if (deps.activeRunControllers.has(run.id)) {
      return;
    }

    const secureInputs = await getPipelineSecureInputs(pipeline.id);
    const mergedRuntimeInputs = mergeRunInputsWithSecure(run.inputs ?? {}, secureInputs);
    const maskedRunInputs = maskSensitiveInputs(mergedRuntimeInputs, Object.keys(secureInputs));

    deps.store.updateRun(run.id, (current) => ({
      ...current,
      pipelineName: pipeline.name,
      inputs: maskedRunInputs,
      logs: [...current.logs, reason]
    }));

    const abortController = new AbortController();
    deps.activeRunControllers.set(run.id, abortController);

    void runPipeline({
      store: deps.store,
      runId: run.id,
      pipeline,
      task: run.task,
      runInputs: mergedRuntimeInputs,
      scenario: run.scenario,
      abortSignal: abortController.signal
    })
      .catch((error) => {
        console.error("[recovered-run-error]", error);
        cancelRun(deps.store, run.id, "Recovered run failed unexpectedly");
      })
      .finally(() => {
        deps.activeRunControllers.delete(run.id);
      });
  }

  function listActivePipelineIds(): Set<string> {
    const activeStatuses = new Set<RunStatus>(["queued", "running", "paused", "awaiting_approval"]);
    const active = new Set<string>();

    for (const run of deps.store.getState().runs) {
      if (activeStatuses.has(run.status)) {
        active.add(run.pipelineId);
      }
    }

    return active;
  }

  function buildPendingRunSteps(pipeline: Pipeline, scenario?: string): PipelineRun["steps"] {
    const scoped = filterPipelineForScenario(pipeline, scenario);
    const orderedSteps = orderPipelineSteps(scoped.steps, scoped.links);
    return orderedSteps.map((step) => ({
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
    }));
  }

  async function resumeRunAfterRestart(run: PipelineRun, pipeline: Pipeline): Promise<void> {
    const secureInputs = await getPipelineSecureInputs(pipeline.id);
    const mergedRuntimeInputs = mergeRunInputsWithSecure(run.inputs ?? {}, secureInputs);
    const maskedRunInputs = maskSensitiveInputs(mergedRuntimeInputs, Object.keys(secureInputs));

    deps.store.updateRun(run.id, (current) => ({
      ...current,
      pipelineName: pipeline.name,
      inputs: maskedRunInputs,
      status: "queued",
      finishedAt: undefined,
      logs: [...current.logs, `Recovery: re-queued after restart at ${new Date().toISOString()}`],
      steps: buildPendingRunSteps(pipeline, run.scenario),
      approvals: []
    }));

    const abortController = new AbortController();
    deps.activeRunControllers.set(run.id, abortController);

    void runPipeline({
      store: deps.store,
      runId: run.id,
      pipeline,
      task: run.task,
      runInputs: mergedRuntimeInputs,
      scenario: run.scenario,
      abortSignal: abortController.signal
    })
      .catch((error) => {
        console.error("[recovered-run-error]", error);
        cancelRun(deps.store, run.id, "Recovered run failed unexpectedly");
      })
      .finally(() => {
        deps.activeRunControllers.delete(run.id);
      });
  }

  async function recoverInterruptedRuns(): Promise<void> {
    const resumableStatuses = new Set<RunStatus>(["queued", "running"]);
    const suspendedStatuses = new Set<RunStatus>(["paused", "awaiting_approval"]);
    const allCandidates = deps
      .store
      .getState()
      .runs.filter((run) => resumableStatuses.has(run.status) || suspendedStatuses.has(run.status));

    if (allCandidates.length === 0) {
      return;
    }

    for (const run of allCandidates) {
      const pipeline = deps.store.getPipeline(run.pipelineId);
      if (!pipeline) {
        cancelRun(deps.store, run.id, "Recovery failed: pipeline no longer exists");
        continue;
      }

      if (suspendedStatuses.has(run.status)) {
        const recoveryLog = `Recovery: run remains ${run.status}. Resume/approval action is required to continue.`;
        deps.store.updateRun(run.id, (current) => ({
          ...current,
          logs:
            current.logs[current.logs.length - 1] === recoveryLog
              ? current.logs
              : [...current.logs, recoveryLog]
        }));
        console.info(`[recovery] Left run ${run.id} in ${run.status} state for pipeline "${pipeline.name}".`);
        continue;
      }

      console.info(`[recovery] Resuming run ${run.id} for pipeline "${pipeline.name}".`);
      await resumeRunAfterRestart(run, pipeline);
    }
  }

  return {
    attachWorkerToExistingRun,
    listActivePipelineIds,
    recoverInterruptedRuns
  };
}
