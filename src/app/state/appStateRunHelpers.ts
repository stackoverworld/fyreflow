import { isActiveRunStatus } from "@/lib/pipelineDraft";
import { hasRunInputValue } from "@/lib/smartRunInputs";
import type { DashboardState, RunInputRequest } from "@/lib/types";

const SENSITIVE_RUN_INPUT_KEY_PATTERN = /(token|secret|password|api[_-]?key|oauth)/i;

export interface RunTransitionPipelineState {
  startingRunPipelineId: string | null;
  stoppingRunPipelineId: string | null;
  pausingRunPipelineId: string | null;
  resumingRunPipelineId: string | null;
}

export function hasPipelineRunActivity(
  pipelineId: string,
  runs: DashboardState["runs"],
  transitionState: RunTransitionPipelineState
): boolean {
  return (
    runs.some((run) => run.pipelineId === pipelineId && isActiveRunStatus(run.status)) ||
    transitionState.startingRunPipelineId === pipelineId ||
    transitionState.stoppingRunPipelineId === pipelineId ||
    transitionState.pausingRunPipelineId === pipelineId ||
    transitionState.resumingRunPipelineId === pipelineId
  );
}

export function hasActiveRunForPipeline(pipelineId: string, runs: DashboardState["runs"]): boolean {
  return runs.some((run) => run.pipelineId === pipelineId && isActiveRunStatus(run.status));
}

export function sanitizeRunPanelInputs(inputs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(inputs).filter(([key, value]) => {
      if (value.trim() === "[secure]") {
        return false;
      }

      return !SENSITIVE_RUN_INPUT_KEY_PATTERN.test(key);
    })
  );
}

export function collectSecretInputsToSave(
  requests: RunInputRequest[],
  inputs: Record<string, string>
): Record<string, string> {
  const secureInputsToSave: Record<string, string> = {};
  for (const request of requests) {
    if (request.type !== "secret") {
      continue;
    }

    const value = inputs[request.key];
    if (typeof value !== "string" || value.trim().length === 0 || value.trim() === "[secure]") {
      continue;
    }

    secureInputsToSave[request.key] = value;
  }

  return secureInputsToSave;
}

export function resolveRunActionTarget(
  runId: string | undefined,
  activePipelineRun: DashboardState["runs"][number] | null,
  runs: DashboardState["runs"],
  selectedPipelineId: string | null
): { targetRunId: string | null; targetPipelineId: string | null } {
  const targetRunId = runId ?? activePipelineRun?.id ?? null;
  if (!targetRunId) {
    return { targetRunId: null, targetPipelineId: null };
  }

  const targetRun = runs.find((entry) => entry.id === targetRunId);
  const targetPipelineId = targetRun?.pipelineId ?? activePipelineRun?.pipelineId ?? selectedPipelineId ?? null;
  return { targetRunId, targetPipelineId };
}

export function selectRuntimeInputPromptCandidateRuns(runs: DashboardState["runs"]): DashboardState["runs"] {
  return runs
    .filter(
      (run) =>
        run.status === "running" ||
        run.status === "queued" ||
        run.status === "paused" ||
        run.status === "awaiting_approval"
    )
    .slice(0, 20);
}

export function buildRuntimeInputPromptSignature(
  runId: string,
  stepId: string,
  attempts: number,
  requests: RunInputRequest[]
): string {
  return `${runId}:${stepId}:${Math.max(1, attempts)}:${requests.map((entry) => entry.key).join(",")}`;
}

export function trimRuntimeInputPromptSeenCache(seen: Set<string>, cacheLimit: number): void {
  while (seen.size > cacheLimit) {
    const oldest = seen.values().next().value;
    if (!oldest) {
      break;
    }

    seen.delete(oldest);
  }
}

export function seedRunInputsWithDefaults(
  runInputs: Record<string, string>,
  requests: RunInputRequest[]
): Record<string, string> {
  const seededInputs: Record<string, string> = { ...runInputs };
  for (const request of requests) {
    if (!hasRunInputValue(seededInputs, request.key) && request.defaultValue) {
      seededInputs[request.key] = request.defaultValue;
    }
  }

  return seededInputs;
}
