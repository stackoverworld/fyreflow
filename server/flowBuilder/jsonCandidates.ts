function sanitizeJsonCandidate(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}

function removeTrailingCommas(value: string): string {
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

function stripJsonComments(value: string): string {
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

function quoteUnquotedKeys(value: string): string {
  return value.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, "$1\"$2\"$3");
}

function convertSingleQuotedStrings(value: string): string {
  return value.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => {
    const escaped = inner.replace(/"/g, "\\\"");
    return `"${escaped}"`;
  });
}

function normalizePythonJsonLiterals(value: string): string {
  return value
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

function extractFirstJsonObject(text: string): string | null {
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
  const addCandidate = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }

    const normalized = sanitizeJsonCandidate(candidate);
    if (normalized.length > 0) {
      candidates.add(normalized);
    }
  };

  addCandidate(rawOutput);

  const fenced = [...rawOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of fenced) {
    addCandidate(block[1]);
  }

  addCandidate(extractFirstJsonObject(rawOutput));

  const initial = [...candidates];
  for (const candidate of initial) {
    const noComments = stripJsonComments(candidate);
    addCandidate(noComments);
    addCandidate(removeTrailingCommas(noComments));
    addCandidate(quoteUnquotedKeys(noComments));
    addCandidate(convertSingleQuotedStrings(noComments));
    addCandidate(normalizePythonJsonLiterals(noComments));
    addCandidate(removeTrailingCommas(quoteUnquotedKeys(noComments)));
    addCandidate(removeTrailingCommas(convertSingleQuotedStrings(noComments)));
    addCandidate(removeTrailingCommas(normalizePythonJsonLiterals(noComments)));

    const extracted = extractFirstJsonObject(noComments);
    addCandidate(extracted);
    addCandidate(extracted ? removeTrailingCommas(extracted) : null);
    addCandidate(extracted ? quoteUnquotedKeys(extracted) : null);
    addCandidate(extracted ? convertSingleQuotedStrings(extracted) : null);
    addCandidate(extracted ? normalizePythonJsonLiterals(extracted) : null);
    addCandidate(extracted ? removeTrailingCommas(quoteUnquotedKeys(extracted)) : null);
    addCandidate(extracted ? removeTrailingCommas(convertSingleQuotedStrings(extracted)) : null);
    addCandidate(extracted ? removeTrailingCommas(normalizePythonJsonLiterals(extracted)) : null);
  }

  return [...candidates];
}
