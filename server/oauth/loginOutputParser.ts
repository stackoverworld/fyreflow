const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]}]+/gi;
const DEVICE_CODE_PATTERN = /\b[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+\b/g;
const CODE_HINT_PATTERN = /(one[- ]time code|user code|enter this code|code:)/i;
const DISALLOWED_CODE_TOKENS = new Set(["ONE-TIME", "ONE-TIME-CODE", "USER-CODE", "ENTER-THIS-CODE"]);
const STRONG_AUTH_URL_HINT_PATTERNS = [
  /\/device(?:\/|$|\?)/i,
  /\/oauth\/authorize(?:\/|$|\?)/i,
  /[?&](?:pairing|user_code|device_code|verification_uri|verification_uri_complete)=/i
];
const WEAK_AUTH_URL_HINT_PATTERNS = [/\/authorize(?:\/|$|\?)/i];

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function normalizeOutput(value: string): string {
  return stripAnsi(value).replace(/\r/g, "\n");
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[),.;]+$/g, "");
}

function hasAnyHint(url: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(url));
}

export function extractFirstAuthUrl(rawOutput: string): string | undefined {
  const normalized = normalizeOutput(rawOutput);
  const matches = Array.from(normalized.matchAll(URL_PATTERN), (match) => trimTrailingPunctuation(match[0])).filter(
    (url) => url.length > 0
  );
  if (matches.length === 0) {
    return undefined;
  }

  const strongHintUrl = matches.find((url) => hasAnyHint(url, STRONG_AUTH_URL_HINT_PATTERNS));
  if (strongHintUrl) {
    return strongHintUrl;
  }

  const weakHintUrl = matches.find((url) => hasAnyHint(url, WEAK_AUTH_URL_HINT_PATTERNS));
  return weakHintUrl ?? matches[0];
}

function isPlausibleDeviceCode(candidate: string, allowLetterOnly: boolean): boolean {
  if (DISALLOWED_CODE_TOKENS.has(candidate)) {
    return false;
  }

  if (/\d/.test(candidate)) {
    return true;
  }

  if (allowLetterOnly) {
    return true;
  }

  return candidate.split("-").length >= 3;
}

function extractCodeFromLine(line: string, allowLetterOnly = false): string | undefined {
  const matches = line.toUpperCase().match(DEVICE_CODE_PATTERN);
  if (!matches) {
    return undefined;
  }

  for (const candidate of matches) {
    if (isPlausibleDeviceCode(candidate, allowLetterOnly)) {
      return candidate;
    }
  }

  return undefined;
}

export function extractDeviceCode(rawOutput: string): string | undefined {
  const normalized = normalizeOutput(rawOutput);
  const lines = normalized.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!CODE_HINT_PATTERN.test(line)) {
      continue;
    }

    const codeFromCurrent = extractCodeFromLine(line, true);
    if (codeFromCurrent) {
      return codeFromCurrent;
    }

    const nextLine = lines[index + 1] ?? "";
    const codeFromNext = extractCodeFromLine(nextLine, true);
    if (codeFromNext) {
      return codeFromNext;
    }
  }

  for (const line of lines) {
    const candidate = extractCodeFromLine(line);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}
