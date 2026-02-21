import type { QualityGateKind } from "../../types.js";

export function inferStrictQualityMode(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const markers = [
    "strict",
    "quality gate",
    "quality gates",
    "non-negotiable",
    "verification",
    "verify-only",
    "remediation",
    "pass/fail",
    "blocking",
    "qa report",
    "no overlap",
    "no clipped"
  ];

  return markers.some((marker) => normalized.includes(marker));
}

export function normalizeQualityGateKind(value: unknown): QualityGateKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "regex_must_match" || normalized === "must_match" || normalized === "regex_match") {
    return "regex_must_match";
  }
  if (normalized === "regex_must_not_match" || normalized === "must_not_match" || normalized === "regex_block") {
    return "regex_must_not_match";
  }
  if (normalized === "json_field_exists" || normalized === "json_path_exists" || normalized === "field_exists") {
    return "json_field_exists";
  }
  if (normalized === "artifact_exists" || normalized === "file_exists" || normalized === "path_exists") {
    return "artifact_exists";
  }
  if (normalized === "manual_approval" || normalized === "human_approval" || normalized === "approve") {
    return "manual_approval";
  }
  return undefined;
}
