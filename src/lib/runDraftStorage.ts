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
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return emptyRunDraft();
    }

    const record = parsed as Record<string, unknown>;
    return {
      task: typeof record.task === "string" ? record.task : "",
      mode: record.mode === "quick" ? "quick" : "smart",
      inputs: normalizeInputs(record.inputs)
    };
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
