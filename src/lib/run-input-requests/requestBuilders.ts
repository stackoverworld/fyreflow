import type { RunInputRequest, RunInputRequestOption, RunStartupBlocker } from "@/lib/types";
import { areRunInputKeysEquivalent, normalizeRunInputKey, pickPreferredRunInputKey } from "@/lib/runInputAliases";

export function dedupeRequests(requests: RunInputRequest[]): RunInputRequest[] {
  const byKey = new Map<string, RunInputRequest>();
  for (const request of requests) {
    const normalizedKey = normalizeRunInputKey(request.key);
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

export function dedupeBlockers(blockers: RunStartupBlocker[]): RunStartupBlocker[] {
  const byKey = new Map<string, RunStartupBlocker>();
  for (const blocker of blockers) {
    const key = blocker.id.trim().length > 0 ? blocker.id.trim() : `${blocker.title}:${blocker.message}`;
    if (!byKey.has(key)) {
      byKey.set(key, blocker);
    }
  }
  return [...byKey.values()];
}
