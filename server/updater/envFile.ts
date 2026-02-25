import fs from "node:fs";
import path from "node:path";

export function readEnvFile(filePath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const output: Record<string, string> = {};

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      const separator = trimmed.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (key.length === 0) {
        continue;
      }

      output[key] = value;
    }

    return output;
  } catch {
    return {};
  }
}

export function writeEnvVariable(filePath: string, key: string, value: string): void {
  const lines = (() => {
    try {
      return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    } catch {
      return [] as string[];
    }
  })();

  let replaced = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return line;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      return line;
    }

    const currentKey = line.slice(0, separator).trim();
    if (currentKey !== key) {
      return line;
    }

    replaced = true;
    return `${key}=${value}`;
  });

  if (!replaced) {
    nextLines.push(`${key}=${value}`);
  }

  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, `${nextLines.join("\n").replace(/\n*$/, "\n")}`, "utf8");
}
