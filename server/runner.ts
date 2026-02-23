import { orderPipelineSteps } from "./pipelineGraph.js";
import { mergeAbortSignals } from "./abort.js";
import type { LocalStore } from "./storage.js";
import type {
  PipelineRun,
  PipelineStep,
  ProviderConfig,
  ProviderId,
} from "./types.js";
import { normalizeRunInputs } from "./runInputs.js";
import { filterPipelineForScenario, resolveRunScenario } from "./scenarios.js";
import { normalizeStepLabel } from "./stepLabel.js";
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
  markStepPaused,
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
  markStepExecutionSettled,
  type StepEnqueueReason
} from "./runner/retryPolicy.js";
import { runRemediationLoop } from "./runner/remediationLoop.js";
import { mapStepExecutionResult } from "./runner/resultMapping.js";
import { executeStepForPipeline } from "./runner/stepExecution.js";
import { checkArtifactsState } from "./runner/artifacts.js";
import { routeMatchesCondition } from "./runner/qualityGates.js";
import { retargetDeliveryCompletionGates } from "./runner/qualityGateTargeting.js";
import { resolveSkipIfArtifactsBypassReason } from "./runner/skipPolicy.js";
import { validateStepSkipArtifactsQuality } from "./runner/policyProfiles.js";

export { validateStepSkipArtifactsQuality } from "./runner/policyProfiles.js";

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
  const scopedQualityGates = retargetDeliveryCompletionGates(
    pipeline.qualityGates ?? [],
    orderedSteps,
    scopedPipeline.links
  );
  const pipelineQualityGates = scopedQualityGates.filter(
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
  const orchestratorStepId = orderedSteps.find((step) => step.role === "orchestrator")?.id;
  const orchestratorPrompt =
    typeof orchestratorStepId === "string" ? stepById.get(orchestratorStepId)?.prompt : undefined;
  const { outgoingById, incomingById } = buildGraph(orderedSteps, scopedPipeline.links);
  const retryState = createStepRetryState(runtime.maxLoops);
  const latestOutputByStepId = new Map<string, string>();
  const timeline: { stepId: string; stepName: string; output: string }[] = [];
  const stepsWithFreshArtifacts = new Set<string>();
  const stopIfAborted = () => checkRunAbort(abortSignal, store, runId, runRootPath);
  const isRunPaused = () => store.getRun(runId)?.status === "paused";
  const isStepOutputSkipped = (output: string | undefined): boolean =>
    typeof output === "string" && /(^|\n)STEP_STATUS:\s*SKIPPED\b/i.test(output);
  const parseIsoTimestamp = (value: string | undefined): number | null => {
    if (!value || value.trim().length === 0) {
      return null;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  const resolveDisconnectedFallbackSourceStepId = (targetStepId: string): string | undefined => {
    const incomingLinks = incomingById.get(targetStepId) ?? [];
    if (incomingLinks.length > 0) {
      const run = store.getRun(runId);
      if (run) {
        const runStepById = new Map(run.steps.map((entry) => [entry.stepId, entry]));
        const completedIncoming = incomingLinks
          .map((link) => runStepById.get(link.sourceStepId))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .filter((entry) => (entry.status === "completed" || entry.status === "failed") && !isStepOutputSkipped(entry.output))
          .sort((left, right) => {
            const leftFinishedAt = parseIsoTimestamp(left.finishedAt) ?? Number.NEGATIVE_INFINITY;
            const rightFinishedAt = parseIsoTimestamp(right.finishedAt) ?? Number.NEGATIVE_INFINITY;
            return rightFinishedAt - leftFinishedAt;
          });
        if (completedIncoming.length > 0) {
          return completedIncoming[0]?.stepId;
        }
      }

      const attemptedIncoming = incomingLinks
        .map((link) => link.sourceStepId)
        .find(
          (sourceStepId) =>
            (retryState.attemptsByStep.get(sourceStepId) ?? 0) > 0 && !retryState.inFlight.has(sourceStepId)
        );
      if (attemptedIncoming) {
        return attemptedIncoming;
      }
    }

    if (orchestratorStepId && orchestratorStepId !== targetStepId) {
      return orchestratorStepId;
    }
    return undefined;
  };

  if (await stopIfAborted()) {
    return;
  }

  const enqueue = (
    stepId: string,
    reason?: string,
    queuedByStepId?: string,
    queuedByReason: StepEnqueueReason = "route"
  ) =>
    enqueueStepForExecution(
      retryState,
      stepById,
      (message) => appendRunLog(store, runId, message),
      stepId,
      reason,
      queuedByStepId,
      queuedByReason
    );

  const entrySteps = orderedSteps.filter((step) => (incomingById.get(step.id)?.length ?? 0) === 0);
  if (entrySteps.length > 0) {
    for (const step of entrySteps) {
      enqueue(step.id, "entry step", undefined, "entry_step");
    }
  } else {
    const orchestrator = orderedSteps.find((step) => step.role === "orchestrator");
    enqueue(orchestrator?.id ?? orderedSteps[0].id, "cycle bootstrap", undefined, "cycle_bootstrap");
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
  type QueuedStep = {
    stepId: string;
    queuedByStepId?: string;
    queuedByReason: StepEnqueueReason;
  };

  const stopForAbort = async (step: PipelineStep, attempt: number): Promise<StepOutcome> => {
    if (isRunPaused()) {
      markStepPaused(store, runId, step, attempt);
    } else {
      markRunCancelled(store, runId, "Stopped by user");
    }
    await persistRunStateSnapshot(store, runId, runRootPath);
    return "stop";
  };

  const dequeueStepForExecution = (allowDisconnectedFallback = true): QueuedStep | undefined => {
    const queued = dequeueNextStep(retryState);
    if (queued) {
      return queued;
    }

    if (!allowDisconnectedFallback) {
      return undefined;
    }

    const nextUnvisited = findNextUnvisitedStep(orderedSteps, retryState);
    if (!nextUnvisited) {
      return undefined;
    }

    const fallbackSourceId = resolveDisconnectedFallbackSourceStepId(nextUnvisited.id);
    enqueue(nextUnvisited.id, "disconnected fallback", fallbackSourceId, "disconnected_fallback");
    return dequeueNextStep(retryState);
  };

  const executeQueuedStep = async (queuedStep: QueuedStep): Promise<StepOutcome> => {
    const { stepId, queuedByStepId, queuedByReason } = queuedStep;
    let step = stepById.get(stepId);
    let attempt = getStepAttempt(retryState, stepId);
    try {
      if (!step) {
        return "ok";
      }
      const stepLabel = normalizeStepLabel(step.name, step.id);

      if (!canAttemptStep(retryState, stepId)) {
        appendRunLog(store, runId, `Skipped ${stepLabel}: max loop count reached`);
        return "ok";
      }

      const incomingLinks = incomingById.get(stepId) ?? [];
      const storagePaths = resolveStepStoragePaths(step, pipeline.id, runId, storageConfig);
      await ensureStepStorage(storagePaths);

      if (await stopIfAborted()) {
        return "stop";
      }

      const shouldCheckSkipArtifacts = Array.isArray(step.skipIfArtifacts) && step.skipIfArtifacts.length > 0;
      if (shouldCheckSkipArtifacts) {
        const policyBypassReason = resolveSkipIfArtifactsBypassReason(step, runInputs, orchestratorPrompt);
        const upstreamFreshArtifactSteps = incomingLinks
          .map((link) => stepById.get(link.sourceStepId))
          .filter((candidate): candidate is PipelineStep => Boolean(candidate))
          .filter((candidate) => stepsWithFreshArtifacts.has(candidate.id));
        const bypassSkipArtifacts = policyBypassReason !== null || upstreamFreshArtifactSteps.length > 0;
        if (bypassSkipArtifacts) {
          const bypassReasonMessage =
            policyBypassReason === "run_input_cache_bypass"
              ? "run-level cache bypass input is active"
              : policyBypassReason === "step_cache_bypass_input_key"
                ? "step-specific cache bypass input key is active"
              : policyBypassReason === "step_prompt_always_run"
                ? "step prompt explicitly requires always-run behavior"
                : policyBypassReason === "step_orchestrator_prompt_pattern"
                  ? "orchestrator prompt matched step cache-bypass pattern"
                  : upstreamFreshArtifactSteps.length > 0
                    ? `upstream steps produced fresh artifacts in this run (${upstreamFreshArtifactSteps
                        .map((candidate) => normalizeStepLabel(candidate.name, candidate.id))
                        .join(", ")})`
                    : "cache bypass policy is active";
          appendRunLog(
            store,
            runId,
            `Skip-if disabled for ${stepLabel}: ${bypassReasonMessage}`
          );
        }

        const skipStates = bypassSkipArtifacts ? [] : await checkArtifactsState(step.skipIfArtifacts, storagePaths, runInputs);
        const skipArtifactsExist = skipStates.length > 0 && skipStates.every((check) => check.exists);
        let skipQualityOk = true;
        if (!bypassSkipArtifacts && skipArtifactsExist) {
          const skipValidation = await validateStepSkipArtifactsQuality(step, skipStates);
          skipQualityOk = skipValidation.ok;
          if (!skipQualityOk) {
            appendRunLog(
              store,
              runId,
              `Skip-if blocked for ${stepLabel}: ${skipValidation.reason ?? "skip artifact quality validation failed"}`
            );
          }
        }

        const shouldSkip = !bypassSkipArtifacts && skipArtifactsExist && skipQualityOk;

        if (shouldSkip) {
          const outputLines = [
            "STEP_STATUS: SKIPPED",
            "SKIP_REASON: required artifacts already exist",
            ...skipStates.map((check) => `${check.template} => ${check.foundPath ?? "missing"}`)
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
            timeline,
            triggeredByStepId: queuedByStepId,
            triggeredByReason: queuedByReason
          });

          for (const link of routedLinks) {
            enqueue(link.targetStepId, `${stepLabel} skipped (artifacts already exist)`, step.id, "skip_if_artifacts");
          }

          appendRunLog(store, runId, `Skipped ${stepLabel}: all skip-if artifacts already exist`);
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
      markStepRunning(store, runId, step, context, attempt, queuedByStepId, queuedByReason);

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
        log: (message) => appendRunLog(store, runId, `${stepLabel} [attempt ${attempt}] ${message}`),
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
          timeline,
          triggeredByStepId: queuedByStepId,
          triggeredByReason: queuedByReason
        });
        const writesArtifacts = step.requiredOutputFiles.length > 0 || step.skipIfArtifacts.length > 0;
        if (writesArtifacts) {
          stepsWithFreshArtifacts.add(step.id);
        }
        totalExecutions += 1;
        await persistRunStateSnapshot(store, runId, runRootPath);

        const remediation = runRemediationLoop({
          store,
          runId,
          stepId: step.id,
          stepName: stepLabel,
          stepExecution: executionResult.stepExecution,
          enqueue
        });
        if (remediation.stoppedForInput || remediation.stoppedForFailure) {
          await persistRunStateSnapshot(store, runId, runRootPath);
          return "stop";
        }
        return "ok";
      }

      if (executionResult.status === "cancelled") {
        if (abortSignal?.aborted) {
          return stopForAbort(step, attempt);
        } else {
          markStepFailed(store, runId, step, "Cancelled", attempt);
        }
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stop";
      }

      const failureMessage = executionResult.message;
      if (executionResult.status === "aborted" || executionResult.status === "failed") {
        if (abortSignal?.aborted) {
          return stopForAbort(step, attempt);
        } else {
          markStepFailed(store, runId, step, failureMessage, attempt);
        }
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stop";
      }
    } catch (error) {
      if (abortSignal?.aborted) {
        if (step) {
          return stopForAbort(step, attempt);
        }
        if (!isRunPaused()) {
          markRunCancelled(store, runId, "Stopped by user");
        }
        await persistRunStateSnapshot(store, runId, runRootPath);
        return "stop";
      }

      const message = error instanceof Error ? error.message : "Unknown step execution error";
      if (step) {
        markStepFailed(store, runId, step, message, attempt);
      } else {
        appendRunLog(store, runId, `Failed ${stepId}: ${message}`);
      }
      await persistRunStateSnapshot(store, runId, runRootPath);
      return "stop";
    } finally {
      markStepExecutionSettled(retryState, stepId);
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

      const queuedStep = dequeueStepForExecution();
      if (!queuedStep) {
        break;
      }

      const outcome = await executeQueuedStep(queuedStep);
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
        const queuedStep = dequeueStepForExecution(activeWorkers.size === 0);
        if (!queuedStep) {
          break;
        }

        const stepName = normalizeStepLabel(stepById.get(queuedStep.stepId)?.name, queuedStep.stepId);
        const slot = acquireSlot();
        const token = ++workerToken;
        appendRunLog(store, runId, `Subagent-${slot} started: ${stepName}`);
        const worker = executeQueuedStep(queuedStep)
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
