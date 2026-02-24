import { nanoid } from "nanoid";
import { inferStrictQualityMode, normalizeRef } from "../normalizers.js";
import { workflowStatusPattern } from "../constants.js";
import type { AgentRole, PipelineInput } from "../../types.js";
import type { GeneratedFlowSpec } from "../schema.js";
import type { DraftQualityGateSpec, DraftStepRecord } from "./contracts.js";

type DraftSpec = Pick<GeneratedFlowSpec, "links" | "qualityGates">;

export function defaultDelegationCount(role: AgentRole): number {
  if (role === "orchestrator") return 3;
  if (role === "executor") return 2;
  return 1;
}

export function clampDelegationCount(value: number): number {
  return Math.max(1, Math.min(8, Math.floor(value)));
}

export function buildLinks(spec: Pick<DraftSpec, "links">, stepRecords: DraftStepRecord[]): PipelineInput["links"] {
  const idByName = new Map(
    stepRecords
      .filter((step): step is DraftStepRecord & { id: string } => typeof step.id === "string" && step.id.length > 0)
      .map((step) => [normalizeRef(step.name), step.id])
  );
  const links: PipelineInput["links"] = [];
  const seen = new Set<string>();

  for (const link of spec.links ?? []) {
    const sourceId = idByName.get(normalizeRef(link.source));
    const targetId = idByName.get(normalizeRef(link.target));

    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }

    const condition = link.condition ?? "always";
    const dedupeKey = `${sourceId}->${targetId}:${condition}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    links.push({
      id: nanoid(),
      sourceStepId: sourceId,
      targetStepId: targetId,
      condition
    });
  }

  if (links.length === 0 && stepRecords.length > 1) {
    for (let index = 0; index < stepRecords.length - 1; index += 1) {
      const sourceStepId = stepRecords[index].id;
      const targetStepId = stepRecords[index + 1].id;
      if (typeof sourceStepId !== "string" || sourceStepId.length === 0) {
        continue;
      }
      if (typeof targetStepId !== "string" || targetStepId.length === 0) {
        continue;
      }

      links.push({
        id: nanoid(),
        sourceStepId,
        targetStepId,
        condition: "always"
      });
    }
  }

  return links;
}

export function buildQualityGates(
  spec: Pick<DraftSpec, "qualityGates">,
  stepRecords: DraftStepRecord[]
): PipelineInput["qualityGates"] {
  if (!Array.isArray(spec.qualityGates) || spec.qualityGates.length === 0) {
    return [];
  }

  const idByName = new Map(
    stepRecords
      .filter((step): step is DraftStepRecord & { id: string } => typeof step.id === "string" && step.id.length > 0)
      .map((step) => [normalizeRef(step.name), step.id])
  );
  const seen = new Set<string>();
  const gates: NonNullable<PipelineInput["qualityGates"]> = [];

  for (const gate of spec.qualityGates as DraftQualityGateSpec[]) {
    const targetStepId =
      typeof gate.target === "string" && gate.target.trim().length > 0
        ? idByName.get(normalizeRef(gate.target)) ?? "any_step"
        : "any_step";

    const normalized = {
      id: nanoid(),
      name: gate.name.trim(),
      targetStepId,
      kind: gate.kind,
      blocking: gate.blocking !== false,
      pattern: gate.pattern?.trim() ?? "",
      flags: gate.flags?.trim() ?? "",
      jsonPath: gate.jsonPath?.trim() ?? "",
      artifactPath: gate.artifactPath?.trim() ?? "",
      message: gate.message?.trim() ?? ""
    } satisfies NonNullable<PipelineInput["qualityGates"]>[number];

    const dedupeKey = `${normalized.name.toLowerCase()}|${normalized.kind}|${normalized.targetStepId}|${normalized.pattern}|${
      normalized.jsonPath
    }|${normalized.artifactPath}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    gates.push(normalized);
  }

  return gates.slice(0, 80);
}

function gateDedupeKey(gate: NonNullable<PipelineInput["qualityGates"]>[number]): string {
  return `${gate.name.toLowerCase()}|${gate.kind}|${gate.targetStepId}|${gate.pattern}|${gate.flags}|${gate.jsonPath}|${gate.artifactPath}`;
}

function pushUniqueGate(
  gates: NonNullable<PipelineInput["qualityGates"]>,
  seen: Set<string>,
  gate: Omit<NonNullable<PipelineInput["qualityGates"]>[number], "id">
): void {
  const normalized = {
    id: nanoid(),
    ...gate
  } satisfies NonNullable<PipelineInput["qualityGates"]>[number];

  const key = gateDedupeKey(normalized);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  gates.push(normalized);
}

export function withAutoQualityGates(
  gates: PipelineInput["qualityGates"],
  stepRecords: DraftStepRecord[],
  prompt: string
): PipelineInput["qualityGates"] {
  const normalized = Array.isArray(gates) ? [...gates] : [];
  const seen = new Set(
    normalized.map((gate) => gateDedupeKey(gate as NonNullable<PipelineInput["qualityGates"]>[number]))
  );
  const strictMode = inferStrictQualityMode(prompt);

  const reviewLikeSteps = stepRecords.filter((step) => step.role === "review" || step.role === "tester");
  let targetSteps =
    reviewLikeSteps.length > 0
      ? reviewLikeSteps
      : strictMode
        ? stepRecords.length > 0
          ? [stepRecords[stepRecords.length - 1]]
          : []
        : [];

  if (targetSteps.length === 0 && normalized.length === 0 && stepRecords.length > 0) {
    targetSteps = [stepRecords[stepRecords.length - 1]];
  }

  for (const step of targetSteps) {
    const targetStepId = typeof step.id === "string" && step.id.trim().length > 0 ? step.id : "any_step";
    const outputFormat = step.outputFormat === "json" ? "json" : "markdown";

    if (outputFormat === "json") {
      pushUniqueGate(normalized, seen, {
        name: `${step.name} exposes status field`,
        targetStepId,
        kind: "json_field_exists",
        blocking: true,
        pattern: "",
        flags: "",
        jsonPath: "status",
        artifactPath: "",
        message: ""
      });
    } else {
      pushUniqueGate(normalized, seen, {
        name: `${step.name} emits workflow status`,
        targetStepId,
        kind: "regex_must_match",
        blocking: true,
        pattern: workflowStatusPattern,
        flags: "i",
        jsonPath: "",
        artifactPath: "",
        message: ""
      });
    }
  }

  return normalized.slice(0, 80);
}
