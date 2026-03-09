const DISMISSED_RUN_INPUT_MODAL_STORAGE_KEY = "fyreflow:run-input-modal-dismissed:v1";
const MAX_DISMISSED_SIGNATURES = 240;

type PersistedDismissedSignatures = {
  signatures?: unknown;
};

let dismissedSignatureCache: Set<string> | null = null;

function clampSignatures(raw: string[]): string[] {
  const cleaned = raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (cleaned.length <= MAX_DISMISSED_SIGNATURES) {
    return cleaned;
  }
  return cleaned.slice(cleaned.length - MAX_DISMISSED_SIGNATURES);
}

function loadPersistedDismissedSignatures(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(DISMISSED_RUN_INPUT_MODAL_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw) as PersistedDismissedSignatures;
    if (!Array.isArray(parsed?.signatures)) {
      return new Set();
    }

    const normalized = clampSignatures(parsed.signatures.filter((entry): entry is string => typeof entry === "string"));
    return new Set(normalized);
  } catch {
    return new Set();
  }
}

function ensureDismissedSignatureCache(): Set<string> {
  if (!dismissedSignatureCache) {
    dismissedSignatureCache = loadPersistedDismissedSignatures();
  }
  return dismissedSignatureCache;
}

function persistDismissedSignatures(signatures: Set<string>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      DISMISSED_RUN_INPUT_MODAL_STORAGE_KEY,
      JSON.stringify({
        signatures: clampSignatures([...signatures])
      })
    );
  } catch {
    // Ignore localStorage write failures.
  }
}

export function isRunInputModalDismissed(signature: string): boolean {
  const normalized = signature.trim();
  if (normalized.length === 0) {
    return false;
  }
  return ensureDismissedSignatureCache().has(normalized);
}

export function dismissRunInputModalSignature(signature: string): void {
  const normalized = signature.trim();
  if (normalized.length === 0) {
    return;
  }

  const cache = ensureDismissedSignatureCache();
  if (cache.has(normalized)) {
    return;
  }

  cache.add(normalized);
  while (cache.size > MAX_DISMISSED_SIGNATURES) {
    const oldest = cache.values().next().value;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }

  persistDismissedSignatures(cache);
}

export function __resetRunInputModalDismissalsForTests(): void {
  dismissedSignatureCache = null;
}
