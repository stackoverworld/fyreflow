import { orderPipelineSteps } from "./pipelineGraph.js";
import { mergeAbortSignals } from "./abort.js";
import type { LocalStore } from "./storage.js";
import type {
  PipelineRun,
  ProviderConfig,
  ProviderId,
} from "./types.js";
import { normalizeRunInputs } from "./runInputs.js";
import { filterPipelineForScenario, resolveRunScenario } from "./scenarios.js";
import type { RunPipelineInput } from "./runner/types.js";
import {
  appendRunLog,
  buildGraph,
  hasPendingApprovals,
  markRunCancelled,
  markRunCompleted,
  markRunFailed,
  markRunStart,
  markStepFailed,
  markStepRunning,
  normalizeRuntime,
  persistPipelineSnapshot,
  persistRunStateSnapshot,
  resolveRunRootPath,
  waitForRunToBeRunnable
} from "./runner/scheduling.js";
import {
  composeContext,
  ensureStepStorage,
  resolveStepStoragePaths
} from "./runner/context.js";
import {
  checkRunAbort,
  canAttemptStep,
  createStepRetryState,
  dequeueNextStep,
  enqueueStepForExecution,
  findNextUnvisitedStep,
  getStepAttempt,
} from "./runner/retryPolicy.js";
import { runRemediationLoop } from "./runner/remediationLoop.js";
import { mapStepExecutionResult } from "./runner/resultMapping.js";
import { executeStepForPipeline } from "./runner/stepExecution.js";
import { checkArtifactsExist } from "./runner/artifacts.js";
import { routeMatchesCondition } from "./runner/qualityGates.js";

export function cancelRun(store: LocalStore, runId: string, reason = "Stopped by user"): boolean {
  const run = store.getRun(runId);
  if (!run) {
    return false;
  }

  if (run.status !== "queued" && run.status !== "running" && run.status !== "paused" && run.status !== "awaiting_approval") {
    return false;
  }

  markRunCancelled(store, runId, reason);
  return true;
}

export function pauseRun(store: LocalStore, runId: string, reason = "Paused by user"): boolean {
  const run = store.getRun(runId);
  if (!run) {
    return false;
  }

  if (run.status !== "queued" && run.status !== "running" && run.status !== "awaiting_approval") {
    return false;
  }

  store.updateRun(runId, (current) => {
    if (current.status !== "queued" && current.status !== "running" && current.status !== "awaiting_approval") {
      return current;
    }

    return {
      ...current,
      status: "paused",
      logs: [...current.logs, `Run paused: ${reason}`]
    };
  });

  return true;
}

export function resumeRun(store: LocalStore, runId: string, reason = "Resumed by user"): boolean {
  const run = store.getRun(runId);
  if (!run || run.status !== "paused") {
    return false;
  }

  store.updateRun(runId, (current) => {
    if (current.status !== "paused") {
      return current;
    }

    const nextStatus = hasPendingApprovals(current) ? "awaiting_approval" : "running";
    return {
      ...current,
      status: nextStatus,
      logs: [...current.logs, `Run resumed: ${reason}`]
    };
  });

  return true;
}

export type ApprovalDecision = "approved" | "rejected";
export type ResolveRunApprovalResult =
  | { status: "ok"; run: PipelineRun }
  | { status: "run_not_found" }
  | { status: "approval_not_found" }
  | { status: "already_resolved"; run: PipelineRun };

export function resolveRunApproval(
  store: LocalStore,
  runId: string,
  approvalId: string,
  decision: ApprovalDecision,
  note?: string
): ResolveRunApprovalResult {
  const run = store.getRun(runId);
  if (!run) {
    return { status: "run_not_found" };
  }

  const existing = run.approvals.find((approval) => approval.id === approvalId);
  if (!existing) {
    return { status: "approval_not_found" };
  }

  if (existing.status !== "pending") {
    return { status: "already_resolved", run };
  }

  const resolvedAt = new Date().toISOString();
  const trimmedNote = typeof note === "string" && note.trim().length > 0 ? note.trim() : undefined;
  const updated = store.updateRun(runId, (current) => {
    const approvals = current.approvals.map((approval) => {
      if (approval.id !== approvalId || approval.status !== "pending") {
        return approval;
      }

      return {
        ...approval,
        status: decision,
        resolvedAt,
        note: trimmedNote
      };
    });

    const pendingLeft = approvals.some((approval) => approval.status === "pending");
    const nextStatus: PipelineRun["status"] =
      current.status === "paused"
        ? "paused"
        : current.status === "awaiting_approval" && !pendingLeft
          ? "running"
          : current.status;

    return {
      ...current,
      status: nextStatus,
      approvals,
      logs: [
        ...current.logs,
        `Manual approval ${decision}: ${existing.gateName} (${existing.stepName})${trimmedNote ? ` — ${trimmedNote}` : ""}`
      ]
    };
  });

  if (!updated) {
    return { status: "run_not_found" };
  }

  return { status: "ok", run: updated };
}

export async function runPipeline(input: RunPipelineInput): Promise<void> {
  const { store, runId, pipeline, task, abortSignal } = input;
  const runtime = normalizeRuntime(pipeline);
  const coordinationAbortController = new AbortController();
  const executionAbortSignal = mergeAbortSignals([abortSignal, coordinationAbortController.signal]);
  const providers = store.getProviders() as Record<ProviderId, ProviderConfig>;
  const state = store.getState();
  const storageConfig = state.storage;
  const runRootPath = resolveRunRootPath(storageConfig, runId);
  const runRecord = store.getRun(runId);
  const runInputs = normalizeRunInputs(input.runInputs ?? runRecord?.inputs);
  const scenario = resolveRunScenario(input.scenario, runRecord?.scenario, runInputs);
  const scopedPipeline = filterPipelineForScenario(pipeline, scenario);
  const mcpServersById = new Map(state.mcpServers.map((server) => [server.id, server]));
  const orderedSteps = orderPipelineSteps(scopedPipeline.steps, scopedPipeline.links);
  const maxParallelSubagents = orderedSteps.reduce((maxWorkers, step) => {
    if (!step.enableDelegation) {
      return maxWorkers;
    }
    const stepWorkers = Math.max(1, Math.min(8, Math.floor(step.delegationCount || 1)));
    return Math.max(maxWorkers, stepWorkers);
  }, 1);
  const eligibleStepIds = new Set(orderedSteps.map((step) => step.id));
  const pipelineQualityGates = (pipeline.qualityGates ?? []).filter(
    (gate) => gate.targetStepId === "any_step" || eligibleStepIds.has(gate.targetStepId)
  );
  const runPipelineDefinition = {
    ...pipeline,
    steps: orderedSteps,
    links: scopedPipeline.links,
    qualityGates: pipelineQualityGates
  };

  if (scenario) {
    store.updateRun(runId, (current) =>
      current.scenario === scenario
        ? current
        : {
            ...current,
            scenario
          }
    );
  }

  if (orderedSteps.length === 0) {
    markRunFailed(
      store,
      runId,
      scenario ? `Pipeline has no steps for scenario "${scenario}"` : "Pipeline has no steps"
    );
    await persistRunStateSnapshot(store, runId, runRootPath);
    return;
  }

  const stepById = new Map(orderedSteps.map((step) => [step.id, step]));
  const { outgoingById, incomingById } = buildGraph(orderedSteps, scopedPipeline.links);
  const retryState = createStepRetryState(runtime.maxLoops);
  const latestOutputByStepId = new Map<string, string>();
  const timeline: { stepId: string; stepName: string; output: string }[] = [];
  const stopIfAborted = () => checkRunAbort(abortSignal, store, runId, runRootPath);

  if (await stopIfAborted()) {
    return;
  }

  const enqueue = (stepId: string, reason?: string) =>
    enqueueStepForExecution(
      retryState,
      stepById,
      (message) => appendRunLog(store, runId, message),
      stepId,
      reason
    );

  const entrySteps = orderedSteps.filter((step) => (incomingById.get(step.id)?.length ?? 0) === 0);
  if (entrySteps.length > 0) {
    for (const step of entrySteps) {
      enqueue(step.id, "entry step");
    }
  } else {
    const orchestrator = orderedSteps.find((step) => step.role === "orchestrator");
    enqueue(orchestrator?.id ?? orderedSteps[0].id, "cycle bootstrap");
  }

  markRunStart(store, runId);
  if (scenario) {
    appendRunLog(store, runId, `Run scenario: ${scenario}`);
  }
  if (maxParallelSubagents > 1) {
    appendRunLog(store, runId, `Subagent workers enabled: up to ${maxParallelSubagents} parallel workers`);
  }
  await persistPipelineSnapshot(runRootPath, runPipelineDefinition);
  await persistRunStateSnapshot(store, runId, runRootPath);

  if (await stopIfAborted()) {
    return;
  }

  let totalExecutions = 0;
  type StepOutcome = "ok" | "stop";

  const dequeueStepForExecution = (): string | undefined => {
    const queued = dequeueNextStep(retryState);
    if (queued) {
      return queued;
    }

    const nextUnvisited = findNextUnvisitedStep(orderedSteps, retryState.attemptsByStep);
    if (!nextUnvisited) {
      return undefined;
    }

    enqueue(nextUnvisited.id, "disconnected fallback");
    return dequeueNextStep(retryState);
  };

  const executeQueuedStep = async (stepId: string): Promise<StepOutcome> => {
    const step = stepById.get(stepId);
    if (!step) {
      return "ok";
    }

    const attempt = getStepAttempt(retryState, stepId);
    if (!canAttemptStep(retryState, stepId)) {
      appendRunLog(store, runId, `Skipped ${step.name}: max loop count reached`);
      return "ok";
    }

    try {
      const incomingLinks = incomingById.get(stepId) ?? [];
      const storagePaths = resolveStepStoragePaths(step, pipeline.id, runId, storageConfig);
      await ensureStepStorage(storagePaths);

      if (await stopIfAborted()) {
        return "stop";
      }

      const shouldCheckSkipArtifacts = Array.isArray(step.skipIfArtifacts) && step.skipIfArtifacts.length > 0;
      if (shouldCheckSkipArtifacts) {
        const skipChecks = await checkArtifactsExist(step.skipIfArtifacts, storagePaths, runInputs);
        const shouldSkip = skipChecks.length > 0 && skipChecks.every((check) => check.exists);

        if (shouldSkip) {
          const outputLines = [
            "STEP_STATUS: SKIPPED",
            "SKIP_REASON: required artifacts already exist",
            ...skipChecks.map((check) => `${check.template} => ${check.foundPath ?? "missing"}`)
          ];
          const skipOutput = outputLines.join("\n");
          const routedLinks = (outgoingById.get(stepId) ?? []).filter((link) =>
            routeMatchesCondition(link.condition, "pass")
          );

          mapStepExecutionResult({
            store,
            runId,
            step,
            attempt,
            retryState,
            stepExecution: {
              output: skipOutput,
              qualityGateResults: [],
              hasBlockingGateFailure: false,
              shouldStopForInput: false,
              workflowOutcome: "pass",
              outgoingLinks: outgoingById.get(stepId) ?? [],
              routedLinks,
              subagentNotes: []
            },
            latestOutputByStepId,
            timeline
          });

          for (const link of routedLinks) {
            enqueue(link.targetStepId, `${step.name} skipped (artifacts already exist)`);
          }

          appendRunLog(store, runId, `Skipped ${step.name}: all skip-if artifacts already exist`);
          totalExecutions += 1;
          await persistRunStateSnapshot(store, runId, runRootPath);
          return "ok";
        }
      }

      const context = composeContext(
        step,
        task,
        timeline,
        latestOutputByStepId,
        incomingLinks,
        stepById,
        attempt,
        storagePaths,
        runInputs
      );
      markStepRunning(store, runId, step, context, attempt);

      const executionResult = await executeStepForPipeline({
        store,
        runId,
        step,
        attempt,
        context,
        task,
        provider: providers[step.providerId],
        stageTimeoutMs: runtime.stageTimeoutMs,
        mcpServersById,
        runInputs,
        storagePaths,
        outgoingLinks: outgoingById.get(stepId) ?? [],
        qualityGates: pipelineQualityGates,
        stepById,
        abortSignal: executionAbortSignal
      });

      if (executionResult.status === "success") {
        mapStepExecutionResult({
          store,
          runId,
          step,
          attempt,
          retryState,
          stepExecution: executionResult.stepExecution,
          latestOutputByStepId,
          timeline
        });
        totalExecutions += 1;
        await persistRunStateSnapshot(store, runId, runRootPath);

        const remediation = runRemediationLoop({
          store,
          runId,
          stepName: step.name,
          stepExecution: executionResult.stepExecution,
          enqueue
        });
        if (remediation.stoppedForInput) {
          await persistRunStateSnapshot(store, runId, runRootPath);
          return "stop";
        }
        return "ok";
      }

      if (executionResult.status === "cancelled") {
        if (abortSignal?.aborted) {
          markRunCancelled(store, runId, "Stopped by user");
        } else {
          markStepFailed(store, runId, step, "Cancelled", attempt);
        }
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stop";
      }

      const failureMessage = executionResult.message;
      if (executionResult.status === "aborted" || executionResult.status === "failed") {
        if (abortSignal?.aborted) {
          markRunCancelled(store, runId, "Stopped by user");
        } else {
          markStepFailed(store, runId, step, failureMessage, attempt);
        }
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stop";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown step execution error";
      markStepFailed(store, runId, step, message, attempt);
      await persistRunStateSnapshot(store, runId, runRootPath);
      return "stop";
    }

    return "ok";
  };

  const runSerial = async (): Promise<"completed" | "stopped"> => {
    while (true) {
      if (await stopIfAborted()) {
        return "stopped";
      }

      if (!(await waitForRunToBeRunnable(store, runId, abortSignal))) {
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stopped";
      }

      if (totalExecutions >= runtime.maxStepExecutions) {
        markRunFailed(store, runId, `Execution cap reached (${runtime.maxStepExecutions} stages)`);
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stopped";
      }

      const stepId = dequeueStepForExecution();
      if (!stepId) {
        break;
      }

      const outcome = await executeQueuedStep(stepId);
      if (outcome === "stop") {
        return "stopped";
      }
    }

    return "completed";
  };

  const runWithSubagents = async (): Promise<"completed" | "stopped"> => {
    const availableSlots: number[] = Array.from({ length: maxParallelSubagents }, (_, index) => index + 1);
    let overflowSlot = maxParallelSubagents;
    const acquireSlot = (): number => {
      const next = availableSlots.shift();
      if (typeof next === "number") {
        return next;
      }
      overflowSlot += 1;
      return overflowSlot;
    };
    const releaseSlot = (slot: number): void => {
      if (slot <= maxParallelSubagents && !availableSlots.includes(slot)) {
        availableSlots.push(slot);
        availableSlots.sort((a, b) => a - b);
      }
    };

    type WorkerResult = {
      token: number;
      slot: number;
      stepName: string;
      outcome: StepOutcome;
    };

    let workerToken = 0;
    const activeWorkers = new Map<number, Promise<WorkerResult>>();

    while (true) {
      if (await stopIfAborted()) {
        coordinationAbortController.abort();
        await Promise.allSettled(activeWorkers.values());
        return "stopped";
      }

      if (!(await waitForRunToBeRunnable(store, runId, abortSignal))) {
        coordinationAbortController.abort();
        await Promise.allSettled(activeWorkers.values());
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stopped";
      }

      if (totalExecutions >= runtime.maxStepExecutions) {
        markRunFailed(store, runId, `Execution cap reached (${runtime.maxStepExecutions} stages)`);
        coordinationAbortController.abort();
        await Promise.allSettled(activeWorkers.values());
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stopped";
      }

      while (
        activeWorkers.size < maxParallelSubagents &&
        totalExecutions + activeWorkers.size < runtime.maxStepExecutions
      ) {
        const stepId = dequeueStepForExecution();
        if (!stepId) {
          break;
        }

        const stepName = stepById.get(stepId)?.name ?? stepId;
        const slot = acquireSlot();
        const token = ++workerToken;
        appendRunLog(store, runId, `Subagent-${slot} started: ${stepName}`);
        const worker = executeQueuedStep(stepId)
          .then((outcome) => ({ token, slot, stepName, outcome }))
          .catch((error) => {
            const message = error instanceof Error ? error.message : "Unknown worker execution error";
            appendRunLog(store, runId, `Subagent-${slot} crashed: ${message}`);
            return { token, slot, stepName, outcome: "stop" as StepOutcome };
          });
        activeWorkers.set(token, worker);
      }

      if (activeWorkers.size === 0) {
        break;
      }

      const completed = await Promise.race(activeWorkers.values());
      activeWorkers.delete(completed.token);
      releaseSlot(completed.slot);
      appendRunLog(
        store,
        runId,
        completed.outcome === "ok"
          ? `Subagent-${completed.slot} finished: ${completed.stepName}`
          : `Subagent-${completed.slot} stopped: ${completed.stepName}`
      );

      if (completed.outcome === "stop") {
        coordinationAbortController.abort();
        await Promise.allSettled(activeWorkers.values());
        return "stopped";
      }
    }

    return "completed";
  };

  const outcome = maxParallelSubagents > 1 ? await runWithSubagents() : await runSerial();
  if (outcome !== "completed") {
    return;
  }

  markRunCompleted(store, runId);
  await persistRunStateSnapshot(store, runId, runRootPath);
}
