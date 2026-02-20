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

  return variants;
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

export function normalizeRunInputKey(raw: string): string {
  return normalizeForMatch(raw);
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

export function getRunInputValue(inputs: Record<string, string> | undefined, keyRaw: string): string | undefined {
  if (!inputs) {
    return undefined;
  }

  const key = normalizeRunInputKey(keyRaw);
  if (key.length === 0) {
    return undefined;
  }

  const direct = inputs[key];
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  for (const [existingKey, value] of Object.entries(inputs)) {
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
