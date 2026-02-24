const MODEL_SUMMARY_MAX_CHARS = 420;
const NON_ENGLISH_SCRIPT_PATTERN =
  /[\u0400-\u052F\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u;

const WORKFLOW_STATUS_PATTERN = /WORKFLOW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL|COMPLETE|NEEDS[_\s-]?INPUT)/i;
const HTML_REVIEW_STATUS_PATTERN = /HTML_REVIEW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL|COMPLETE|NEEDS[_\s-]?INPUT)/i;
const PDF_REVIEW_STATUS_PATTERN = /PDF_REVIEW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL|COMPLETE|NEEDS[_\s-]?INPUT)/i;
const NEXT_ACTION_PATTERN = /NEXT_ACTION\s*:\s*([a-z_ -]+)/i;

const SUMMARY_FIELDS = [
  "summary",
  "reasoning_summary",
  "thinking_summary",
  "analysis_summary",
  "final_summary",
  "status_summary",
  "reasoning",
  "thinking",
  "analysis",
  "plan",
  "explanation"
] as const;

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeStatusToken(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function readFieldCaseInsensitive(record: Record<string, unknown>, key: string): unknown {
  if (key in record) {
    return record[key];
  }

  const normalized = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (entryKey.toLowerCase() === normalized) {
      return entryValue;
    }
  }
  return undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failure
  }

  return null;
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
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
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

function parseFirstJsonRecordFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    const direct = parseJsonRecord(trimmed);
    if (direct) {
      return direct;
    }
  }

  const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const candidate = match[1]?.trim();
    if (!candidate) {
      continue;
    }
    const parsed = parseJsonRecord(candidate);
    if (parsed) {
      return parsed;
    }
  }

  const firstObject = extractFirstJsonObject(text);
  if (firstObject) {
    return parseJsonRecord(firstObject);
  }

  return null;
}

function buildStatusSummarySegments(input: {
  workflowStatus?: string;
  htmlReviewStatus?: string;
  pdfReviewStatus?: string;
  nextAction?: string;
}): string[] {
  const segments: string[] = [];
  if (input.workflowStatus) {
    segments.push(`workflow=${normalizeStatusToken(input.workflowStatus)}`);
  }
  if (input.htmlReviewStatus) {
    segments.push(`html=${normalizeStatusToken(input.htmlReviewStatus)}`);
  }
  if (input.pdfReviewStatus) {
    segments.push(`pdf=${normalizeStatusToken(input.pdfReviewStatus)}`);
  }
  if (input.nextAction) {
    segments.push(`next=${input.nextAction.trim().toLowerCase().replace(/[\s-]+/g, "_")}`);
  }
  return segments;
}

function extractEnglishSentenceCandidate(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return undefined;
  }

  const sentenceMatch = normalized.match(/^(.{18,420}?[.!?])(?:\s|$)/);
  const candidate = sentenceMatch?.[1] ?? normalized;
  const sanitized = sanitizeSummaryCandidate(candidate);
  if (!isEnglishSummaryCandidate(sanitized)) {
    return undefined;
  }
  return sanitized;
}

export function sanitizeSummaryCandidate(value: string, maxChars = MODEL_SUMMARY_MAX_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3)}...`;
}

export function isEnglishSummaryCandidate(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  if (!/[A-Za-z]/.test(normalized)) {
    return false;
  }
  if (NON_ENGLISH_SCRIPT_PATTERN.test(normalized)) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  const looksLikeStatusSummary =
    lowered.startsWith("workflow=") ||
    lowered.startsWith("html=") ||
    lowered.startsWith("pdf=") ||
    lowered.startsWith("next=");

  if (!looksLikeStatusSummary && normalized.length < 18) {
    return false;
  }
  if (lowered === "tool" || lowered === "plan" || lowered === "explore") {
    return false;
  }

  return true;
}

export function extractStatusSummaryFromRecord(record: Record<string, unknown>): string | undefined {
  const workflowStatus = maybeString(
    readFieldCaseInsensitive(record, "workflow_status") ?? readFieldCaseInsensitive(record, "workflowStatus")
  );
  const htmlReviewStatus = maybeString(
    readFieldCaseInsensitive(record, "html_review_status") ?? readFieldCaseInsensitive(record, "htmlReviewStatus")
  );
  const pdfReviewStatus = maybeString(
    readFieldCaseInsensitive(record, "pdf_review_status") ?? readFieldCaseInsensitive(record, "pdfReviewStatus")
  );
  const nextAction = maybeString(
    readFieldCaseInsensitive(record, "next_action") ?? readFieldCaseInsensitive(record, "nextAction")
  );

  const segments = buildStatusSummarySegments({
    workflowStatus,
    htmlReviewStatus,
    pdfReviewStatus,
    nextAction
  });

  if (segments.length === 0) {
    return undefined;
  }
  return sanitizeSummaryCandidate(segments.join(" | "));
}

export function extractStatusSummaryFromText(text: string): string | undefined {
  const workflowMatch = WORKFLOW_STATUS_PATTERN.exec(text)?.[1];
  const htmlMatch = HTML_REVIEW_STATUS_PATTERN.exec(text)?.[1];
  const pdfMatch = PDF_REVIEW_STATUS_PATTERN.exec(text)?.[1];
  const nextActionMatch = NEXT_ACTION_PATTERN.exec(text)?.[1];

  const segments = buildStatusSummarySegments({
    workflowStatus: workflowMatch,
    htmlReviewStatus: htmlMatch,
    pdfReviewStatus: pdfMatch,
    nextAction: nextActionMatch
  });

  if (segments.length === 0) {
    return undefined;
  }
  return sanitizeSummaryCandidate(segments.join(" | "));
}

export function extractEnglishSummaryFromRecord(record: Record<string, unknown>): string | undefined {
  for (const field of SUMMARY_FIELDS) {
    const candidate = maybeString(readFieldCaseInsensitive(record, field));
    if (!candidate) {
      continue;
    }
    const sanitized = sanitizeSummaryCandidate(candidate);
    if (!isEnglishSummaryCandidate(sanitized)) {
      continue;
    }
    return sanitized;
  }

  return extractStatusSummaryFromRecord(record);
}

export function buildEnglishSummaryFromOutput(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return "Step completed with no text output.";
  }

  const parsed = parseFirstJsonRecordFromText(output);
  if (parsed) {
    const summaryFromRecord = extractEnglishSummaryFromRecord(parsed);
    if (summaryFromRecord) {
      return summaryFromRecord;
    }
  }

  const statusSummary = extractStatusSummaryFromText(output);
  if (statusSummary) {
    return statusSummary;
  }

  const sentence = extractEnglishSentenceCandidate(output);
  if (sentence) {
    return sentence;
  }

  return "Step completed. Output generated.";
}
