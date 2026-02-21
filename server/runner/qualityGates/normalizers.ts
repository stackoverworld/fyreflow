import type { WorkflowOutcome } from "../../types.js";

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
  const explicit = output.match(/WORKFLOW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL|NEEDS[_\s-]?INPUT)/i)?.[1];
  const explicitStatus = normalizeStepStatus(explicit);
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
  const explicit = output.match(/WORKFLOW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL)/i)?.[1]?.toLowerCase();
  if (explicit === "pass" || explicit === "fail" || explicit === "neutral") {
    return explicit;
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
