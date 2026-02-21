import type { RunInputRequest, RunInputRequestOption, RunStartupBlocker } from "@/lib/types";
import { normalizeKey, normalizeRequestType, toLabelFromKey } from "./common";

export function normalizeOption(raw: unknown): RunInputRequestOption | null {
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

export function normalizeRequest(raw: unknown): RunInputRequest | null {
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

export function normalizeBlocker(raw: unknown, index: number): RunStartupBlocker | null {
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
