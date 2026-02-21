import type { PipelineQualityGate } from "../../types.js";
import { MAX_CONTRACT_ITEMS } from "./contracts.js";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeStringList(raw: unknown, maxItems = MAX_CONTRACT_ITEMS): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, maxItems);
}

export function normalizeQualityGateKind(raw: unknown): PipelineQualityGate["kind"] {
  if (
    raw === "regex_must_match" ||
    raw === "regex_must_not_match" ||
    raw === "json_field_exists" ||
    raw === "artifact_exists" ||
    raw === "manual_approval"
  ) {
    return raw;
  }

  return "regex_must_match";
}
