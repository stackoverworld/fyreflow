export interface RunInputs {
  [key: string]: string;
}

const INPUT_TOKEN_REGEX = /\{\{\s*input\.([a-zA-Z0-9._-]+)\s*\}\}/g;
const KEY_SEPARATOR_REGEX = /[.\-\s]+/g;
const EDGE_UNDERSCORE_REGEX = /^_+|_+$/g;
const DUPLICATE_UNDERSCORE_REGEX = /_+/g;
const TOKEN_CANONICAL_EQUIVALENTS: Record<string, string> = {
  url: "link",
  urls: "links",
  uri: "link",
  uris: "links",
  endpoint: "link",
  endpoints: "links",
  directory: "dir",
  directories: "dirs",
  folder: "dir",
  folders: "dirs"
};
const LOCATION_SUFFIXES = new Set(["path", "dir", "file"]);
const SECRET_SUFFIXES = ["token", "key", "secret"] as const;
const SECRET_QUALIFIERS = new Set(["api", "personal", "access", "private", "auth", "pat"]);
const SENSITIVE_KEY_SUBSTRINGS = new Set(["token", "secret", "password", "credential", "apikey", "api_key"]);

function normalizeForMatch(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(KEY_SEPARATOR_REGEX, "_")
    .replace(EDGE_UNDERSCORE_REGEX, "")
    .replace(DUPLICATE_UNDERSCORE_REGEX, "_")
    .split("_")
    .filter((token) => token.length > 0)
    .map((token) => TOKEN_CANONICAL_EQUIVALENTS[token] ?? token)
    .join("_");
}

function buildRunInputKeyVariants(raw: string): Set<string> {
  const normalized = normalizeForMatch(raw);
  const variants = new Set<string>();
  if (normalized.length === 0) {
    return variants;
  }

  variants.add(normalized);
  const tokens = normalized.split("_").filter((token) => token.length > 0);
  if (tokens.length <= 1) {
    return variants;
  }

  const last = tokens[tokens.length - 1];
  if (LOCATION_SUFFIXES.has(last)) {
    variants.add(tokens.slice(0, -1).join("_"));
  } else {
    variants.add([...tokens, "path"].join("_"));
  }

  if (SECRET_SUFFIXES.includes(last as (typeof SECRET_SUFFIXES)[number])) {
    const compactTokens = tokens.filter(
      (token, index) => index === tokens.length - 1 || !SECRET_QUALIFIERS.has(token)
    );
    if (compactTokens.length >= 2) {
      variants.add(compactTokens.join("_"));

      const stem = compactTokens.slice(0, -1);
      for (const suffix of SECRET_SUFFIXES) {
        variants.add([...stem, suffix].join("_"));
      }
    }
  }

  return variants;
}

export function normalizeRunInputKey(raw: string): string {
  return normalizeForMatch(raw);
}

export function isSensitiveRunInputKey(raw: string): boolean {
  const normalized = normalizeRunInputKey(raw);
  if (normalized.length === 0) {
    return false;
  }

  if (normalized.endsWith("_key")) {
    return true;
  }

  for (const substring of SENSITIVE_KEY_SUBSTRINGS) {
    if (normalized.includes(substring)) {
      return true;
    }
  }

  return false;
}

export function areRunInputKeysEquivalent(leftRaw: string, rightRaw: string): boolean {
  const left = buildRunInputKeyVariants(leftRaw);
  const right = buildRunInputKeyVariants(rightRaw);
  for (const variant of left) {
    if (right.has(variant)) {
      return true;
    }
  }
  return false;
}

function keySpecificityScore(raw: string): number {
  const normalized = normalizeForMatch(raw);
  const tokens = normalized.split("_").filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return 0;
  }

  const last = tokens[tokens.length - 1];
  let score = Math.min(tokens.length, 16);
  if (last === "path") score += 40;
  if (last === "dir" || last === "file") score += 30;
  if (last === "links" || last === "link") score += 20;
  return score;
}

export function pickPreferredRunInputKey(leftRaw: string, rightRaw: string): string {
  const left = normalizeRunInputKey(leftRaw);
  const right = normalizeRunInputKey(rightRaw);
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0) {
    return left;
  }
  if (left === right) {
    return left;
  }

  const leftScore = keySpecificityScore(left);
  const rightScore = keySpecificityScore(right);
  if (leftScore !== rightScore) {
    return leftScore > rightScore ? left : right;
  }

  return left.localeCompare(right) <= 0 ? left : right;
}

function findEquivalentKey(existingKeys: Iterable<string>, candidateRaw: string): string | null {
  for (const existingKey of existingKeys) {
    if (areRunInputKeysEquivalent(existingKey, candidateRaw)) {
      return existingKey;
    }
  }
  return null;
}

export function getRunInputValue(runInputs: RunInputs, keyRaw: string): string | undefined {
  const key = normalizeRunInputKey(keyRaw);
  if (key.length === 0) {
    return undefined;
  }

  const direct = runInputs[key];
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  for (const [existingKey, value] of Object.entries(runInputs)) {
    if (existingKey === key) {
      continue;
    }
    if (!areRunInputKeysEquivalent(existingKey, key)) {
      continue;
    }
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

export function extractInputKeysFromText(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const keys = new Set<string>();
  for (const match of text.matchAll(INPUT_TOKEN_REGEX)) {
    const key = normalizeRunInputKey(match[1] ?? "");
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
    const key = normalizeRunInputKey(keyRaw);
    const value = getRunInputValue(runInputs, key);
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
  const entries = Object.entries(raw)
    .map(([rawKey, rawValue]) => {
      const originalKey = rawKey.trim();
      const key = normalizeRunInputKey(originalKey);
      return {
        rawKey: normalizeForMatch(originalKey),
        rawValue,
        key,
        score: keySpecificityScore(key)
      };
    })
    .filter((entry) => entry.key.length > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.rawKey.localeCompare(right.rawKey);
    });

  for (const entry of entries) {
    const equivalentKey = findEquivalentKey(Object.keys(result), entry.key);
    const key =
      equivalentKey === null ? entry.key : pickPreferredRunInputKey(equivalentKey, entry.key);
    if (key.length === 0) {
      continue;
    }

    if (entry.rawValue === null || entry.rawValue === undefined) {
      continue;
    }

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

export function formatRunInputsSummary(runInputs: RunInputs): string {
  const entries = Object.entries(runInputs)
    .map(([key, value]) => [normalizeRunInputKey(key), value] as const)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return "None";
  }

  return entries
    .map(([key, value]) => `- ${key}: ${isSensitiveRunInputKey(key) ? "[REDACTED]" : value}`)
    .join("\n");
}
