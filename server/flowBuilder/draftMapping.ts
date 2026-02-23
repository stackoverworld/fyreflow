import { nanoid } from "nanoid";
import { resolveDefaultContextWindow, resolveReasoning } from "../modelCatalog.js";
import {
  defaultContextTemplate,
  defaultRolePrompts,
  orchestratorClaudeModel,
  orchestratorContextWindowCap
} from "./constants.js";
import type { PipelineInput, PipelineLink, PipelineQualityGate, PipelineStep } from "../types.js";
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

function shouldDisableSkipArtifactsForStrictRuns(prompt: string): boolean {
  if (prompt.trim().length === 0) {
    return false;
  }

  const normalized = prompt.toLowerCase();
  const requestsCacheBypass =
    /\bno\s+cache\b/.test(normalized) ||
    /\bdisable\s+cache\b/.test(normalized) ||
    /\bignore\s+cache\b/.test(normalized) ||
    /\bfresh\s+run\b/.test(normalized) ||
    /\bforce\s+rebuild\b/.test(normalized) ||
    /\bfrom\s+scratch\b/.test(normalized);
  if (!requestsCacheBypass) {
    return false;
  }

  return (
    /\ball\s+steps\b/.test(normalized) ||
    /\bentire\s+pipeline\b/.test(normalized) ||
    /\bwhole\s+pipeline\b/.test(normalized) ||
    /\bglobal(?:ly)?\b/.test(normalized) ||
    /\bfull\s+rebuild\b/.test(normalized)
  );
}

function includesDeliveryToken(value: string): boolean {
  return /\bdeliver(y|ed|ing)?\b/i.test(value);
}

function isDeliveryCompletionGate(gate: PipelineQualityGate): boolean {
  if (gate.kind !== "regex_must_match") {
    return false;
  }

  const patternLooksComplete = /\bworkflow_status\b/i.test(gate.pattern) && /\bcomplete\b/i.test(gate.pattern);
  const nameLooksComplete = /\bcomplete\b/i.test(gate.name);
  return patternLooksComplete || (includesDeliveryToken(gate.name) && nameLooksComplete);
}

function findPreferredDeliverySourceStep(
  steps: PipelineStep[],
  links: PipelineLink[],
  deliveryStepId: string
): PipelineStep | null {
  const candidates = steps.filter((step) => step.id !== deliveryStepId);
  if (candidates.length === 0) {
    return null;
  }

  const reviewLike = [...candidates].reverse().find((step) => step.role === "review" || step.role === "tester");
  if (reviewLike) {
    return reviewLike;
  }

  const terminalIds = new Set(
    candidates
      .map((step) => step.id)
      .filter((id) => !links.some((link) => link.sourceStepId === id && link.targetStepId !== deliveryStepId))
  );
  const terminalNonOrchestrator = [...candidates]
    .reverse()
    .find((step) => terminalIds.has(step.id) && step.role !== "orchestrator");
  if (terminalNonOrchestrator) {
    return terminalNonOrchestrator;
  }

  const nonOrchestrator = [...candidates].reverse().find((step) => step.role !== "orchestrator");
  if (nonOrchestrator) {
    return nonOrchestrator;
  }

  return candidates[candidates.length - 1] ?? null;
}

function ensureDeliveryStageForCompletionGates(draft: PipelineInput): PipelineInput {
  if (!Array.isArray(draft.qualityGates) || draft.qualityGates.length === 0) {
    return draft;
  }

  const completionGateIndexes = draft.qualityGates
    .map((gate, index) => ({ gate, index }))
    .filter((entry) => isDeliveryCompletionGate(entry.gate))
    .map((entry) => entry.index);

  if (completionGateIndexes.length === 0) {
    return draft;
  }

  const steps = [...draft.steps];
  const links = [...draft.links];
  let deliveryStep = steps.find((step) => includesDeliveryToken(step.name));

  if (!deliveryStep) {
    const source = findPreferredDeliverySourceStep(steps, links, "__none__");
    if (!source) {
      return draft;
    }

    const maxX = Math.max(...steps.map((step) => step.position.x), 80);
    deliveryStep = {
      id: nanoid(),
      name: "Delivery",
      role: "executor",
      prompt: [
        "Finalize delivery artifacts.",
        "1) Ensure investor-deck.html and investor-deck.pdf are available.",
        "2) If artifacts exist in {{shared_storage_path}}, copy them into {{input.output_dir}}.",
        "3) Write qa-report.md to {{input.output_dir}} with final artifact paths and validation summary.",
        "4) End with exactly: WORKFLOW_STATUS: COMPLETE"
      ].join("\n"),
      providerId: source.providerId,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
      fastMode: source.fastMode,
      use1MContext: source.use1MContext,
      contextWindowTokens: source.contextWindowTokens,
      position: { x: maxX + 320, y: source.position.y },
      contextTemplate: defaultContextTemplate,
      enableDelegation: false,
      delegationCount: 1,
      enableIsolatedStorage: true,
      enableSharedStorage: true,
      enabledMcpServerIds: [],
      outputFormat: "markdown",
      requiredOutputFields: [],
      requiredOutputFiles: [
        "{{input.output_dir}}/investor-deck.html",
        "{{input.output_dir}}/investor-deck.pdf"
      ],
      scenarios: [],
      skipIfArtifacts: [],
      policyProfileIds: [],
      cacheBypassInputKeys: [],
      cacheBypassOrchestratorPromptPatterns: []
    };
    steps.push(deliveryStep);
  }

  const sourceStep = findPreferredDeliverySourceStep(steps, links, deliveryStep.id);
  if (sourceStep) {
    const hasIncoming = links.some((link) => link.targetStepId === deliveryStep!.id);
    if (!hasIncoming) {
      links.push({
        id: nanoid(),
        sourceStepId: sourceStep.id,
        targetStepId: deliveryStep.id,
        condition: "on_pass"
      });
    }
  }

  const qualityGates = draft.qualityGates.map((gate, index) =>
    completionGateIndexes.includes(index)
      ? {
          ...gate,
          targetStepId: deliveryStep!.id
        }
      : gate
  );

  return {
    ...draft,
    steps,
    links,
    qualityGates
  };
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
  const disableSkipArtifacts = shouldDisableSkipArtifactsForStrictRuns(request.prompt);
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
    const policyProfileIds = normalizeStringArray(step.policyProfileIds, 20) ?? [];
    const cacheBypassInputKeys = normalizeStringArray(step.cacheBypassInputKeys, 20) ?? [];
    const cacheBypassOrchestratorPromptPatterns =
      normalizeStringArray(step.cacheBypassOrchestratorPromptPatterns, 20) ?? [];
    const configuredSkipIfArtifacts = normalizeStringArray(step.skipIfArtifacts, 40) ?? [];
    const skipIfArtifacts = disableSkipArtifacts && role !== "orchestrator" ? [] : configuredSkipIfArtifacts;
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
      skipIfArtifacts,
      policyProfileIds,
      cacheBypassInputKeys,
      cacheBypassOrchestratorPromptPatterns
    } satisfies PipelineStep;
  });

  const draft: PipelineInput = {
    name: spec.name?.trim() || "Generated Agent Flow",
    description: spec.description?.trim() || "AI-generated workflow graph.",
    steps: stepRecords,
    links: buildLinks(spec, stepRecords),
    qualityGates: withAutoQualityGates(buildQualityGates(spec, stepRecords), stepRecords, request.prompt),
    runtime,
    schedule
  };

  return ensureDeliveryStageForCompletionGates(draft);
}

export function buildFlowDraftFromExisting(
  spec: GeneratedFlowSpec,
  request: DraftBuildRequest,
  currentDraft: PipelineInput
): PipelineInput {
  const disableSkipArtifacts = shouldDisableSkipArtifactsForStrictRuns(request.prompt);
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
    const policyProfileIds =
      normalizeStringArray(step.policyProfileIds, 20) ??
      (Array.isArray(existing?.policyProfileIds) ? existing.policyProfileIds.slice(0, 20) : []);
    const cacheBypassInputKeys =
      normalizeStringArray(step.cacheBypassInputKeys, 20) ??
      (Array.isArray(existing?.cacheBypassInputKeys) ? existing.cacheBypassInputKeys.slice(0, 20) : []);
    const cacheBypassOrchestratorPromptPatterns =
      normalizeStringArray(step.cacheBypassOrchestratorPromptPatterns, 20) ??
      (Array.isArray(existing?.cacheBypassOrchestratorPromptPatterns)
        ? existing.cacheBypassOrchestratorPromptPatterns.slice(0, 20)
        : []);
    const inheritedSkipIfArtifacts =
      normalizeStringArray(step.skipIfArtifacts, 40) ??
      (Array.isArray(existing?.skipIfArtifacts) ? existing.skipIfArtifacts.slice(0, 40) : []);
    const skipIfArtifacts =
      disableSkipArtifacts && role !== "orchestrator" ? [] : inheritedSkipIfArtifacts;
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
      skipIfArtifacts,
      policyProfileIds,
      cacheBypassInputKeys,
      cacheBypassOrchestratorPromptPatterns
    } satisfies PipelineStep;
  });

  const draft: PipelineInput = {
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

  return ensureDeliveryStageForCompletionGates(draft);
}
