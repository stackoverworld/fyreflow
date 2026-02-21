import { normalizeRunInputKey } from "../runInputs.js";
import { collectJsonCandidates } from "./jsonCandidates.js";
import {
  collectStartupBlockers,
  collectStartupNotes,
  collectStartupRequests
} from "./modelNormalization.js";
import { modelStartupSchema } from "./types.js";
import type { ParsedModelStartupResult } from "./types.js";

export function normalizeStartupKey(raw: string): string {
  return normalizeRunInputKey(raw);
}

export function parseModelStartupResult(rawOutput: string): ParsedModelStartupResult | null {
  if (rawOutput.trimStart().startsWith("[Simulated ")) {
    return null;
  }

  for (const candidate of collectJsonCandidates(rawOutput)) {
    const parsed = parseModelStartupCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseModelStartupCandidate(rawCandidate: string): ParsedModelStartupResult | null {
  const parsed = parseJsonObject(rawCandidate);
  if (parsed === null) {
    return null;
  }

  const validated = modelStartupSchema.safeParse(parsed);
  if (!validated.success) {
    return null;
  }

  return {
    status: validated.data.status,
    summary: validated.data.summary?.trim() || undefined,
    requests: collectStartupRequests(validated.data.requests, validated.data.input_requests),
    blockers: collectStartupBlockers(validated.data.blockers),
    notes: collectStartupNotes(validated.data.notes)
  };
}

function parseJsonObject(rawCandidate: string): unknown | null {
  try {
    return JSON.parse(rawCandidate) as unknown;
  } catch {
    return null;
  }
}
