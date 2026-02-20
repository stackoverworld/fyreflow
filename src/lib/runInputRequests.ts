import type { RunInputRequest, RunInputRequestOption, RunInputRequestType, RunStartupBlocker } from "@/lib/types";
import { areRunInputKeysEquivalent, normalizeRunInputKey, pickPreferredRunInputKey } from "@/lib/runInputAliases";

export interface ParsedRunInputRequests {
  status?: "pass" | "needs_input" | "blocked";
  summary?: string;
  requests: RunInputRequest[];
  blockers: RunStartupBlocker[];
  notes: string[];
}

function normalizeKey(raw: string): string {
  return normalizeRunInputKey(raw);
}

function toLabelFromKey(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(0, 1).toUpperCase() + entry.slice(1))
    .join(" ");
}

function normalizeRequestType(rawType: unknown): RunInputRequestType {
  if (typeof rawType !== "string") {
    return "text";
  }

  const normalized = rawType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "text") return "text";
  if (normalized === "multiline" || normalized === "textarea" || normalized === "long_text") return "multiline";
  if (normalized === "secret" || normalized === "password" || normalized === "token" || normalized === "api_key") return "secret";
  if (normalized === "path" || normalized === "file" || normalized === "directory" || normalized === "dir") return "path";
  if (normalized === "url" || normalized === "link" || normalized === "uri") return "url";
  if (normalized === "select" || normalized === "enum" || normalized === "choice" || normalized === "options") return "select";
  return "text";
}

function sanitizeJsonCandidate(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}

function stripJsonComments(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (inString) {
      output += char;
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
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < value.length && value[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < value.length && !(value[index] === "*" && value[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function removeTrailingCommas(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      output += char;
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
      output += char;
      continue;
    }

    if (char === ",") {
      let lookAhead = index + 1;
      while (lookAhead < value.length && /\s/.test(value[lookAhead])) {
        lookAhead += 1;
      }
      const nextChar = value[lookAhead];
      if (nextChar === "}" || nextChar === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function quoteUnquotedKeys(value: string): string {
  return value.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, "$1\"$2\"$3");
}

function convertSingleQuotedStrings(value: string): string {
  return value.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => {
    const escaped = inner.replace(/"/g, "\\\"");
    return `"${escaped}"`;
  });
}

function normalizePythonJsonLiterals(value: string): string {
  return value
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
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

function collectJsonCandidates(rawOutput: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) {
      return;
    }

    const normalized = sanitizeJsonCandidate(value);
    if (normalized.length > 0) {
      candidates.add(normalized);
    }
  };

  add(rawOutput);
  for (const block of rawOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    add(block[1]);
  }

  add(extractFirstJsonObject(rawOutput));

  const base = [...candidates];
  for (const candidate of base) {
    const noComments = stripJsonComments(candidate);
    add(noComments);
    add(removeTrailingCommas(noComments));
    add(quoteUnquotedKeys(noComments));
    add(convertSingleQuotedStrings(noComments));
    add(normalizePythonJsonLiterals(noComments));
    add(removeTrailingCommas(quoteUnquotedKeys(noComments)));
    add(removeTrailingCommas(convertSingleQuotedStrings(noComments)));
    add(removeTrailingCommas(normalizePythonJsonLiterals(noComments)));
  }

  return [...candidates];
}

function normalizeOption(raw: unknown): RunInputRequestOption | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value.length === 0) {
      return null;
    }
    return { value, label: value };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const valueRaw = typeof record.value === "string" ? record.value : "";
  const value = valueRaw.trim();
  if (value.length === 0) {
    return null;
  }

  return {
    value,
    label: typeof record.label === "string" && record.label.trim().length > 0 ? record.label.trim() : value,
    description:
      typeof record.description === "string" && record.description.trim().length > 0
        ? record.description.trim()
        : undefined
  };
}

function normalizeRequest(raw: unknown): RunInputRequest | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const rawKey = typeof record.key === "string"
    ? record.key
    : typeof record.id === "string"
      ? record.id
      : typeof record.name === "string"
        ? record.name
        : "";
  const key = normalizeKey(rawKey);
  if (key.length === 0) {
    return null;
  }

  const options = Array.isArray(record.options)
    ? record.options
        .map((entry) => normalizeOption(entry))
        .filter((entry): entry is RunInputRequestOption => Boolean(entry))
    : [];

  const type = normalizeRequestType(
    typeof record.type === "string"
      ? record.type
      : typeof record.input_type === "string"
        ? record.input_type
        : undefined
  );

  const reasonRaw =
    typeof record.reason === "string"
      ? record.reason
      : typeof record.message === "string"
        ? record.message
        : `Provide ${toLabelFromKey(key)} to continue.`;

  return {
    key,
    label:
      typeof record.label === "string" && record.label.trim().length > 0
        ? record.label.trim()
        : typeof record.title === "string" && record.title.trim().length > 0
          ? record.title.trim()
          : toLabelFromKey(key),
    type: options.length > 0 && type !== "select" ? "select" : type,
    required: typeof record.required === "boolean" ? record.required : true,
    reason: reasonRaw.trim(),
    placeholder:
      typeof record.placeholder === "string" && record.placeholder.trim().length > 0
        ? record.placeholder.trim()
        : undefined,
    options: options.length > 0 ? options : undefined,
    allowCustom:
      typeof record.allowCustom === "boolean"
        ? record.allowCustom
        : typeof record.allow_custom === "boolean"
          ? record.allow_custom
          : undefined,
    defaultValue:
      typeof record.defaultValue === "string"
        ? record.defaultValue
        : typeof record.default_value === "string"
          ? record.default_value
          : undefined
  };
}

function normalizeBlocker(raw: unknown, index: number): RunStartupBlocker | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const message =
    typeof record.message === "string"
      ? record.message.trim()
      : typeof record.reason === "string"
        ? record.reason.trim()
        : "";
  if (message.length === 0) {
    return null;
  }

  return {
    id: typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `runtime-blocker-${index + 1}`,
    title: typeof record.title === "string" && record.title.trim().length > 0 ? record.title.trim() : "Runtime blocker",
    message,
    details:
      typeof record.details === "string" && record.details.trim().length > 0 ? record.details.trim() : undefined
  };
}

function dedupeRequests(requests: RunInputRequest[]): RunInputRequest[] {
  const byKey = new Map<string, RunInputRequest>();
  for (const request of requests) {
    const normalizedKey = normalizeKey(request.key);
    if (normalizedKey.length === 0) {
      continue;
    }

    const equivalentKey = [...byKey.keys()].find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, normalizedKey)
    );
    const key =
      equivalentKey === undefined
        ? normalizedKey
        : pickPreferredRunInputKey(equivalentKey, normalizedKey);
    const existing = equivalentKey ? byKey.get(equivalentKey) : byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...request, key });
      continue;
    }

    const mergedOptionsMap = new Map<string, RunInputRequestOption>();
    for (const option of [...(existing.options ?? []), ...(request.options ?? [])]) {
      const optionKey = option.value.trim();
      if (optionKey.length === 0 || mergedOptionsMap.has(optionKey)) {
        continue;
      }
      mergedOptionsMap.set(optionKey, option);
    }
    const mergedOptions = [...mergedOptionsMap.values()];

    if (equivalentKey && equivalentKey !== key) {
      byKey.delete(equivalentKey);
    }

    byKey.set(key, {
      ...existing,
      label: existing.label || request.label,
      type:
        existing.type === "text" && request.type !== "text"
          ? request.type
          : mergedOptions.length > 0
            ? "select"
            : existing.type,
      required: existing.required || request.required,
      reason: request.reason || existing.reason,
      placeholder: existing.placeholder ?? request.placeholder,
      options: mergedOptions.length > 0 ? mergedOptions : undefined,
      allowCustom: request.allowCustom ?? existing.allowCustom,
      defaultValue: existing.defaultValue ?? request.defaultValue
    });
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function dedupeBlockers(blockers: RunStartupBlocker[]): RunStartupBlocker[] {
  const byKey = new Map<string, RunStartupBlocker>();
  for (const blocker of blockers) {
    const key = blocker.id.trim().length > 0 ? blocker.id.trim() : `${blocker.title}:${blocker.message}`;
    if (!byKey.has(key)) {
      byKey.set(key, blocker);
    }
  }
  return [...byKey.values()];
}

export function parseRunInputRequestsFromText(rawOutput: string): ParsedRunInputRequests | null {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return null;
  }

  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }

      const record = parsed as Record<string, unknown>;
      const requestsRaw = Array.isArray(record.input_requests)
        ? record.input_requests
        : Array.isArray(record.requests)
          ? record.requests
          : [];
      const blockersRaw = Array.isArray(record.blockers) ? record.blockers : [];
      const notesRaw = Array.isArray(record.notes) ? record.notes : [];

      const requests = dedupeRequests(
        requestsRaw
          .map((entry) => normalizeRequest(entry))
          .filter((entry): entry is RunInputRequest => Boolean(entry))
      );
      const blockers = dedupeBlockers(
        blockersRaw
          .map((entry, index) => normalizeBlocker(entry, index))
          .filter((entry): entry is RunStartupBlocker => Boolean(entry))
      );

      if (requests.length === 0 && blockers.length === 0) {
        continue;
      }

      const statusRaw = typeof record.status === "string" ? record.status.trim().toLowerCase() : undefined;
      const status =
        statusRaw === "blocked" || statusRaw === "needs_input" || statusRaw === "pass"
          ? statusRaw
          : undefined;

      return {
        status,
        summary: typeof record.summary === "string" ? record.summary.trim() : undefined,
        requests,
        blockers,
        notes: notesRaw
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      };
    } catch {
      // Continue trying other candidates.
    }
  }

  return null;
}
