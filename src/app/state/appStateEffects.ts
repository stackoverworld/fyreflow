import { isActiveRunStatus } from "@/lib/pipelineDraft";
import type { PipelineRun, RunStatus } from "@/lib/types";
import type { RunCompletionModalContext, RunInputModalContext } from "./appStateTypes";

const RUN_COMPLETION_PREVIEW_LENGTH = 320;

export function hasTransitionedFromActive(previousStatus: RunStatus | undefined, nextStatus: RunStatus): boolean {
  if (!previousStatus) {
    return false;
  }

  return isActiveRunStatus(previousStatus) && previousStatus !== nextStatus;
}

export function extractCompletedRunSummary(task: string): string {
  return task.trim().length > 0 ? `Task: ${task}` : "Run completed successfully.";
}

function extractRunCompletionOutputPreview(output: string): string | undefined {
  const normalized = output.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length <= RUN_COMPLETION_PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, RUN_COMPLETION_PREVIEW_LENGTH - 1)}…`;
}

export function buildRunCompletionModalContext(run: PipelineRun): RunCompletionModalContext {
  const completedSteps = run.steps.filter((step) => step.status === "completed");
  const latestOutputStep = [...run.steps].reverse().find((step) => step.output.trim().length > 0);

  return {
    runId: run.id,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    task: run.task,
    completedSteps: completedSteps.length,
    totalSteps: run.steps.length,
    finishedAt: run.finishedAt,
    finalStepName: latestOutputStep?.stepName,
    finalOutputPreview: latestOutputStep ? extractRunCompletionOutputPreview(latestOutputStep.output) : undefined
  };
}

export function buildRunInputFallbackSummary(context: RunInputModalContext): string {
  return context.requests.length === 1
    ? `${context.requests[0]?.label ?? context.requests[0]?.key ?? "One input"} is required.`
    : `${context.requests.length} inputs are required.`;
}

export function buildRunInputModalSignature(context: RunInputModalContext): string {
  return `${context.source}:${context.pipelineId}:${context.runId ?? "none"}:${context.requests
    .map((request) => request.key)
    .join(",")}:${context.summary}`;
}
