import { nanoid } from "nanoid";
import { normalizeRunInputs } from "../../runInputs.js";
import {
  MAX_QUALITY_GATES,
  DEFAULT_MAX_LOOPS,
  DEFAULT_MAX_STEP_EXECUTIONS,
  DEFAULT_STAGE_TIMEOUT_MS
} from "./contracts.js";
import { normalizeStepLabel } from "../../stepLabel.js";
import type {
  PipelineInput,
  PipelineQualityGate,
  PipelineRuntimeConfig,
  PipelineScheduleConfig,
  PipelineStep,
  ProviderId,
  ScheduleRunMode
} from "../../types.js";
import { resolveDefaultContextWindow, resolveDefaultModel, resolveReasoning } from "../../modelCatalog.js";
import { defaultStepPosition } from "./contracts.js";
import { isValidTimeZone, normalizeQualityGateKind, normalizeStringList } from "./validators.js";

export function normalizeRuntimeConfig(raw: Partial<PipelineRuntimeConfig> | undefined): PipelineRuntimeConfig {
  return {
    maxLoops:
      typeof raw?.maxLoops === "number" && Number.isFinite(raw.maxLoops)
        ? Math.max(0, Math.min(12, Math.floor(raw.maxLoops)))
        : DEFAULT_MAX_LOOPS,
    maxStepExecutions:
      typeof raw?.maxStepExecutions === "number" && Number.isFinite(raw.maxStepExecutions)
        ? Math.max(4, Math.min(120, Math.floor(raw.maxStepExecutions)))
        : DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs:
      typeof raw?.stageTimeoutMs === "number" && Number.isFinite(raw.stageTimeoutMs)
        ? Math.max(10_000, Math.min(18_000_000, Math.floor(raw.stageTimeoutMs)))
        : DEFAULT_STAGE_TIMEOUT_MS
  };
}

export function normalizeScheduleConfig(raw: Partial<PipelineScheduleConfig> | undefined): PipelineScheduleConfig {
  const cron = typeof raw?.cron === "string" ? raw.cron.trim() : "";
  const requestedTimezone =
    typeof raw?.timezone === "string" && raw.timezone.trim().length > 0 ? raw.timezone.trim() : "UTC";
  const timezone = isValidTimeZone(requestedTimezone) ? requestedTimezone : "UTC";
  const task = typeof raw?.task === "string" ? raw.task.trim() : "";
  const runMode: ScheduleRunMode = raw?.runMode === "quick" ? "quick" : "smart";
  const inputs = normalizeRunInputs(raw?.inputs);

  return {
    enabled: raw?.enabled === true && cron.length > 0,
    cron,
    timezone,
    task,
    runMode,
    inputs
  };
}

export function normalizeStep(
  step: Partial<PipelineStep> & Pick<PipelineStep, "name" | "role" | "prompt">,
  fallbackIndex: number
): PipelineStep {
  const stepId = typeof step.id === "string" && step.id.trim().length > 0 ? step.id.trim() : nanoid();
  const stepName = normalizeStepLabel(step.name, stepId);
  const providerId: ProviderId = step.providerId === "claude" ? "claude" : "openai";
  const model = step.model && step.model.length > 0 ? step.model : resolveDefaultModel(providerId);
  const use1MContext = step.use1MContext === true;
  const fallbackPosition = defaultStepPosition(fallbackIndex);
  const defaultContextWindow = resolveDefaultContextWindow(providerId, model);
  let contextWindowTokens =
    typeof step.contextWindowTokens === "number" && step.contextWindowTokens > 0
      ? Math.floor(step.contextWindowTokens)
      : defaultContextWindow;

  if (!step.use1MContext && providerId === "claude" && contextWindowTokens >= 1_000_000) {
    contextWindowTokens = defaultContextWindow;
  }

  return {
    id: stepId,
    name: stepName,
    role: step.role,
    prompt: step.prompt,
    providerId,
    model,
    reasoningEffort: resolveReasoning(providerId, step.reasoningEffort, model, "medium"),
    fastMode: step.fastMode === true,
    use1MContext,
    contextWindowTokens: step.use1MContext ? Math.max(contextWindowTokens, 1_000_000) : contextWindowTokens,
    position: {
      x:
        typeof step.position?.x === "number" && Number.isFinite(step.position.x)
          ? Math.round(step.position.x)
          : fallbackPosition.x,
      y:
        typeof step.position?.y === "number" && Number.isFinite(step.position.y)
          ? Math.round(step.position.y)
          : fallbackPosition.y
    },
    contextTemplate:
      step.contextTemplate && step.contextTemplate.length > 0
        ? step.contextTemplate
        : "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}",
    enableDelegation: step.enableDelegation === true,
    delegationCount: typeof step.delegationCount === "number" && step.delegationCount > 0 ? step.delegationCount : 2,
    enableIsolatedStorage: step.enableIsolatedStorage === true,
    enableSharedStorage: step.enableSharedStorage === true,
    enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
      ? step.enabledMcpServerIds
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, 16)
      : [],
    outputFormat: step.outputFormat === "json" ? "json" : "markdown",
    requiredOutputFields: normalizeStringList(step.requiredOutputFields),
    requiredOutputFiles: normalizeStringList(step.requiredOutputFiles),
    scenarios: normalizeStringList(step.scenarios, 20),
    skipIfArtifacts: normalizeStringList(step.skipIfArtifacts),
    policyProfileIds: normalizeStringList(step.policyProfileIds, 20),
    cacheBypassInputKeys: normalizeStringList(step.cacheBypassInputKeys, 20),
    cacheBypassOrchestratorPromptPatterns: normalizeStringList(step.cacheBypassOrchestratorPromptPatterns, 20)
  };
}

export function normalizeQualityGates(
  rawGates: PipelineInput["qualityGates"],
  steps: PipelineStep[]
): PipelineQualityGate[] {
  if (!Array.isArray(rawGates) || rawGates.length === 0) {
    return [];
  }

  const validStepIds = new Set(steps.map((step) => step.id));
  const seen = new Set<string>();
  const gates: PipelineQualityGate[] = [];

  for (const rawGate of rawGates) {
    if (!rawGate || typeof rawGate !== "object") {
      continue;
    }

    const name =
      typeof (rawGate as { name?: unknown }).name === "string" && (rawGate as { name: string }).name.trim().length > 0
        ? (rawGate as { name: string }).name.trim()
        : "Quality gate";
    const kind = normalizeQualityGateKind((rawGate as { kind?: unknown }).kind);
    const rawTarget = (rawGate as { targetStepId?: unknown }).targetStepId;
    const targetStepId =
      rawTarget === "any_step"
        ? "any_step"
        : typeof rawTarget === "string" && validStepIds.has(rawTarget)
          ? rawTarget
          : "any_step";
    const rawGateId = typeof (rawGate as { id?: unknown }).id === "string" ? (rawGate as { id: string }).id.trim() : "";

    const normalized: PipelineQualityGate = {
      id: rawGateId.length > 0 ? rawGateId : nanoid(),
      name,
      targetStepId,
      kind,
      blocking: (rawGate as { blocking?: unknown }).blocking !== false,
      pattern:
        typeof rawGate === "object" && typeof (rawGate as { pattern?: unknown }).pattern === "string"
          ? (rawGate as { pattern: string }).pattern
          : "",
      flags:
        typeof rawGate === "object" && typeof (rawGate as { flags?: unknown }).flags === "string"
          ? (rawGate as { flags: string }).flags
          : "",
      jsonPath:
        typeof rawGate === "object" && typeof (rawGate as { jsonPath?: unknown }).jsonPath === "string"
          ? (rawGate as { jsonPath: string }).jsonPath
          : "",
      artifactPath:
        typeof rawGate === "object" && typeof (rawGate as { artifactPath?: unknown }).artifactPath === "string"
          ? (rawGate as { artifactPath: string }).artifactPath
          : "",
      message:
        typeof rawGate === "object" && typeof (rawGate as { message?: unknown }).message === "string"
          ? (rawGate as { message: string }).message
          : ""
    };

    const dedupeKey = `${normalized.name.toLowerCase()}|${normalized.kind}|${normalized.targetStepId}|${normalized.pattern}|${normalized.jsonPath}|${normalized.artifactPath}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    gates.push(normalized);

    if (gates.length >= MAX_QUALITY_GATES) {
      break;
    }
  }

  return gates;
}
