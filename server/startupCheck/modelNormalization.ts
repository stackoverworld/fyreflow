import { normalizeRunInputKey } from "../runInputs.js";
import type {
  RunInputRequest,
  RunInputRequestOption,
  RunStartupBlocker
} from "../types.js";
import {
  modelBlockerSchema,
  modelOptionSchema,
  modelRequestSchema
} from "./types.js";

function normalizeRequestType(rawType: unknown): RunInputRequest["type"] {
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

function toLabelFromKey(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.slice(0, 1).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function normalizeOption(raw: unknown): RunInputRequestOption | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value.length === 0) {
      return null;
    }

    return {
      value,
      label: value
    };
  }

  const parsed = modelOptionSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  return {
    value: parsed.data.value.trim(),
    label: (parsed.data.label ?? parsed.data.value).trim(),
    description: parsed.data.description?.trim() || undefined
  };
}

function normalizeModelRequest(raw: unknown): RunInputRequest | null {
  const parsed = modelRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;
  const rawKey = data.key ?? data.id ?? data.name;
  if (!rawKey) {
    return null;
  }

  const key = normalizeRunInputKey(rawKey);
  if (key.length === 0) {
    return null;
  }

  const type = normalizeRequestType(data.type ?? data.input_type);
  const options = (data.options ?? [])
    .map((entry) => normalizeOption(entry))
    .filter((entry): entry is RunInputRequestOption => Boolean(entry));
  const reason = (data.reason ?? data.message ?? `Provide ${toLabelFromKey(key)} to continue.`).trim();

  const normalized: RunInputRequest = {
    key,
    label: (data.label ?? data.title ?? toLabelFromKey(key)).trim(),
    type,
    required: data.required ?? true,
    reason,
    placeholder: data.placeholder?.trim() || undefined,
    options: options.length > 0 ? options : undefined,
    allowCustom: data.allowCustom ?? data.allow_custom ?? undefined,
    defaultValue: (data.defaultValue ?? data.default_value)?.trim() || undefined
  };

  if (normalized.type !== "select" && normalized.options && normalized.options.length > 0) {
    normalized.type = "select";
  }

  return normalized;
}

function normalizeModelBlocker(raw: unknown, index: number): RunStartupBlocker | null {
  const parsed = modelBlockerSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const message = (parsed.data.message ?? parsed.data.reason ?? "").trim();
  if (message.length === 0) {
    return null;
  }

  return {
    id: (parsed.data.id ?? `model-blocker-${index + 1}`).trim(),
    title: (parsed.data.title ?? "Startup blocker").trim(),
    message,
    details: parsed.data.details?.trim() || undefined
  };
}

export function collectStartupRequests(requests: unknown, inputRequests: unknown): RunInputRequest[] {
  const rawRequests = Array.isArray(requests) ? requests : Array.isArray(inputRequests) ? inputRequests : [];
  return rawRequests
    .map((entry) => normalizeModelRequest(entry))
    .filter((entry): entry is RunInputRequest => Boolean(entry));
}

export function collectStartupBlockers(rawBlockers: unknown): RunStartupBlocker[] {
  if (!Array.isArray(rawBlockers)) {
    return [];
  }

  return rawBlockers
    .map((entry, index) => normalizeModelBlocker(entry, index))
    .filter((entry): entry is RunStartupBlocker => Boolean(entry));
}

export function collectStartupNotes(rawNotes: unknown): string[] {
  if (!Array.isArray(rawNotes)) {
    return [];
  }

  return rawNotes
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}
