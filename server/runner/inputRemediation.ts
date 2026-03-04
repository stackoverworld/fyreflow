import {
  extractInputKeysFromText,
  getRunInputValue,
  isSensitiveRunInputKey,
  normalizeRunInputKey,
  type RunInputs
} from "../runInputs.js";
import type { PipelineStep, RunInputRequest, RunInputRequestType } from "../types.js";

type RecoverableFailureKind = "auth" | "network" | "malformed";

const AUTH_FAILURE_REGEX =
  /\b(token[_-]?expired|expired token|invalid[_\s-]*(token|api[_\s-]?key|credential)|unauthorized|forbidden|auth(?:entication|orization)?\b|status[^0-9]*40[13]\b|http[^0-9]*40[13]\b|401\b|403\b)\b/i;
const NETWORK_FAILURE_REGEX =
  /\b(network|enotfound|eai_again|getaddrinfo|dns|timed?\s*out|timeout|connection\s+(?:refused|reset|failed)|host unreachable|sandbox)\b/i;
const MALFORMED_FAILURE_REGEX =
  /\b(invalid url|malformed|bad request|invalid request|cannot parse|nested url|wrong endpoint)\b|https?:\/\/\S*https?:\/\//i;
const INPUT_HINT_KEY_REGEX = /(url|uri|link|endpoint|repo|repository|host|domain|path|file|dir|project|base)/i;
const REPO_KEY_HINT_REGEX = /(repo|repository)/i;
const PATH_KEY_HINT_REGEX = /(path|file|dir|folder|workspace)/i;

function toLabel(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk.slice(0, 1).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function inferRequestType(key: string): RunInputRequestType {
  const normalized = key.toLowerCase();
  if (isSensitiveRunInputKey(key)) {
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

function classifyFailure(message: string): RecoverableFailureKind | null {
  if (AUTH_FAILURE_REGEX.test(message)) {
    return "auth";
  }
  if (MALFORMED_FAILURE_REGEX.test(message)) {
    return "malformed";
  }
  if (NETWORK_FAILURE_REGEX.test(message)) {
    return "network";
  }
  return null;
}

function collectStepInputKeys(step: PipelineStep): string[] {
  const keys = new Set<string>();
  const sources = [step.prompt, step.contextTemplate, ...step.requiredOutputFiles, ...step.skipIfArtifacts];
  for (const source of sources) {
    for (const key of extractInputKeysFromText(source)) {
      keys.add(normalizeRunInputKey(key));
    }
  }
  return [...keys];
}

function selectCandidateKeys(kind: RecoverableFailureKind, step: PipelineStep, runInputs: RunInputs): string[] {
  const referencedKeys = collectStepInputKeys(step);
  const sensitiveKeys = referencedKeys.filter((key) => isSensitiveRunInputKey(key));
  const regularKeys = referencedKeys.filter((key) => !isSensitiveRunInputKey(key));

  if (kind === "auth") {
    if (sensitiveKeys.length > 0) {
      return sensitiveKeys.slice(0, 3);
    }
    return Object.keys(runInputs)
      .map((key) => normalizeRunInputKey(key))
      .filter((key) => isSensitiveRunInputKey(key))
      .slice(0, 3);
  }

  const hintedRegularKeys = regularKeys.filter((key) => INPUT_HINT_KEY_REGEX.test(key));
  if (hintedRegularKeys.length > 0) {
    return hintedRegularKeys.slice(0, 3);
  }

  if (regularKeys.length > 0) {
    return regularKeys.slice(0, 3);
  }

  if (kind === "network" && sensitiveKeys.length > 0) {
    return sensitiveKeys.slice(0, 2);
  }

  return [];
}

function buildRequestReason(kind: RecoverableFailureKind, key: string): string {
  if (kind === "auth") {
    return `Credential for "${key}" appears invalid or expired. Provide an updated value to continue.`;
  }
  if (kind === "malformed") {
    return `Resolved endpoint appears malformed. Verify "${key}" and retry.`;
  }
  return `Connection failed with current runtime values. Verify "${key}" and retry.`;
}

function buildRequestGuidance(
  kind: RecoverableFailureKind,
  key: string,
  value: string | undefined,
  type: RunInputRequestType
): { reasonSuffix: string; placeholder?: string; typeOverride?: RunInputRequestType } {
  const current = value?.trim() ?? "";

  if (kind === "malformed" && REPO_KEY_HINT_REGEX.test(key)) {
    return {
      reasonSuffix: 'Expected owner/repo format without protocol (example: "org/project").',
      placeholder: "owner/repo (example: org/project)",
      typeOverride: "text"
    };
  }

  if (kind === "malformed" && PATH_KEY_HINT_REGEX.test(key) && /^\/+/.test(current)) {
    return {
      reasonSuffix: 'Expected relative path without leading "/" (example: docs/README.md).',
      placeholder: "relative/path (no leading /)"
    };
  }

  if (type === "url") {
    return {
      reasonSuffix: "Provide a full URL including protocol (https://...).",
      placeholder: "https://example.com/value"
    };
  }

  if (type === "path") {
    return {
      reasonSuffix: "Provide a relative path value.",
      placeholder: "/path/to/value"
    };
  }

  return {
    reasonSuffix: "Update this value and retry."
  };
}

function buildSummary(kind: RecoverableFailureKind, stepName: string): string {
  if (kind === "auth") {
    return `${stepName} needs refreshed credentials to continue.`;
  }
  if (kind === "malformed") {
    return `${stepName} detected malformed endpoint composition after input substitution.`;
  }
  return `${stepName} could not reach a required service with current runtime inputs.`;
}

export function buildRuntimeInputRequestOutputFromFailure(input: {
  step: PipelineStep;
  errorMessage: string;
  runInputs: RunInputs;
}): string | null {
  const kind = classifyFailure(input.errorMessage);
  if (!kind) {
    return null;
  }

  const candidateKeys = selectCandidateKeys(kind, input.step, input.runInputs);
  if (candidateKeys.length === 0) {
    return null;
  }

  const requests: RunInputRequest[] = candidateKeys.map((key) => {
    const type = inferRequestType(key);
    const value = getRunInputValue(input.runInputs, key)?.trim();
    const guidance = buildRequestGuidance(kind, key, value, type);
    return {
      key,
      label: toLabel(key),
      type: guidance.typeOverride ?? type,
      required: true,
      reason: `${buildRequestReason(kind, key)} ${guidance.reasonSuffix}`.trim(),
      placeholder:
        type === "secret"
          ? "Enter updated value"
          : guidance.placeholder,
      defaultValue:
        type === "secret" || !value || value.length === 0
          ? undefined
          : value.length > 500
            ? value.slice(0, 500)
            : value
    };
  });

  return JSON.stringify(
    {
      status: "needs_input",
      summary: buildSummary(kind, input.step.name),
      input_requests: requests,
      notes: [
        "This remediation was inferred from a recoverable runtime failure.",
        "Update requested inputs and restart the run."
      ]
    },
    null,
    2
  );
}
