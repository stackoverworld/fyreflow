import {
  areRunInputKeysEquivalent,
  getRunInputValue,
  pickPreferredRunInputKey,
  type RunInputs
} from "../runInputs.js";
import type { RunInputRequest, SmartRunField } from "../types.js";
import { normalizeStartupKey } from "./checkContracts.js";
import { mergeRequestOptionLists } from "./checkPersistence.js";

export function missingFieldRequest(field: SmartRunField): RunInputRequest {
  return {
    key: normalizeStartupKey(field.key),
    label: field.label,
    type: field.type,
    required: field.required,
    reason: field.description || `Provide ${field.label} to continue.`,
    placeholder: field.placeholder || undefined,
    allowCustom: field.type === "multiline"
  };
}

export function hasInputValue(runInputs: RunInputs, key: string): boolean {
  const value = getRunInputValue(runInputs, key);
  return typeof value === "string" && value.trim().length > 0;
}

export function mergeRequests(
  deterministic: RunInputRequest[],
  model: RunInputRequest[],
  runInputs: RunInputs
): RunInputRequest[] {
  const byKey = new Map<string, RunInputRequest>();

  for (const request of deterministic) {
    if (hasInputValue(runInputs, request.key)) {
      continue;
    }

    const normalizedKey = normalizeStartupKey(request.key);
    const equivalentKey = [...byKey.keys()].find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, normalizedKey)
    );
    const key =
      equivalentKey === undefined
        ? normalizedKey
        : pickPreferredRunInputKey(equivalentKey, normalizedKey);
    const existing = equivalentKey ? byKey.get(equivalentKey) : undefined;
    const nextRequest = existing ? { ...existing, ...request, key } : { ...request, key };

    if (equivalentKey && equivalentKey !== key) {
      byKey.delete(equivalentKey);
    }
    byKey.set(key, nextRequest);
  }

  for (const request of model) {
    const normalizedKey = normalizeStartupKey(request.key);
    const equivalentKey = [...byKey.keys()].find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, normalizedKey)
    );
    const key =
      equivalentKey === undefined
        ? normalizedKey
        : pickPreferredRunInputKey(equivalentKey, normalizedKey);
    if (key.length === 0 || hasInputValue(runInputs, key)) {
      continue;
    }

    const existing = equivalentKey ? byKey.get(equivalentKey) : byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...request,
        key
      });
      continue;
    }

    const mergedOptions = mergeRequestOptionLists(existing.options, request.options);
    const mergedType =
      existing.type === "text" && request.type !== "text"
        ? request.type
        : mergedOptions && mergedOptions.length > 0
          ? "select"
          : existing.type;
    if (equivalentKey && equivalentKey !== key) {
      byKey.delete(equivalentKey);
    }
    byKey.set(key, {
      ...existing,
      label: existing.label || request.label,
      type: mergedType,
      required: existing.required || request.required,
      reason: request.reason || existing.reason,
      placeholder: existing.placeholder ?? request.placeholder,
      options: mergedOptions,
      allowCustom: request.allowCustom ?? existing.allowCustom,
      defaultValue: existing.defaultValue ?? request.defaultValue
    });
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}
