import { cancelRun, runPipeline } from "../runner.js";
import { normalizeRunInputs } from "../runInputs.js";
import { resolveRunScenario } from "../scenarios.js";
import {
  getPipelineSecureInputs,
  maskSensitiveInputs,
  mergeRunInputsWithSecure,
  pickSensitiveInputs,
  upsertPipelineSecureInputs
} from "../secureInputs.js";
import type { LocalStore } from "../storage.js";
import { buildSmartRunPlan } from "../smartRun.js";
import type { Pipeline, PipelineRun, SmartRunCheck } from "../types.js";

export interface QueuePipelineRunOptions {
  pipeline: Pipeline;
  task: string;
  rawInputs?: Record<string, string>;
  scenario?: string;
  persistSensitiveInputs: boolean;
}

export interface RunQueueRuntimeDependencies {
  store: LocalStore;
  activeRunControllers: Map<string, AbortController>;
}

export class RunPreflightError extends Error {
  readonly failedChecks: SmartRunCheck[];

  constructor(failedChecks: SmartRunCheck[]) {
    const firstFailure = failedChecks[0];
    const message = firstFailure
      ? `Run blocked by preflight: ${firstFailure.title}: ${firstFailure.message}`
      : "Run blocked by preflight checks.";
    super(message);
    this.name = "RunPreflightError";
    this.failedChecks = failedChecks;
  }
}

export function isRunPreflightError(error: unknown): error is RunPreflightError {
  return error instanceof RunPreflightError;
}

export function formatFailedPreflightCheck(check: SmartRunCheck | undefined): string {
  if (!check) {
    return "Unknown preflight failure.";
  }
  return `${check.title}: ${check.message}`;
}

export function createRunQueueRuntime(deps: RunQueueRuntimeDependencies): {
  queuePipelineRun: (options: QueuePipelineRunOptions) => Promise<PipelineRun>;
} {
  async function queuePipelineRun(options: QueuePipelineRunOptions): Promise<PipelineRun> {
    const normalizedRunInputs = normalizeRunInputs(options.rawInputs);
    const rawSensitiveInputs = pickSensitiveInputs(normalizedRunInputs);
    const secureInputs = await getPipelineSecureInputs(options.pipeline.id);
    const sensitiveUpdates = options.persistSensitiveInputs ? rawSensitiveInputs : {};
    const hasSensitiveUpdates = Object.keys(sensitiveUpdates).length > 0;

    if (hasSensitiveUpdates) {
      await upsertPipelineSecureInputs(options.pipeline.id, sensitiveUpdates);
    }

    const runtimeSecureInputs = hasSensitiveUpdates
      ? {
          ...secureInputs,
          ...sensitiveUpdates
        }
      : secureInputs;
    const mergedRuntimeInputs = mergeRunInputsWithSecure(normalizedRunInputs, runtimeSecureInputs);
    const preflightPlan = await buildSmartRunPlan(options.pipeline, deps.store.getState(), mergedRuntimeInputs);
    const failedChecks = preflightPlan.checks.filter((check) => check.status === "fail");
    if (failedChecks.length > 0) {
      throw new RunPreflightError(failedChecks);
    }

    const keysToMask = [...new Set([...Object.keys(runtimeSecureInputs), ...Object.keys(rawSensitiveInputs)])];
    const maskedRunInputs = maskSensitiveInputs(mergedRuntimeInputs, keysToMask);
    const scenario = resolveRunScenario(options.scenario, undefined, mergedRuntimeInputs);
    const run = deps.store.createRun(options.pipeline, options.task, maskedRunInputs, scenario);
    const abortController = new AbortController();
    deps.activeRunControllers.set(run.id, abortController);

    void runPipeline({
      store: deps.store,
      runId: run.id,
      pipeline: options.pipeline,
      task: options.task,
      runInputs: mergedRuntimeInputs,
      scenario,
      abortSignal: abortController.signal
    })
      .catch((error) => {
        console.error("[run-pipeline-error]", error);
        cancelRun(deps.store, run.id, "Unexpected run error");
      })
      .finally(() => {
        deps.activeRunControllers.delete(run.id);
      });

    return run;
  }

  return {
    queuePipelineRun
  };
}
