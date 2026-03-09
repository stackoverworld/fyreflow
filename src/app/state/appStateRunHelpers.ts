import { isActiveRunStatus } from "@/lib/pipelineDraft";
import { hasRunInputValue, normalizeSmartRunInputs } from "@/lib/smartRunInputs";
import { areRunInputKeysEquivalent, getRunInputValue, normalizeRunInputKey } from "@/lib/runInputAliases";
import type { DashboardState, RunInputRequest, RunStartupBlocker } from "@/lib/types";

const SENSITIVE_RUN_INPUT_KEY_PATTERN = /(token|secret|password|api[_-]?key|oauth)/i;
const REPO_SLUG_REGEX = /^[^/\s]+(?:\/[^/\s]+)+$/;
const REPO_HINT_REGEX = /(owner\/repo|repo format|without protocol|nested url)/i;
const RELATIVE_PATH_HINT_REGEX = /(without leading ["/]?\/["/]?|no leading \/|relative path)/i;
const GITHUB_REPO_URL_REGEX = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i;
const SSH_REPO_REGEX = /^git@[^:]+:([^#?\s]+)$/i;

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

function normalizeRepoSlugValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (REPO_SLUG_REGEX.test(trimmed) && !/https?:\/\/|ssh:\/\/|git@/i.test(trimmed)) {
    return trimmed.replace(/\.git$/i, "");
  }

  const githubMatch = trimmed.match(GITHUB_REPO_URL_REGEX);
  if (githubMatch) {
    const owner = githubMatch[1] ?? "";
    const repo = (githubMatch[2] ?? "").replace(/\.git$/i, "");
    if (owner.length > 0 && repo.length > 0) {
      return `${owner}/${repo}`;
    }
  }

  const sshMatch = trimmed.match(SSH_REPO_REGEX);
  if (sshMatch?.[1]) {
    const normalized = sshMatch[1].replace(/^\/+/, "").replace(/\.git$/i, "");
    if (REPO_SLUG_REGEX.test(normalized)) {
      return normalized;
    }
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const segments = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter((segment) => segment.length > 0);
    if (segments.length < 2) {
      return null;
    }

    const stripGitSuffix = (input: string): string => input.replace(/\.git$/i, "");
    if (host.endsWith("github.com") || host.endsWith("bitbucket.org")) {
      const owner = segments[0] ?? "";
      const repo = stripGitSuffix(segments[1] ?? "");
      const normalized = `${owner}/${repo}`;
      return REPO_SLUG_REGEX.test(normalized) ? normalized : null;
    }

    if (host.endsWith("gitlab.com")) {
      const separatorIndex = segments.findIndex((segment) => segment === "-");
      const repoSegments = separatorIndex > 1 ? segments.slice(0, separatorIndex) : segments;
      if (repoSegments.length < 2) {
        return null;
      }
      const normalized = repoSegments
        .map((segment, index) => (index === repoSegments.length - 1 ? stripGitSuffix(segment) : segment))
        .join("/");
      return REPO_SLUG_REGEX.test(normalized) ? normalized : null;
    }

    const normalized = `${segments[0]}/${stripGitSuffix(segments[1] ?? "")}`;
    return REPO_SLUG_REGEX.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function resolveInputKeyForRequest(inputs: Record<string, string>, requestKey: string): string | null {
  if (Object.prototype.hasOwnProperty.call(inputs, requestKey)) {
    return requestKey;
  }

  const normalizedRequestKey = normalizeRunInputKey(requestKey);
  if (normalizedRequestKey.length === 0) {
    return null;
  }

  const exactNormalizedMatch = Object.keys(inputs).find(
    (candidate) => normalizeRunInputKey(candidate) === normalizedRequestKey
  );
  if (exactNormalizedMatch) {
    return exactNormalizedMatch;
  }

  return Object.keys(inputs).find((candidate) => areRunInputKeysEquivalent(candidate, normalizedRequestKey)) ?? null;
}

function normalizeRequestedInputValue(request: RunInputRequest, rawValue: string): string {
  const value = rawValue.trim();
  if (value.length === 0 || request.type === "secret") {
    return value;
  }

  const context = `${request.reason} ${request.placeholder ?? ""}`;
  const repoHint = REPO_HINT_REGEX.test(context);
  const relativePathHint = RELATIVE_PATH_HINT_REGEX.test(context);

  if (/repo|repository/i.test(request.key) && repoHint) {
    const normalized = normalizeRepoSlugValue(value);
    if (normalized) {
      return normalized;
    }
  }

  if (request.type === "path" && relativePathHint) {
    return value.replace(/^\/+/, "");
  }

  return value;
}

export function autoNormalizeInputsFromRequests(
  inputs: Record<string, string>,
  requests: RunInputRequest[]
): { inputs: Record<string, string>; changed: boolean } {
  if (requests.length === 0) {
    return { inputs, changed: false };
  }

  let changed = false;
  const nextInputs = { ...inputs };

  for (const request of requests) {
    const matchedKey = resolveInputKeyForRequest(nextInputs, request.key);
    if (!matchedKey) {
      continue;
    }

    const current = nextInputs[matchedKey];
    if (typeof current !== "string") {
      continue;
    }
    const normalized = normalizeRequestedInputValue(request, current);
    if (normalized === current) {
      continue;
    }

    nextInputs[matchedKey] = normalized;
    const normalizedRequestKey = normalizeRunInputKey(request.key);
    if (
      normalizedRequestKey.length > 0 &&
      normalizedRequestKey !== matchedKey &&
      !Object.prototype.hasOwnProperty.call(nextInputs, normalizedRequestKey)
    ) {
      nextInputs[normalizedRequestKey] = normalized;
    }
    changed = true;
  }

  return changed ? { inputs: nextInputs, changed } : { inputs, changed };
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

export function selectRuntimeInputPromptCandidateRuns(
  runs: DashboardState["runs"],
  selectedPipelineId: string | null
): DashboardState["runs"] {
  if (!selectedPipelineId) {
    return [];
  }

  return runs
    .filter(
      (run) =>
        run.pipelineId === selectedPipelineId &&
        (run.status === "running" ||
          run.status === "queued" ||
          run.status === "paused" ||
          run.status === "awaiting_approval" ||
          run.status === "failed")
    )
    .slice(0, 20);
}

export function buildRuntimeInputPromptSignature(
  runId: string,
  stepId: string,
  attempts: number,
  requests: RunInputRequest[],
  blockers: RunStartupBlocker[] = []
): string {
  return `${runId}:${stepId}:${Math.max(1, attempts)}:${requests
    .map((entry) => entry.key)
    .join(",")}:${blockers.map((entry) => entry.id).join(",")}`;
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

export function buildRuntimeInputModalInitialInputs(
  runInputs: Record<string, string>,
  requests: RunInputRequest[]
): Record<string, string> {
  const seededInputs = seedRunInputsWithDefaults(runInputs, requests);
  const normalized = normalizeSmartRunInputs(seededInputs);
  const modalInputs: Record<string, string> = { ...normalized };

  for (const request of requests) {
    const existingValue = getRunInputValue(seededInputs, request.key);
    if (typeof existingValue !== "string") {
      continue;
    }

    const trimmed = existingValue.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (request.type === "secret") {
      modalInputs[request.key] = trimmed === "[secure]" ? "[secure]" : existingValue;
      continue;
    }

    if (trimmed === "[secure]") {
      continue;
    }

    modalInputs[request.key] = existingValue;
  }

  return modalInputs;
}
