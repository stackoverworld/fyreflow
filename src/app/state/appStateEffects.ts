import { isActiveRunStatus } from "@/lib/pipelineDraft";
import type { PipelineRun, RunStatus } from "@/lib/types";
import type { RunCompletionModalContext, RunInputModalContext } from "./appStateTypes";

const RUN_COMPLETION_PREVIEW_LENGTH = 320;
const RUN_FAILURE_REASON_PREVIEW_LENGTH = 320;
const RUN_FAILURE_DETAIL_PREVIEW_LENGTH = 420;
const FAILURE_LOG_PATTERN = /(error|failed|timeout|timed out|unauthorized|forbidden|token[_ ]expired|aborted)/i;
const RUN_FAILED_PREFIX = /^Run failed:\s*/i;

export function hasTransitionedFromActive(previousStatus: RunStatus | undefined, nextStatus: RunStatus): boolean {
  if (!previousStatus) {
    return false;
  }

  return isActiveRunStatus(previousStatus) && previousStatus !== nextStatus;
}

export function extractCompletedRunSummary(task: string): string {
  return task.trim().length > 0 ? `Task: ${task}` : "Run completed successfully.";
}

function normalizePreview(value: string, maxLength: number): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function stripRunFailedPrefix(value: string): string {
  return value.replace(RUN_FAILED_PREFIX, "").trim();
}

function extractRunCompletionOutputPreview(output: string): string | undefined {
  return normalizePreview(output, RUN_COMPLETION_PREVIEW_LENGTH);
}

function extractRunFailureReason(run: PipelineRun, failedStep: PipelineRun["steps"][number] | undefined): string | undefined {
  const candidates: string[] = [];

  if (failedStep?.error && failedStep.error.trim().length > 0) {
    candidates.push(failedStep.error);
  }

  const runFailedLog = [...run.logs].reverse().find((entry) => RUN_FAILED_PREFIX.test(entry.trim()));
  if (runFailedLog) {
    candidates.push(stripRunFailedPrefix(runFailedLog));
  }

  const genericFailureLog = [...run.logs].reverse().find((entry) => FAILURE_LOG_PATTERN.test(entry));
  if (genericFailureLog) {
    candidates.push(genericFailureLog);
  }

  if (failedStep?.output && failedStep.output.trim().length > 0) {
    const outputLines = failedStep.output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const candidateLine = outputLines.find((line) => FAILURE_LOG_PATTERN.test(line)) ?? outputLines[0];
    if (candidateLine) {
      candidates.push(candidateLine);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizePreview(stripRunFailedPrefix(candidate), RUN_FAILURE_REASON_PREVIEW_LENGTH);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function extractRunFailureDetails(
  run: PipelineRun,
  failedStep: PipelineRun["steps"][number] | undefined,
  failureReason: string | undefined
): string[] | undefined {
  const candidates: string[] = [];

  if (failedStep?.error && failedStep.error.trim().length > 0) {
    candidates.push(failedStep.error);
  }

  if (failedStep?.output && failedStep.output.trim().length > 0) {
    const outputLines = failedStep.output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const outputSignal = outputLines.find((line) => FAILURE_LOG_PATTERN.test(line)) ?? outputLines[0];
    if (outputSignal) {
      candidates.push(outputSignal);
    }
  }

  const recentFailureLogs = [...run.logs]
    .reverse()
    .filter((entry) => FAILURE_LOG_PATTERN.test(entry))
    .slice(0, 6);
  candidates.push(...recentFailureLogs);

  const normalizedReason = normalizePreview(failureReason ?? "", RUN_FAILURE_DETAIL_PREVIEW_LENGTH)?.toLowerCase();
  const uniqueDetails: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = normalizePreview(stripRunFailedPrefix(candidate), RUN_FAILURE_DETAIL_PREVIEW_LENGTH);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (normalizedReason && key === normalizedReason) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueDetails.push(normalized);
    if (uniqueDetails.length >= 3) {
      break;
    }
  }

  return uniqueDetails.length > 0 ? uniqueDetails : undefined;
}

export function buildRunCompletionModalContext(run: PipelineRun): RunCompletionModalContext {
  const completedSteps = run.steps.filter((step) => step.status === "completed");
  const latestOutputStep = [...run.steps].reverse().find((step) => step.output.trim().length > 0);
  const status: RunCompletionModalContext["status"] = run.status === "failed" ? "failed" : "completed";

  if (status === "failed") {
    const failedStep = [...run.steps].reverse().find((step) => step.status === "failed");
    const outputStep = failedStep?.output.trim().length ? failedStep : latestOutputStep;
    const failureReason =
      extractRunFailureReason(run, failedStep) ?? "Run failed before the system returned a specific error message.";

    return {
      runId: run.id,
      pipelineId: run.pipelineId,
      pipelineName: run.pipelineName,
      status,
      task: run.task,
      completedSteps: completedSteps.length,
      totalSteps: run.steps.length,
      finishedAt: run.finishedAt,
      finalStepName: outputStep?.stepName,
      finalOutputPreview: outputStep ? extractRunCompletionOutputPreview(outputStep.output) : undefined,
      failureStepName: failedStep?.stepName,
      failureReason,
      failureDetails: extractRunFailureDetails(run, failedStep, failureReason)
    };
  }

  return {
    runId: run.id,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    status,
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
