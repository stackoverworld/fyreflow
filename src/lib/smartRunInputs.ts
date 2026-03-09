import {
  areRunInputKeysEquivalent,
  getRunInputValue,
  normalizeRunInputKey,
  pickPreferredRunInputKey
} from "@/lib/runInputAliases";
import type { SmartRunCheck, SmartRunField, SmartRunPlan } from "@/lib/types";

const SMART_RUN_PLAN_CACHE_LIMIT = 24;

function mergeSmartRunFields(fields: SmartRunField[]): SmartRunField[] {
  const byKey = new Map<string, SmartRunField>();

  for (const field of fields) {
    const normalizedKey = normalizeRunInputKey(field.key);
    if (normalizedKey.length === 0) {
      continue;
    }

    const equivalentKey = [...byKey.keys()].find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, normalizedKey)
    );
    const key =
      equivalentKey === undefined ? normalizedKey : pickPreferredRunInputKey(equivalentKey, normalizedKey);
    const existing = equivalentKey ? byKey.get(equivalentKey) : byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        ...field,
        key,
        sources: [...new Set(field.sources)].sort()
      });
      continue;
    }

    const mergedSources = [...new Set([...(existing.sources ?? []), ...(field.sources ?? [])])].sort();

    if (equivalentKey && equivalentKey !== key) {
      byKey.delete(equivalentKey);
    }

    byKey.set(key, {
      ...existing,
      key,
      label: existing.label || field.label,
      type: existing.type === "text" && field.type !== "text" ? field.type : existing.type,
      required: existing.required || field.required,
      description: existing.description || field.description,
      placeholder: existing.placeholder || field.placeholder,
      sources: mergedSources
    });
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function smartRunCheckSeverity(status: SmartRunCheck["status"]): number {
  if (status === "fail") {
    return 2;
  }
  if (status === "warn") {
    return 1;
  }
  return 0;
}

function mergeInputChecks(checks: SmartRunCheck[], normalizedFields: SmartRunField[]): SmartRunCheck[] {
  const byKey = new Map<string, SmartRunCheck>();
  const labelByKey = new Map(normalizedFields.map((field) => [field.key, field.label] as const));

  for (const check of checks) {
    if (!check.id.startsWith("input:")) {
      continue;
    }

    const rawKey = check.id.replace(/^input:/, "");
    const normalizedKey = normalizeRunInputKey(rawKey);
    if (normalizedKey.length === 0) {
      continue;
    }

    const equivalentKey = [...byKey.keys()].find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, normalizedKey)
    );
    const key =
      equivalentKey === undefined ? normalizedKey : pickPreferredRunInputKey(equivalentKey, normalizedKey);
    const existing = equivalentKey ? byKey.get(equivalentKey) : byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        ...check,
        id: `input:${key}`,
        title: labelByKey.has(key) ? `Input ${labelByKey.get(key)}` : check.title
      });
      continue;
    }

    const nextCheck =
      smartRunCheckSeverity(check.status) > smartRunCheckSeverity(existing.status)
        ? check
        : existing;

    if (equivalentKey && equivalentKey !== key) {
      byKey.delete(equivalentKey);
    }

    byKey.set(key, {
      ...nextCheck,
      id: `input:${key}`,
      title: labelByKey.has(key) ? `Input ${labelByKey.get(key)}` : nextCheck.title
    });
  }

  return [...byKey.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeSmartRunPlan(plan: SmartRunPlan): SmartRunPlan {
  const fields = mergeSmartRunFields(plan.fields ?? []);
  const inputChecks = mergeInputChecks(plan.checks ?? [], fields);
  const nonInputChecks = (plan.checks ?? []).filter((check) => !check.id.startsWith("input:"));
  const checks = [...nonInputChecks, ...inputChecks];

  return {
    ...plan,
    fields,
    checks,
    canRun: checks.every((check) => check.status !== "fail")
  };
}

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
