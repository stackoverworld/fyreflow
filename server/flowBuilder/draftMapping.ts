import { nanoid } from "nanoid";
import { resolveDefaultContextWindow, resolveReasoning } from "../modelCatalog.js";
import {
  defaultContextTemplate,
  defaultRolePrompts,
  orchestratorClaudeModel,
  orchestratorContextWindowCap
} from "./constants.js";
import type { PipelineInput, PipelineStep } from "../types.js";
import {
  normalizeRef,
  normalizeRuntime,
  normalizeSchedule,
  normalizeStringArray
} from "./normalizers.js";
import type { GeneratedFlowSpec } from "./schema.js";
import type { DraftBuildRequest } from "./draftMapping/contracts.js";
import {
  buildLinks,
  buildQualityGates,
  clampDelegationCount,
  defaultDelegationCount,
  withAutoQualityGates
} from "./draftMapping/mappers.js";

type StorageResolutionInput = {
  role: PipelineStep["role"];
  explicit?: boolean;
  existing?: boolean;
  requiredOutputFiles: string[];
  skipIfArtifacts: string[];
};

function preserveLinksFromCurrentDraft(
  currentLinks: PipelineInput["links"] | undefined,
  stepRecords: PipelineInput["steps"]
): PipelineInput["links"] {
  if (!Array.isArray(currentLinks) || currentLinks.length === 0) {
    return [];
  }

  const validStepIds = new Set(
    stepRecords
      .map((step) => step.id)
      .filter((stepId): stepId is string => typeof stepId === "string" && stepId.trim().length > 0)
  );
  const dedupe = new Set<string>();
  const preserved: PipelineInput["links"] = [];

  for (const link of currentLinks) {
    const sourceStepId = typeof link.sourceStepId === "string" ? link.sourceStepId : "";
    const targetStepId = typeof link.targetStepId === "string" ? link.targetStepId : "";
    if (!validStepIds.has(sourceStepId) || !validStepIds.has(targetStepId) || sourceStepId === targetStepId) {
      continue;
    }

    const condition = link.condition ?? "always";
    const dedupeKey = `${sourceStepId}->${targetStepId}:${condition}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);

    preserved.push({
      id: typeof link.id === "string" && link.id.trim().length > 0 ? link.id : nanoid(),
      sourceStepId,
      targetStepId,
      condition
    });
  }

  return preserved;
}

function hasStoragePlaceholder(value: string, key: "shared" | "isolated"): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }

  return key === "shared"
    ? normalized.includes("{{shared_storage_path}}")
    : normalized.includes("{{isolated_storage_path}}");
}

function resolveSharedStorageEnabled(input: StorageResolutionInput): boolean {
  if (typeof input.explicit === "boolean") {
    return input.explicit;
  }

  if (input.existing === true) {
    return true;
  }

  const writesArtifacts = input.requiredOutputFiles.length > 0 || input.skipIfArtifacts.length > 0;
  const roleNeedsShared = input.role !== "planner";
  const referencesShared = [...input.requiredOutputFiles, ...input.skipIfArtifacts].some((entry) =>
    hasStoragePlaceholder(entry, "shared")
  );
  const recommended = roleNeedsShared || writesArtifacts || referencesShared;

  if (recommended) {
    return true;
  }

  if (input.existing === false) {
    return false;
  }

  return false;
}

function resolveIsolatedStorageEnabled(input: StorageResolutionInput): boolean {
  if (typeof input.explicit === "boolean") {
    return input.explicit;
  }

  if (input.existing === true) {
    return true;
  }

  const writesArtifacts = input.requiredOutputFiles.length > 0 || input.skipIfArtifacts.length > 0;
  const roleNeedsIsolation =
    input.role === "analysis" || input.role === "orchestrator" || input.role === "executor" || input.role === "tester";
  const referencesIsolated = [...input.requiredOutputFiles, ...input.skipIfArtifacts].some((entry) =>
    hasStoragePlaceholder(entry, "isolated")
  );
  const recommended = roleNeedsIsolation || referencesIsolated || (writesArtifacts && input.role !== "review");

  if (recommended) {
    return true;
  }

  if (input.existing === false) {
    return false;
  }

  return false;
}

export function buildFlowDraft(
  spec: GeneratedFlowSpec,
  request: DraftBuildRequest
): PipelineInput {
  const reasoningEffort = resolveReasoning(request.providerId, request.reasoningEffort, request.model, "medium");
  const baseContext = resolveDefaultContextWindow(request.providerId, request.model);
  const use1MContext = request.providerId === "claude" && request.use1MContext === true;
  const contextWindowTokens = use1MContext ? Math.max(baseContext, 1_000_000) : baseContext;
  const fastMode = request.providerId === "claude" ? request.fastMode === true : false;
  const runtime = normalizeRuntime(spec.runtime);
  const schedule = normalizeSchedule(spec.schedule);

  const stepRecords: PipelineInput["steps"] = spec.steps.map((step, index) => {
    const role = step.role ?? (index === 0 ? "analysis" : "executor");
    const isClaudeOrchestrator = request.providerId === "claude" && role === "orchestrator";
    const stepModel =
      isClaudeOrchestrator && request.model.toLowerCase().includes("opus") ? orchestratorClaudeModel : request.model;
    const stepReasoningEffort = isClaudeOrchestrator ? "low" : reasoningEffort;
    const stepFastMode = fastMode;
    const stepUse1MContext = isClaudeOrchestrator ? false : use1MContext;
    const stepContextWindowTokens = isClaudeOrchestrator
      ? Math.min(contextWindowTokens, orchestratorContextWindowCap)
      : contextWindowTokens;
    const row = Math.floor(index / 4);
    const col = index % 4;
    const requiredOutputFields = normalizeStringArray(step.requiredOutputFields, 40) ?? [];
    const requiredOutputFiles = normalizeStringArray(step.requiredOutputFiles, 40) ?? [];
    const scenarios = normalizeStringArray(step.scenarios, 20) ?? [];
    const skipIfArtifacts = normalizeStringArray(step.skipIfArtifacts, 40) ?? [];
    const enableSharedStorage = resolveSharedStorageEnabled({
      role,
      explicit: typeof step.enableSharedStorage === "boolean" ? step.enableSharedStorage : undefined,
      requiredOutputFiles,
      skipIfArtifacts
    });
    const enableIsolatedStorage = resolveIsolatedStorageEnabled({
      role,
      explicit: typeof step.enableIsolatedStorage === "boolean" ? step.enableIsolatedStorage : undefined,
      requiredOutputFiles,
      skipIfArtifacts
    });

    return {
      id: nanoid(),
      name: step.name,
      role,
      prompt: step.prompt?.trim() || defaultRolePrompts[role],
      providerId: request.providerId,
      model: stepModel,
      reasoningEffort: stepReasoningEffort,
      fastMode: stepFastMode,
      use1MContext: stepUse1MContext,
      contextWindowTokens: stepContextWindowTokens,
      position: {
        x: 80 + col * 280,
        y: 120 + row * 180
      },
      contextTemplate: step.contextTemplate?.trim() || defaultContextTemplate,
      enableDelegation:
        typeof step.enableDelegation === "boolean" ? step.enableDelegation : role === "executor" || role === "orchestrator",
      delegationCount:
        typeof step.delegationCount === "number"
          ? clampDelegationCount(step.delegationCount)
          : defaultDelegationCount(role),
      enableIsolatedStorage,
      enableSharedStorage,
      enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
        ? step.enabledMcpServerIds
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .slice(0, 16)
        : [],
      outputFormat: step.outputFormat === "json" ? "json" : "markdown",
      requiredOutputFields,
      requiredOutputFiles,
      scenarios,
      skipIfArtifacts
    } satisfies PipelineStep;
  });

  return {
    name: spec.name?.trim() || "Generated Agent Flow",
    description: spec.description?.trim() || "AI-generated workflow graph.",
    steps: stepRecords,
    links: buildLinks(spec, stepRecords),
    qualityGates: withAutoQualityGates(buildQualityGates(spec, stepRecords), stepRecords, request.prompt),
    runtime,
    schedule
  };
}

export function buildFlowDraftFromExisting(
  spec: GeneratedFlowSpec,
  request: DraftBuildRequest,
  currentDraft: PipelineInput
): PipelineInput {
  const existingByName = new Map<string, PipelineInput["steps"][number]>();
  for (const step of currentDraft.steps) {
    const key = normalizeRef(step.name);
    if (!existingByName.has(key)) {
      existingByName.set(key, step);
    }
  }

  const stepRecords: PipelineInput["steps"] = spec.steps.map((step, index) => {
    const existing = existingByName.get(normalizeRef(step.name));
    const role = step.role ?? existing?.role ?? (index === 0 ? "analysis" : "executor");

    const existingProviderId =
      existing?.providerId === "openai" || existing?.providerId === "claude" ? existing.providerId : undefined;
    const providerChanged = !!existingProviderId && existingProviderId !== request.providerId;
    const providerId = providerChanged ? request.providerId : existingProviderId ?? request.providerId;

    const existingModel =
      typeof existing?.model === "string" && existing.model.trim().length > 0 ? existing.model : undefined;
    const requestedModel = providerChanged || !existingModel ? request.model : existingModel;
    const isClaudeOrchestrator = providerId === "claude" && role === "orchestrator";
    const model =
      isClaudeOrchestrator && requestedModel.toLowerCase().includes("opus") ? orchestratorClaudeModel : requestedModel;

    const resolvedReasoningEffort = resolveReasoning(
      providerId,
      providerChanged ? request.reasoningEffort : existing?.reasoningEffort ?? request.reasoningEffort,
      model,
      "medium"
    );
    const reasoningEffort = isClaudeOrchestrator ? "low" : resolvedReasoningEffort;
    const baseContext = resolveDefaultContextWindow(providerId, model);

    const resolvedUse1MContext =
      providerId === "claude"
        ? !providerChanged && typeof existing?.use1MContext === "boolean"
          ? existing.use1MContext
          : request.use1MContext === true
        : false;

    const resolvedFastMode =
      providerId === "claude"
        ? !providerChanged && typeof existing?.fastMode === "boolean"
          ? existing.fastMode
          : request.fastMode === true
        : false;

    const use1MContext = isClaudeOrchestrator ? false : resolvedUse1MContext;
    const fastMode = resolvedFastMode;
    const existingContextWindow =
      !providerChanged && typeof existing?.contextWindowTokens === "number" && Number.isFinite(existing.contextWindowTokens)
        ? Math.floor(existing.contextWindowTokens)
        : undefined;

    const resolvedContextWindowTokens =
      existingContextWindow && existingContextWindow > 0
        ? existingContextWindow
        : use1MContext
          ? Math.max(baseContext, 1_000_000)
          : baseContext;
    const contextWindowTokens = isClaudeOrchestrator
      ? Math.min(resolvedContextWindowTokens, orchestratorContextWindowCap)
      : resolvedContextWindowTokens;
    const row = Math.floor(index / 4);
    const col = index % 4;

    const position =
      existing?.position &&
      typeof existing.position.x === "number" &&
      Number.isFinite(existing.position.x) &&
      typeof existing.position.y === "number" &&
      Number.isFinite(existing.position.y)
        ? existing.position
        : {
            x: 80 + col * 280,
            y: 120 + row * 180
          };

    const delegationCount =
      typeof step.delegationCount === "number"
        ? clampDelegationCount(step.delegationCount)
        : typeof existing?.delegationCount === "number" && Number.isFinite(existing.delegationCount)
          ? clampDelegationCount(existing.delegationCount)
          : defaultDelegationCount(role);
    const requiredOutputFields =
      normalizeStringArray(step.requiredOutputFields, 40) ??
      (Array.isArray(existing?.requiredOutputFields) ? existing.requiredOutputFields.slice(0, 40) : []);
    const requiredOutputFiles =
      normalizeStringArray(step.requiredOutputFiles, 40) ??
      (Array.isArray(existing?.requiredOutputFiles) ? existing.requiredOutputFiles.slice(0, 40) : []);
    const scenarios =
      normalizeStringArray(step.scenarios, 20) ??
      (Array.isArray(existing?.scenarios) ? existing.scenarios.slice(0, 20) : []);
    const skipIfArtifacts =
      normalizeStringArray(step.skipIfArtifacts, 40) ??
      (Array.isArray(existing?.skipIfArtifacts) ? existing.skipIfArtifacts.slice(0, 40) : []);
    const enableSharedStorage = resolveSharedStorageEnabled({
      role,
      explicit: typeof step.enableSharedStorage === "boolean" ? step.enableSharedStorage : undefined,
      existing: typeof existing?.enableSharedStorage === "boolean" ? existing.enableSharedStorage : undefined,
      requiredOutputFiles,
      skipIfArtifacts
    });
    const enableIsolatedStorage = resolveIsolatedStorageEnabled({
      role,
      explicit: typeof step.enableIsolatedStorage === "boolean" ? step.enableIsolatedStorage : undefined,
      existing: typeof existing?.enableIsolatedStorage === "boolean" ? existing.enableIsolatedStorage : undefined,
      requiredOutputFiles,
      skipIfArtifacts
    });

    return {
      id: typeof existing?.id === "string" && existing.id.trim().length > 0 ? existing.id : nanoid(),
      name: step.name,
      role,
      prompt: step.prompt?.trim() || existing?.prompt || defaultRolePrompts[role],
      providerId,
      model,
      reasoningEffort,
      fastMode,
      use1MContext,
      contextWindowTokens,
      position,
      contextTemplate:
        typeof step.contextTemplate === "string" && step.contextTemplate.trim().length > 0
          ? step.contextTemplate.trim()
          : typeof existing?.contextTemplate === "string" && existing.contextTemplate.trim().length > 0
            ? existing.contextTemplate
            : defaultContextTemplate,
      enableDelegation:
        typeof step.enableDelegation === "boolean"
          ? step.enableDelegation
          : typeof existing?.enableDelegation === "boolean"
            ? existing.enableDelegation
            : role === "executor" || role === "orchestrator",
      delegationCount,
      enableIsolatedStorage,
      enableSharedStorage,
      enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
        ? step.enabledMcpServerIds
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .slice(0, 16)
        : Array.isArray(existing?.enabledMcpServerIds)
          ? existing.enabledMcpServerIds
              .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
              .map((entry) => entry.trim())
              .slice(0, 16)
          : [],
      outputFormat:
        step.outputFormat === "json"
          ? "json"
          : step.outputFormat === "markdown"
            ? "markdown"
            : existing?.outputFormat === "json"
              ? "json"
              : "markdown",
      requiredOutputFields,
      requiredOutputFiles,
      scenarios,
      skipIfArtifacts
    } satisfies PipelineStep;
  });

  return {
    name: spec.name?.trim() || currentDraft.name || "Generated Agent Flow",
    description: spec.description?.trim() || currentDraft.description || "AI-generated workflow graph.",
    steps: stepRecords,
    links: Array.isArray(spec.links) ? buildLinks(spec, stepRecords) : preserveLinksFromCurrentDraft(currentDraft.links, stepRecords),
    qualityGates:
      withAutoQualityGates(
        Array.isArray(spec.qualityGates) && spec.qualityGates.length > 0
          ? buildQualityGates(spec, stepRecords)
          : Array.isArray(currentDraft.qualityGates)
            ? currentDraft.qualityGates
            : [],
        stepRecords,
        request.prompt
      ),
    runtime: normalizeRuntime(spec.runtime ?? currentDraft.runtime),
    schedule: normalizeSchedule(spec.schedule ?? currentDraft.schedule)
  };
}
