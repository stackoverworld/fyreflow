import {
  areRunInputKeysEquivalent,
  getRunInputValue,
  normalizeRunInputKey,
  pickPreferredRunInputKey
} from "@/lib/runInputAliases";
import type { SmartRunPlan } from "@/lib/types";

const SMART_RUN_PLAN_CACHE_LIMIT = 24;

export function normalizeSmartRunInputs(inputs?: Record<string, string>): Record<string, string> {
  if (!inputs) {
    return {};
  }

  const normalized: Record<string, string> = {};
  const entries = Object.entries(inputs)
    .map(([rawKey, value]) => {
      const originalKey = rawKey.trim();
      const key = normalizeRunInputKey(originalKey);
      return {
        originalKey,
        key,
        value
      };
    })
    .filter((entry) => entry.key.length > 0)
    .sort((left, right) => left.originalKey.localeCompare(right.originalKey));

  for (const entry of entries) {
    if (entry.value.trim() === "[secure]") {
      continue;
    }

    const equivalentKey = Object.keys(normalized).find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, entry.key)
    );
    const key =
      equivalentKey === undefined ? entry.key : pickPreferredRunInputKey(equivalentKey, entry.key);

    if (equivalentKey && equivalentKey !== key) {
      const existingValue = normalized[equivalentKey];
      delete normalized[equivalentKey];
      normalized[key] = existingValue;
    }

    const existing = normalized[key];
    if (existing === undefined) {
      normalized[key] = entry.value;
      continue;
    }

    const existingHasValue = existing.trim().length > 0;
    const incomingHasValue = entry.value.trim().length > 0;
    if (!incomingHasValue) {
      continue;
    }

    if (!existingHasValue) {
      normalized[key] = entry.value;
    }
  }
  return normalized;
}

export function buildSmartRunPlanSignature(pipelineId: string, inputs?: Record<string, string>): string {
  const normalized = normalizeSmartRunInputs(inputs);
  const entries = Object.entries(normalized);
  return `${pipelineId}:${JSON.stringify(entries)}`;
}

export function buildScheduleRunPlanSignature(
  pipelineId: string,
  runMode: "smart" | "quick",
  inputs?: Record<string, string>
): string {
  const effectiveInputs = runMode === "smart" ? normalizeSmartRunInputs(inputs) : {};
  const entries = Object.entries(effectiveInputs);
  return `${pipelineId}:${runMode}:${JSON.stringify(entries)}`;
}

export function setSmartRunPlanCacheEntry(
  cache: Map<string, SmartRunPlan>,
  signature: string,
  plan: SmartRunPlan
): void {
  if (cache.has(signature)) {
    cache.delete(signature);
  }
  cache.set(signature, plan);

  while (cache.size > SMART_RUN_PLAN_CACHE_LIMIT) {
    const oldestSignature = cache.keys().next().value;
    if (typeof oldestSignature !== "string") {
      break;
    }
    cache.delete(oldestSignature);
  }
}

export function hasRunInputValue(inputs: Record<string, string> | undefined, key: string): boolean {
  const value = getRunInputValue(inputs, key);
  return typeof value === "string" && value.trim().length > 0 && value.trim() !== "[secure]";
}
