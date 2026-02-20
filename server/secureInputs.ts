import fs from "node:fs/promises";
import path from "node:path";
import { normalizeRunInputs, type RunInputs } from "./runInputs.js";

interface SecureInputsFile {
  version: 1;
  pipelineId: string;
  updatedAt: string;
  values: Record<string, string>;
}

const SECURE_INPUTS_ROOT = path.resolve(process.cwd(), "data", "pipeline-secure-inputs");
const SECURE_INPUTS_FILE = "secure-inputs.json";
export const MASK_VALUE = "[secure]";

function nowIso(): string {
  return new Date().toISOString();
}

function safeSegment(value: string): string {
  const normalized = value.trim().length > 0 ? value.trim() : "default";
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function securePipelineDir(pipelineId: string): string {
  return path.join(SECURE_INPUTS_ROOT, safeSegment(pipelineId));
}

function securePipelineFilePath(pipelineId: string): string {
  return path.join(securePipelineDir(pipelineId), SECURE_INPUTS_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStoredValues(raw: unknown): RunInputs {
  if (!isRecord(raw)) {
    return {};
  }
  return normalizeRunInputs(raw);
}

async function readSecureInputsFile(pipelineId: string): Promise<RunInputs> {
  const filePath = securePipelineFilePath(pipelineId);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const values = normalizeStoredValues(parsed.values);
    return values;
  } catch {
    return {};
  }
}

async function writeSecureInputsFile(pipelineId: string, values: RunInputs): Promise<void> {
  const dirPath = securePipelineDir(pipelineId);
  const filePath = securePipelineFilePath(pipelineId);
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });

  const payload: SecureInputsFile = {
    version: 1,
    pipelineId,
    updatedAt: nowIso(),
    values
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });

  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Non-POSIX systems can ignore chmod issues.
  }
}

export function isSensitiveInputKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("credential") ||
    normalized.endsWith("_key")
  );
}

export function pickSensitiveInputs(rawInputs: RunInputs): RunInputs {
  const normalized = normalizeRunInputs(rawInputs);
  const picked: RunInputs = {};

  for (const [key, value] of Object.entries(normalized)) {
    if (!isSensitiveInputKey(key)) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === MASK_VALUE) {
      continue;
    }

    picked[key] = value;
  }

  return picked;
}

export function maskSensitiveInputs(rawInputs: RunInputs, alwaysMaskKeys?: Iterable<string>): RunInputs {
  const normalized = normalizeRunInputs(rawInputs);
  const forced = new Set<string>();
  if (alwaysMaskKeys) {
    for (const key of alwaysMaskKeys) {
      const normalizedKey = key.trim().toLowerCase();
      if (normalizedKey.length > 0) {
        forced.add(normalizedKey);
      }
    }
  }

  const masked: RunInputs = {};
  for (const [key, value] of Object.entries(normalized)) {
    const shouldMask = forced.has(key) || isSensitiveInputKey(key);
    masked[key] = shouldMask ? MASK_VALUE : value;
  }
  return masked;
}

export async function getPipelineSecureInputs(pipelineId: string): Promise<RunInputs> {
  return readSecureInputsFile(pipelineId);
}

export async function upsertPipelineSecureInputs(pipelineId: string, rawInputs: RunInputs): Promise<RunInputs> {
  const current = await readSecureInputsFile(pipelineId);
  const updates = normalizeRunInputs(rawInputs);
  if (Object.keys(updates).length === 0) {
    return current;
  }

  const next: RunInputs = {
    ...current
  };

  for (const [key, value] of Object.entries(updates)) {
    if (value.trim().length === 0) {
      continue;
    }
    next[key] = value;
  }

  await writeSecureInputsFile(pipelineId, next);
  return next;
}

export function mergeRunInputsWithSecure(rawInputs: RunInputs | undefined, secureInputs: RunInputs): RunInputs {
  const normalized = normalizeRunInputs(rawInputs);
  const merged: RunInputs = {
    ...secureInputs
  };

  for (const [key, value] of Object.entries(normalized)) {
    if (value.trim() === MASK_VALUE) {
      continue;
    }
    merged[key] = value;
  }

  return merged;
}
