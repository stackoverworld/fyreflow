import {
  areRunInputKeysEquivalent,
  normalizeRunInputKey,
  pickPreferredRunInputKey
} from "@/lib/runInputAliases";

export type RunMode = "smart" | "quick";

export interface RunDraftState {
  task: string;
  mode: RunMode;
  inputs: Record<string, string>;
}

const RUN_DRAFT_PREFIX = "fyreflow:run-draft:";
const SENSITIVE_KEY_PATTERN = /(token|secret|password|api[_-]?key|oauth)/i;

function runDraftKey(scopeId: string): string {
  return `${RUN_DRAFT_PREFIX}${scopeId}`;
}

function normalizeInputs(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, string> = {};
  const entries = Object.entries(raw)
    .map(([rawKey, rawValue]) => {
      const originalKey = rawKey.trim();
      const key = normalizeRunInputKey(originalKey);
      return {
        originalKey,
        key,
        rawValue
      };
    })
    .filter((entry) => entry.key.length > 0)
    .sort((left, right) => left.originalKey.localeCompare(right.originalKey));

  for (const entry of entries) {
    if (SENSITIVE_KEY_PATTERN.test(entry.originalKey) || SENSITIVE_KEY_PATTERN.test(entry.key)) {
      continue;
    }

    if (entry.rawValue === null || entry.rawValue === undefined) {
      continue;
    }

    const equivalentKey = Object.keys(result).find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, entry.key)
    );
    const key =
      equivalentKey === undefined ? entry.key : pickPreferredRunInputKey(equivalentKey, entry.key);
    const incoming = typeof entry.rawValue === "string" ? entry.rawValue : String(entry.rawValue);

    if (equivalentKey && equivalentKey !== key) {
      const existingValue = result[equivalentKey];
      delete result[equivalentKey];
      result[key] = existingValue;
    }

    const existing = result[key];
    if (existing === undefined) {
      result[key] = incoming;
      continue;
    }

    const existingHasValue = existing.trim().length > 0;
    const incomingHasValue = incoming.trim().length > 0;
    if (!incomingHasValue) {
      continue;
    }

    if (!existingHasValue) {
      result[key] = incoming;
    }
  }

  return result;
}

function emptyRunDraft(): RunDraftState {
  return {
    task: "",
    mode: "smart",
    inputs: {}
  };
}

function normalizeDraft(raw: unknown): RunDraftState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return emptyRunDraft();
  }

  const record = raw as Record<string, unknown>;
  return {
    task: typeof record.task === "string" ? record.task : "",
    mode: record.mode === "quick" ? "quick" : "smart",
    inputs: normalizeInputs(record.inputs)
  };
}

function hasMeaningfulDraft(draft: RunDraftState): boolean {
  return draft.task.trim().length > 0 || Object.keys(draft.inputs).length > 0 || draft.mode === "quick";
}

export function loadRunDraft(scopeId: string | undefined): RunDraftState {
  if (typeof window === "undefined" || !scopeId) {
    return emptyRunDraft();
  }

  try {
    const raw = window.localStorage.getItem(runDraftKey(scopeId));
    if (!raw) {
      return emptyRunDraft();
    }

    const parsed = JSON.parse(raw) as unknown;
    return normalizeDraft(parsed);
  } catch {
    return emptyRunDraft();
  }
}

export function saveRunDraft(scopeId: string | undefined, draft: RunDraftState): void {
  if (typeof window === "undefined" || !scopeId) {
    return;
  }

  try {
    window.localStorage.setItem(
      runDraftKey(scopeId),
      JSON.stringify({
        task: draft.task,
        mode: draft.mode,
        inputs: normalizeInputs(draft.inputs)
      })
    );
  } catch {
    // Ignore localStorage errors.
  }
}

export function moveRunDraft(sourceScopeId: string | undefined, targetScopeId: string | undefined): void {
  if (
    typeof window === "undefined" ||
    !sourceScopeId ||
    !targetScopeId ||
    sourceScopeId === targetScopeId
  ) {
    return;
  }

  try {
    const sourceKey = runDraftKey(sourceScopeId);
    const targetKey = runDraftKey(targetScopeId);
    const sourceRaw = window.localStorage.getItem(sourceKey);

    if (!sourceRaw) {
      return;
    }

    const targetRaw = window.localStorage.getItem(targetKey);
    if (!targetRaw) {
      window.localStorage.setItem(targetKey, sourceRaw);
      window.localStorage.removeItem(sourceKey);
      return;
    }

    const sourceDraft = normalizeDraft(JSON.parse(sourceRaw) as unknown);
    const targetDraft = normalizeDraft(JSON.parse(targetRaw) as unknown);
    const targetHasData = hasMeaningfulDraft(targetDraft);

    const merged: RunDraftState = {
      task: targetDraft.task.trim().length > 0 ? targetDraft.task : sourceDraft.task,
      mode: targetHasData ? targetDraft.mode : sourceDraft.mode,
      inputs: {
        ...sourceDraft.inputs,
        ...targetDraft.inputs
      }
    };

    saveRunDraft(targetScopeId, merged);
    window.localStorage.removeItem(sourceKey);
  } catch {
    // Ignore migration failures so flow save still succeeds.
  }
}
