export interface RunInputs {
  [key: string]: string;
}

const INPUT_TOKEN_REGEX = /\{\{\s*input\.([a-zA-Z0-9._-]+)\s*\}\}/g;

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function extractInputKeysFromText(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const keys = new Set<string>();
  for (const match of text.matchAll(INPUT_TOKEN_REGEX)) {
    const key = normalizeKey(match[1] ?? "");
    if (key.length > 0) {
      keys.add(key);
    }
  }

  return [...keys];
}

export function replaceInputTokens(text: string, runInputs: RunInputs): string {
  if (!text || text.length === 0) {
    return text;
  }

  return text.replace(INPUT_TOKEN_REGEX, (_match, keyRaw: string) => {
    const key = normalizeKey(keyRaw);
    const value = runInputs[key];
    if (typeof value !== "string" || value.length === 0) {
      return `MISSING_INPUT:${key}`;
    }
    return value;
  });
}

export function normalizeRunInputs(raw: unknown): RunInputs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }

  const result: RunInputs = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = normalizeKey(rawKey);
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

export function formatRunInputsSummary(runInputs: RunInputs): string {
  const entries = Object.entries(runInputs)
    .map(([key, value]) => [normalizeKey(key), value] as const)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return "None";
  }

  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}
