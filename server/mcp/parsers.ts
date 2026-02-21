export function parseCsv(value: string): string[] {
  return value
    .split(/[,\n]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseCommandArgs(value: string): string[] {
  const matches = value.match(/"([^"]*)"|'([^']*)'|[^\s]+/g);
  if (!matches) {
    return [];
  }

  return matches.map((match) => {
    if ((match.startsWith("\"") && match.endsWith("\"")) || (match.startsWith("'") && match.endsWith("'"))) {
      return match.slice(1, -1);
    }

    return match;
  });
}

export function parseEnvBindings(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of value.split(/\n/g)) {
    const line = entry.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const delimiterIndex = line.indexOf("=");
    if (delimiterIndex <= 0) {
      continue;
    }

    const key = line.slice(0, delimiterIndex).trim();
    const val = line.slice(delimiterIndex + 1).trim();
    if (key.length > 0) {
      env[key] = val;
    }
  }

  return env;
}

export function parseHeaders(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of value.split(/\n/g)) {
    const line = entry.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const delimiterIndex = line.indexOf(":");
    if (delimiterIndex <= 0) {
      continue;
    }

    const key = line.slice(0, delimiterIndex).trim();
    const val = line.slice(delimiterIndex + 1).trim();
    if (key.length > 0) {
      headers[key] = val;
    }
  }

  return headers;
}
