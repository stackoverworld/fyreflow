import type { WorkflowOutcome } from "../../types.js";

const STATUS_WITH_MARKUP_PATTERN =
  /(WORKFLOW_STATUS|HTML_REVIEW_STATUS|PDF_REVIEW_STATUS)\s*:\s*[*_`~\s]*?(PASS|FAIL|NEUTRAL|COMPLETE|NEEDS[_\s-]?INPUT)[*_`~\s]*/gi;
const WORKFLOW_STATUS_PATTERN = /WORKFLOW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL|COMPLETE|NEEDS[_\s-]?INPUT)/i;
const HTML_REVIEW_STATUS_PATTERN = /HTML_REVIEW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL|COMPLETE|NEEDS[_\s-]?INPUT)/i;
const PDF_REVIEW_STATUS_PATTERN = /PDF_REVIEW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL|COMPLETE|NEEDS[_\s-]?INPUT)/i;

export type GateResultStatus = "PASS" | "FAIL" | "NEUTRAL" | "COMPLETE" | "NEEDS_INPUT";
export type GateNextAction = "continue" | "retry_step" | "retry_stage" | "escalate" | "stop";

export interface GateResultReason {
  code: string;
  message: string;
  severity?: "critical" | "high" | "medium" | "low";
}

export interface GateResultContract {
  workflowStatus: GateResultStatus;
  nextAction: GateNextAction;
  reasons: GateResultReason[];
  summary?: string;
  stage?: string;
  stepRole?: string;
  gateTarget?: string;
}

function normalizeGateStatus(value: unknown): GateResultStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "PASS" ||
    normalized === "FAIL" ||
    normalized === "NEUTRAL" ||
    normalized === "COMPLETE" ||
    normalized === "NEEDS_INPUT"
  ) {
    return normalized;
  }
  return null;
}

function normalizeGateNextAction(value: unknown): GateNextAction | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "continue" ||
    normalized === "retry_step" ||
    normalized === "retry_stage" ||
    normalized === "escalate" ||
    normalized === "stop"
  ) {
    return normalized;
  }
  return null;
}

function extractStructuredReasons(value: unknown): GateResultReason[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const reasons: GateResultReason[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }

    const raw = entry as Record<string, unknown>;
    const code = typeof raw.code === "string" ? raw.code.trim() : "";
    const message = typeof raw.message === "string" ? raw.message.trim() : "";
    if (code.length === 0 || message.length === 0) {
      return null;
    }

    const severity =
      raw.severity === "critical" || raw.severity === "high" || raw.severity === "medium" || raw.severity === "low"
        ? raw.severity
        : undefined;
    reasons.push({ code, message, severity });
  }

  return reasons;
}

function extractFieldCaseInsensitive(payload: Record<string, unknown>, key: string): unknown {
  if (key in payload) {
    return payload[key];
  }

  const normalized = key.toLowerCase();
  for (const [entryKey, value] of Object.entries(payload)) {
    if (entryKey.toLowerCase() === normalized) {
      return value;
    }
  }

  return undefined;
}

function readStatusFromPayload(payload: Record<string, unknown>): GateResultStatus | null {
  const direct =
    normalizeGateStatus(extractFieldCaseInsensitive(payload, "workflow_status")) ??
    normalizeGateStatus(extractFieldCaseInsensitive(payload, "workflowStatus"));
  if (direct) {
    return direct;
  }

  return normalizeGateStatus(extractFieldCaseInsensitive(payload, "status"));
}

export function normalizeStatusMarkers(output: string): string {
  if (output.length === 0) {
    return output;
  }

  return output.replace(STATUS_WITH_MARKUP_PATTERN, (_full, label: string, statusRaw: string) => {
    const normalizedStatus = statusRaw.toUpperCase().replace(/[\s-]+/g, "_");
    return `${label}: ${normalizedStatus}`;
  });
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function normalizeStepStatus(value: unknown): "pass" | "fail" | "neutral" | "needs_input" | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "pass" || normalized === "fail" || normalized === "neutral" || normalized === "needs_input") {
    return normalized;
  }

  return null;
}

function statusFromMarkerPattern(pattern: RegExp, output: string): GateResultStatus | null {
  const match = output.match(pattern)?.[1];
  if (!match) {
    return null;
  }
  return normalizeGateStatus(match);
}

export function extractStatusSignals(
  output: string,
  parsedJson?: Record<string, unknown> | null
): {
  workflowStatus: GateResultStatus | null;
  htmlReviewStatus: GateResultStatus | null;
  pdfReviewStatus: GateResultStatus | null;
} {
  const normalizedOutput = normalizeStatusMarkers(output);
  const payload = parsedJson ?? parseJsonOutput(output);
  const workflowFromJson = payload ? readStatusFromPayload(payload) : null;
  const htmlFromJson = payload
    ? normalizeGateStatus(
        extractFieldCaseInsensitive(payload, "html_review_status") ?? extractFieldCaseInsensitive(payload, "htmlReviewStatus")
      )
    : null;
  const pdfFromJson = payload
    ? normalizeGateStatus(
        extractFieldCaseInsensitive(payload, "pdf_review_status") ?? extractFieldCaseInsensitive(payload, "pdfReviewStatus")
      )
    : null;

  return {
    workflowStatus: workflowFromJson ?? statusFromMarkerPattern(WORKFLOW_STATUS_PATTERN, normalizedOutput),
    htmlReviewStatus: htmlFromJson ?? statusFromMarkerPattern(HTML_REVIEW_STATUS_PATTERN, normalizedOutput),
    pdfReviewStatus: pdfFromJson ?? statusFromMarkerPattern(PDF_REVIEW_STATUS_PATTERN, normalizedOutput)
  };
}

export function buildStatusSignalOutput(
  output: string,
  parsedJson?: Record<string, unknown> | null
): string {
  const signals = extractStatusSignals(output, parsedJson);
  const lines: string[] = [];
  if (signals.workflowStatus) {
    lines.push(`WORKFLOW_STATUS: ${signals.workflowStatus}`);
  }
  if (signals.htmlReviewStatus) {
    lines.push(`HTML_REVIEW_STATUS: ${signals.htmlReviewStatus}`);
  }
  if (signals.pdfReviewStatus) {
    lines.push(`PDF_REVIEW_STATUS: ${signals.pdfReviewStatus}`);
  }
  return lines.join("\n");
}

export function parseGateResultContract(
  output: string,
  parsedJson?: Record<string, unknown> | null
): { contract: GateResultContract | null; source: "json" | "legacy_text" | "none" } {
  const payload = parsedJson ?? parseJsonOutput(output);
  if (payload) {
    const workflowStatus = readStatusFromPayload(payload);
    const nextAction = normalizeGateNextAction(
      extractFieldCaseInsensitive(payload, "next_action") ?? extractFieldCaseInsensitive(payload, "nextAction")
    );
    const reasons = extractStructuredReasons(extractFieldCaseInsensitive(payload, "reasons"));
    const summaryRaw = extractFieldCaseInsensitive(payload, "summary");
    const summary = typeof summaryRaw === "string" && summaryRaw.trim().length > 0 ? summaryRaw.trim() : undefined;
    const stageRaw = extractFieldCaseInsensitive(payload, "stage");
    const stage = typeof stageRaw === "string" && stageRaw.trim().length > 0 ? stageRaw.trim() : undefined;
    const stepRoleRaw =
      extractFieldCaseInsensitive(payload, "step_role") ?? extractFieldCaseInsensitive(payload, "stepRole");
    const stepRole =
      typeof stepRoleRaw === "string" && stepRoleRaw.trim().length > 0 ? stepRoleRaw.trim() : undefined;
    const gateTargetRaw =
      extractFieldCaseInsensitive(payload, "gate_target") ?? extractFieldCaseInsensitive(payload, "gateTarget");
    const gateTarget =
      typeof gateTargetRaw === "string" && gateTargetRaw.trim().length > 0 ? gateTargetRaw.trim() : undefined;

    if (workflowStatus && nextAction && reasons) {
      return {
        contract: {
          workflowStatus,
          nextAction,
          reasons,
          summary,
          stage,
          stepRole,
          gateTarget
        },
        source: "json"
      };
    }
  }

  const markers = extractStatusSignals(output, payload);
  if (markers.workflowStatus) {
    return {
      contract: {
        workflowStatus: markers.workflowStatus,
        nextAction: markers.workflowStatus === "FAIL" ? "retry_step" : "continue",
        reasons: [
          {
            code: "legacy_text_status",
            message: "Legacy text status markers were parsed; emit strict GateResult JSON for deterministic behavior."
          }
        ]
      },
      source: "legacy_text"
    };
  }

  return { contract: null, source: "none" };
}

export function parseJsonOutput(output: string): Record<string, unknown> | null {
  const candidates = new Set<string>();
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fenced = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of fenced) {
    const content = block[1]?.trim();
    if (content) {
      candidates.add(content);
    }
  }

  const firstObject = extractFirstJsonObject(output);
  if (firstObject) {
    candidates.add(firstObject);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      //
    }
  }

  return null;
}

export function extractInputRequestSignal(
  output: string,
  parsedJson?: Record<string, unknown> | null
): { needsInput: boolean; summary?: string } {
  const signals = extractStatusSignals(output, parsedJson);
  const explicitStatus = normalizeStepStatus(signals.workflowStatus);
  if (explicitStatus === "needs_input") {
    return { needsInput: true };
  }

  const payload = parsedJson ?? parseJsonOutput(output);
  if (payload) {
    const status = normalizeStepStatus(payload.status);
    const summary =
      typeof payload.summary === "string" && payload.summary.trim().length > 0 ? payload.summary.trim() : undefined;
    const requestsRaw = payload.input_requests ?? payload.requests;
    const hasInputRequests =
      Array.isArray(requestsRaw) &&
      requestsRaw.some((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry));

    if (status === "needs_input" || hasInputRequests) {
      return { needsInput: true, summary };
    }
  }

  return { needsInput: false };
}

export function inferWorkflowOutcome(output: string): WorkflowOutcome {
  const signals = extractStatusSignals(output);
  const explicit =
    signals.workflowStatus === "PASS" || signals.workflowStatus === "FAIL" || signals.workflowStatus === "NEUTRAL"
      ? signals.workflowStatus.toLowerCase()
      : signals.workflowStatus;
  if (explicit === "pass" || explicit === "fail" || explicit === "neutral") {
    return explicit;
  }
  if (explicit === "COMPLETE") {
    return "pass";
  }

  const jsonBlocks = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of jsonBlocks) {
    const payload = block[1]?.trim();
    if (!payload) {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as { status?: unknown };
      if (typeof parsed.status === "string") {
        const status = parsed.status.toLowerCase();
        if (status === "pass" || status === "fail" || status === "neutral") {
          return status;
        }
        if (status === "complete") {
          return "pass";
        }
      }
    } catch {
      //
    }
  }

  const failPattern = /\b(fail|failed|rejected|needs?\s+remediation|issues?\s+found|does not pass)\b/i;
  if (failPattern.test(output)) {
    return "fail";
  }

  const passPattern = /\b(pass|passed|approved|looks good|ready to ship|no blocking issues)\b/i;
  if (passPattern.test(output)) {
    return "pass";
  }

  return "neutral";
}

export function resolvePathValue(payload: unknown, rawPath: string): { found: boolean; value: unknown } {
  if (!rawPath || rawPath.trim().length === 0) {
    return { found: false, value: undefined };
  }

  const normalizedPath = rawPath.trim().replace(/^\$?\./, "");
  if (normalizedPath.length === 0) {
    return { found: true, value: payload };
  }

  const segments = normalizedPath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let current: unknown = payload;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return { found: false, value: undefined };
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }

    if (!(segment in current)) {
      return { found: false, value: undefined };
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return { found: true, value: current };
}
