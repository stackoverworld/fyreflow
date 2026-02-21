import type { RunInputRequestType } from "@/lib/types";
import { normalizeRunInputKey } from "@/lib/runInputAliases";

export function normalizeKey(raw: string): string {
  return normalizeRunInputKey(raw);
}

export function toLabelFromKey(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(0, 1).toUpperCase() + entry.slice(1))
    .join(" ");
}

export function normalizeRequestType(rawType: unknown): RunInputRequestType {
  if (typeof rawType !== "string") {
    return "text";
  }

  const normalized = rawType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "text") return "text";
  if (normalized === "multiline" || normalized === "textarea" || normalized === "long_text") return "multiline";
  if (normalized === "secret" || normalized === "password" || normalized === "token" || normalized === "api_key") return "secret";
  if (normalized === "path" || normalized === "file" || normalized === "directory" || normalized === "dir") return "path";
  if (normalized === "url" || normalized === "link" || normalized === "uri") return "url";
  if (normalized === "select" || normalized === "enum" || normalized === "choice" || normalized === "options") return "select";
  return "text";
}

export function sanitizeJsonCandidate(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}

export function stripJsonComments(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < value.length && value[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < value.length && !(value[index] === "*" && value[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

export function removeTrailingCommas(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookAhead = index + 1;
      while (lookAhead < value.length && /\s/.test(value[lookAhead])) {
        lookAhead += 1;
      }
      const nextChar = value[lookAhead];
      if (nextChar === "}" || nextChar === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

export function quoteUnquotedKeys(value: string): string {
  return value.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, "$1\"$2\"$3");
}

export function convertSingleQuotedStrings(value: string): string {
  return value.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => {
    const escaped = inner.replace(/"/g, "\\\"");
    return `"${escaped}"`;
  });
}

export function normalizePythonJsonLiterals(value: string): string {
  return value
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function collectJsonCandidates(rawOutput: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) {
      return;
    }

    const normalized = sanitizeJsonCandidate(value);
    if (normalized.length > 0) {
      candidates.add(normalized);
    }
  };

  add(rawOutput);
  for (const block of rawOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    add(block[1]);
  }

  add(extractFirstJsonObject(rawOutput));

  const base = [...candidates];
  for (const candidate of base) {
    const noComments = stripJsonComments(candidate);
    add(noComments);
    add(removeTrailingCommas(noComments));
    add(quoteUnquotedKeys(noComments));
    add(convertSingleQuotedStrings(noComments));
    add(normalizePythonJsonLiterals(noComments));
    add(removeTrailingCommas(quoteUnquotedKeys(noComments)));
    add(removeTrailingCommas(convertSingleQuotedStrings(noComments)));
    add(removeTrailingCommas(normalizePythonJsonLiterals(noComments)));
  }

  return [...candidates];
}
