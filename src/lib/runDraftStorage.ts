export type RunMode = "smart" | "quick";

export interface RunDraftState {
  task: string;
  mode: RunMode;
  inputs: Record<string, string>;
}

const RUN_DRAFT_PREFIX = "agents-dashboard:run-draft:";

function runDraftKey(scopeId: string): string {
  return `${RUN_DRAFT_PREFIX}${scopeId}`;
}

function normalizeInputs(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = rawKey.trim();
    if (key.length === 0) {
      continue;
    }

    if (typeof rawValue === "string") {
      result[key] = rawValue;
      continue;
    }

    if (rawValue === null || rawValue === undefined) {
      continue;
    }

    result[key] = String(rawValue);
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
