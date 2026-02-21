import type {
  RunInputRequestOption,
  RunStartupBlocker
} from "../types.js";

export function mergeRequestOptionLists(
  base: RunInputRequestOption[] | undefined,
  extra: RunInputRequestOption[] | undefined
): RunInputRequestOption[] | undefined {
  if ((!base || base.length === 0) && (!extra || extra.length === 0)) {
    return undefined;
  }

  const byValue = new Map<string, RunInputRequestOption>();
  for (const option of [...(base ?? []), ...(extra ?? [])]) {
    const key = option.value.trim();
    if (key.length === 0) {
      continue;
    }
    if (!byValue.has(key)) {
      byValue.set(key, option);
    }
  }

  return [...byValue.values()];
}

export function dedupeBlockers(blockers: RunStartupBlocker[]): RunStartupBlocker[] {
  const byId = new Map<string, RunStartupBlocker>();
  for (const blocker of blockers) {
    const key = blocker.id.trim().length > 0 ? blocker.id.trim() : `${blocker.title}:${blocker.message}`;
    if (!byId.has(key)) {
      byId.set(key, blocker);
    }
  }
  return [...byId.values()];
}
