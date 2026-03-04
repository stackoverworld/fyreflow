import {
  areRunInputKeysEquivalent,
  extractInputKeysFromText,
  getRunInputValue,
  normalizeRunInputKey,
  normalizeRunInputs,
  pickPreferredRunInputKey,
  type RunInputs
} from "./runInputs.js";
import { buildSmartRunPlan } from "./smartRun.js";
import type {
  DashboardState,
  Pipeline,
  RunInputRequest,
  RunStartupBlocker,
  RunStartupCheck,
  SmartRunField,
  SmartRunPlan
} from "./types.js";
import {
  dedupeBlockers,
  hasInputValue,
  mergeRequests,
  missingFieldRequest,
  runModelStartupCheck
} from "./startupCheck/checks.js";
import { summarizeStatus } from "./startupCheck/reporting.js";
import type { BuildStartupCheckInput } from "./startupCheck/types.js";

const RECOVERABLE_INPUT_CHECK_PREFIX = "input:url_";
const INPUT_KEY_HINT_REGEX = /(url|uri|link|endpoint|repo|repository|host|domain|path|file|dir|folder|project|base)/i;
const URL_LIKE_KEY_HINT_REGEX = /(url|uri|link|endpoint|repo|repository|host|domain|base)/i;
const PATH_LIKE_KEY_HINT_REGEX = /(path|file|dir|folder|workspace)/i;

function toLabel(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk.slice(0, 1).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function inferRequestType(key: string): RunInputRequest["type"] {
  const normalized = key.toLowerCase();
  if (/(token|secret|password|api[_-]?key|credential|oauth|pat)/.test(normalized)) {
    return "secret";
  }
  if (/(url|uri|link|endpoint|host|domain)/.test(normalized)) {
    return "url";
  }
  if (/(path|file|dir|folder|workspace)/.test(normalized)) {
    return "path";
  }
  return "text";
}

function parseStepIdFromRecoverableCheckId(checkId: string): string | null {
  const parts = checkId.split(":");
  if (parts.length < 3) {
    return null;
  }
  const stepId = parts[2]?.trim();
  return stepId && stepId.length > 0 ? stepId : null;
}

function parseRecoverableIssueFromCheckId(checkId: string): "nested_url" | "double_slash_path" | "unknown" {
  if (checkId.startsWith("input:url_nested_scheme:")) {
    return "nested_url";
  }
  if (checkId.startsWith("input:url_double_slash_path:")) {
    return "double_slash_path";
  }
  return "unknown";
}

function isUrlLikeKey(key: string): boolean {
  return URL_LIKE_KEY_HINT_REGEX.test(key);
}

function isPathLikeKey(key: string): boolean {
  return PATH_LIKE_KEY_HINT_REGEX.test(key);
}

function buildRecoveryGuidance(
  issueKind: "nested_url" | "double_slash_path" | "unknown",
  key: string,
  currentValue: string | undefined,
  fallbackPlaceholder?: string
): { reasonSuffix: string; placeholder?: string; typeOverride?: RunInputRequest["type"] } {
  const value = currentValue?.trim() ?? "";

  if (issueKind === "nested_url" && /repo|repository/i.test(key)) {
    const hasScheme = /https?:\/\/|ssh:\/\/|git@/i.test(value);
    return {
      reasonSuffix:
        "Expected owner/repo format without protocol (example: Lunarbase-Lab/Prop-AMM-RnD).",
      placeholder: hasScheme ? "owner/repo (example: org/project)" : fallbackPlaceholder ?? "owner/repo",
      typeOverride: "text"
    };
  }

  if (issueKind === "nested_url" && isUrlLikeKey(key)) {
    return {
      reasonSuffix: "Expected a URL path segment without embedded protocol (no nested https://...).",
      placeholder: fallbackPlaceholder
    };
  }

  if (issueKind === "double_slash_path" && isPathLikeKey(key)) {
    const hasLeadingSlash = /^\/+/.test(value);
    return {
      reasonSuffix: 'Expected relative path without leading "/" (example: docs/WHITEPAPER.md).',
      placeholder: hasLeadingSlash ? "relative/path (no leading /)" : fallbackPlaceholder
    };
  }

  return {
    reasonSuffix: "Update this value and retry.",
    placeholder: fallbackPlaceholder
  };
}

function buildRecoveryRequestFromField(
  field: SmartRunField,
  runInputs: RunInputs,
  reason: string,
  issueKind: "nested_url" | "double_slash_path" | "unknown"
): RunInputRequest {
  const currentValue = getRunInputValue(runInputs, field.key)?.trim();
  const guidance = buildRecoveryGuidance(issueKind, field.key, currentValue, field.placeholder || undefined);
  return {
    key: field.key,
    label: field.label,
    type: guidance.typeOverride ?? field.type,
    required: true,
    reason: `${reason} ${guidance.reasonSuffix}`.trim(),
    placeholder: guidance.placeholder,
    allowCustom: field.type === "multiline",
    defaultValue:
      field.type === "secret" || !currentValue || currentValue.length === 0
        ? undefined
        : currentValue.length > 500
          ? currentValue.slice(0, 500)
          : currentValue
  };
}

function buildRecoveryRequestFromKey(
  keyRaw: string,
  runInputs: RunInputs,
  reason: string,
  issueKind: "nested_url" | "double_slash_path" | "unknown"
): RunInputRequest | null {
  const key = normalizeRunInputKey(keyRaw);
  if (key.length === 0) {
    return null;
  }

  const type = inferRequestType(key);
  const currentValue = getRunInputValue(runInputs, key)?.trim();
  const defaultPlaceholder =
    type === "secret"
      ? "Enter updated value"
      : type === "path"
        ? "/path/to/value"
        : type === "url"
          ? "https://example.com/value"
          : undefined;
  const guidance = buildRecoveryGuidance(issueKind, key, currentValue, defaultPlaceholder);

  return {
    key,
    label: toLabel(key),
    type: guidance.typeOverride ?? type,
    required: true,
    reason: `${reason} ${guidance.reasonSuffix}`.trim(),
    placeholder: guidance.placeholder,
    defaultValue:
      type === "secret" || !currentValue || currentValue.length === 0
        ? undefined
        : currentValue.length > 500
          ? currentValue.slice(0, 500)
          : currentValue
  };
}

function mergeStartupRequests(base: RunInputRequest[], extra: RunInputRequest[]): RunInputRequest[] {
  const merged = [...base];

  for (const request of extra) {
    const normalizedKey = normalizeRunInputKey(request.key);
    if (normalizedKey.length === 0) {
      continue;
    }

    const existingIndex = merged.findIndex((entry) => areRunInputKeysEquivalent(entry.key, normalizedKey));
    if (existingIndex < 0) {
      merged.push({ ...request, key: normalizedKey });
      continue;
    }

    const existing = merged[existingIndex];
    if (!existing) {
      continue;
    }
    const preferredKey = pickPreferredRunInputKey(existing.key, normalizedKey);
    merged[existingIndex] = {
      ...existing,
      key: preferredKey,
      label: existing.label || request.label,
      type: existing.type === "text" && request.type !== "text" ? request.type : existing.type,
      required: existing.required || request.required,
      reason: request.reason || existing.reason,
      placeholder: existing.placeholder ?? request.placeholder,
      options: existing.options ?? request.options,
      allowCustom: request.allowCustom ?? existing.allowCustom,
      defaultValue: existing.defaultValue ?? request.defaultValue
    };
  }

  return merged.sort((left, right) => left.key.localeCompare(right.key));
}

export function buildRecoverableInputRequestsFromSmartPlan(
  pipeline: Pipeline,
  smartPlan: SmartRunPlan,
  runInputs: RunInputs
): RunInputRequest[] {
  const requests: RunInputRequest[] = [];

  for (const check of smartPlan.checks) {
    if (check.status !== "fail" || !check.id.startsWith(RECOVERABLE_INPUT_CHECK_PREFIX)) {
      continue;
    }

    const stepId = parseStepIdFromRecoverableCheckId(check.id);
    const issueKind = parseRecoverableIssueFromCheckId(check.id);
    const step = stepId ? pipeline.steps.find((entry) => entry.id === stepId) : undefined;
    const reason = check.message;

    const candidateFields = step
      ? smartPlan.fields.filter((field) => field.sources.some((source) => source.startsWith(`${step.name}.`)))
      : [];
    const hintedFields = candidateFields.filter((field) => INPUT_KEY_HINT_REGEX.test(field.key));

    let selectedFields = hintedFields.length > 0 ? hintedFields : candidateFields;
    if (issueKind === "nested_url") {
      const urlLikeFields = selectedFields.filter((field) => isUrlLikeKey(field.key));
      if (urlLikeFields.length > 0) {
        const urlLikeWithScheme = urlLikeFields.filter((field) =>
          /https?:\/\/|ssh:\/\/|git@/i.test(getRunInputValue(runInputs, field.key) ?? "")
        );
        selectedFields = (urlLikeWithScheme.length > 0 ? urlLikeWithScheme : urlLikeFields).slice(0, 3);
      } else {
        selectedFields = selectedFields.slice(0, 3);
      }
    } else if (issueKind === "double_slash_path") {
      const pathLikeFields = selectedFields.filter((field) => isPathLikeKey(field.key));
      if (pathLikeFields.length > 0) {
        const pathLikeWithLeadingSlash = pathLikeFields.filter((field) =>
          /^\/+/.test(getRunInputValue(runInputs, field.key) ?? "")
        );
        selectedFields = (pathLikeWithLeadingSlash.length > 0 ? pathLikeWithLeadingSlash : pathLikeFields).slice(0, 3);
      } else {
        selectedFields = selectedFields.slice(0, 3);
      }
    } else {
      selectedFields = selectedFields.slice(0, 4);
    }

    if (selectedFields.length > 0) {
      for (const field of selectedFields) {
        requests.push(buildRecoveryRequestFromField(field, runInputs, reason, issueKind));
      }
      continue;
    }

    if (step) {
      const fallbackKeys = extractInputKeysFromText(`${step.prompt}\n${step.contextTemplate}`);
      let selectedKeys = fallbackKeys;
      if (issueKind === "nested_url") {
        const urlLikeKeys = selectedKeys.filter((key) => isUrlLikeKey(key));
        if (urlLikeKeys.length > 0) {
          const urlLikeWithScheme = urlLikeKeys.filter((key) =>
            /https?:\/\/|ssh:\/\/|git@/i.test(getRunInputValue(runInputs, key) ?? "")
          );
          selectedKeys = urlLikeWithScheme.length > 0 ? urlLikeWithScheme : urlLikeKeys;
        }
      } else if (issueKind === "double_slash_path") {
        const pathLikeKeys = selectedKeys.filter((key) => isPathLikeKey(key));
        if (pathLikeKeys.length > 0) {
          const pathLikeWithLeadingSlash = pathLikeKeys.filter((key) =>
            /^\/+/.test(getRunInputValue(runInputs, key) ?? "")
          );
          selectedKeys = pathLikeWithLeadingSlash.length > 0 ? pathLikeWithLeadingSlash : pathLikeKeys;
        }
      }

      for (const key of selectedKeys.slice(0, 4)) {
        const request = buildRecoveryRequestFromKey(key, runInputs, reason, issueKind);
        if (request) {
          requests.push(request);
        }
      }
    }
  }

  return mergeStartupRequests([], requests);
}

export async function buildRunStartupCheck(
  pipeline: Pipeline,
  state: DashboardState,
  input: BuildStartupCheckInput = {}
): Promise<RunStartupCheck> {
  const runInputs = normalizeRunInputs(input.inputs);
  const task = typeof input.task === "string" ? input.task.trim() : "";
  const smartPlan = await buildSmartRunPlan(pipeline, state, runInputs);

  const deterministicRequests = smartPlan.fields
    .filter((field) => field.required && !hasInputValue(runInputs, field.key))
    .map((field) => missingFieldRequest(field));
  const deterministicRecoveryRequests = buildRecoverableInputRequestsFromSmartPlan(
    pipeline,
    smartPlan,
    runInputs
  );

  const deterministicBlockers: RunStartupBlocker[] = smartPlan.checks
    .filter((check) => check.status === "fail" && !check.id.startsWith("input:"))
    .map((check) => ({
      id: check.id,
      title: check.title,
      message: check.message,
      details: check.details
    }));

  let modelResult = null;
  const notes: string[] = [];

  try {
    modelResult = await runModelStartupCheck(
      pipeline,
      state,
      task,
      runInputs,
      [...deterministicRequests, ...deterministicRecoveryRequests],
      deterministicBlockers
    );
    if (!modelResult) {
      notes.push("AI startup-check unavailable. Used deterministic checks.");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "startup-check provider error";
    notes.push(`AI startup-check failed: ${reason}`);
  }

  const mergedRequests = mergeStartupRequests(
    mergeRequests(deterministicRequests, modelResult?.requests ?? [], runInputs),
    deterministicRecoveryRequests
  );
  const mergedBlockers = dedupeBlockers([...(deterministicBlockers ?? []), ...(modelResult?.blockers ?? [])]);

  let status: RunStartupCheck["status"] = "pass";
  if (mergedBlockers.length > 0 || modelResult?.status === "blocked") {
    status = "blocked";
  } else if (mergedRequests.length > 0 || modelResult?.status === "needs_input") {
    status = "needs_input";
  }

  const summary = summarizeStatus(status, mergedRequests, mergedBlockers, modelResult?.summary);

  let source: RunStartupCheck["source"] = "deterministic";
  if (modelResult) {
    source = deterministicRequests.length > 0 || deterministicBlockers.length > 0 ? "merged" : "model";
  }

  return {
    status,
    summary,
    requests: mergedRequests,
    blockers: mergedBlockers,
    source,
    notes: [...(modelResult?.notes ?? []), ...notes]
  };
}
