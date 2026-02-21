import { getDefaultContextWindowForModel, getDefaultModelForProvider } from "@/lib/modelCatalog";
import { normalizeSmartRunInputs } from "@/lib/smartRunInputs";
import type {
  LinkCondition,
  Pipeline,
  PipelinePayload,
  PipelineRuntimeConfig,
  ProviderId,
  ProviderOAuthStatus,
  RunStatus
} from "@/lib/types";

export type ProviderOAuthStatusMap = Record<ProviderId, ProviderOAuthStatus | null>;
export type ProviderOAuthMessageMap = Record<ProviderId, string>;

const DEFAULT_MAX_LOOPS = 2;
const DEFAULT_MAX_STEP_EXECUTIONS = 18;
const DEFAULT_STAGE_TIMEOUT_MS = 240000;
const DEFAULT_SCHEDULE_TIMEZONE = "UTC";

export function createStepId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createLinkId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDraftWorkflowKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft-${crypto.randomUUID()}`;
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultStepPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + index * 280,
    y: 130 + (index % 2 === 0 ? 0 : 24)
  };
}

export function connectNodes(
  links: PipelinePayload["links"],
  sourceStepId: string,
  targetStepId: string,
  condition: LinkCondition = "always"
): PipelinePayload["links"] {
  if (sourceStepId === targetStepId) {
    return links;
  }

  if (
    links.some(
      (link) =>
        link.sourceStepId === sourceStepId &&
        link.targetStepId === targetStepId &&
        (link.condition ?? "always") === condition
    )
  ) {
    return links;
  }

  return [
    ...links,
    {
      id: createLinkId(),
      sourceStepId,
      targetStepId,
      condition
    }
  ];
}

export function defaultRuntime(): PipelineRuntimeConfig {
  return {
    maxLoops: DEFAULT_MAX_LOOPS,
    maxStepExecutions: DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs: DEFAULT_STAGE_TIMEOUT_MS
  };
}

export function normalizeRuntime(
  runtime: Pipeline["runtime"] | PipelinePayload["runtime"] | undefined
): PipelineRuntimeConfig {
  return {
    maxLoops: Math.max(0, Math.min(12, Math.floor(runtime?.maxLoops ?? DEFAULT_MAX_LOOPS))),
    maxStepExecutions: Math.max(4, Math.min(120, Math.floor(runtime?.maxStepExecutions ?? DEFAULT_MAX_STEP_EXECUTIONS))),
    stageTimeoutMs: Math.max(10_000, Math.min(1_200_000, Math.floor(runtime?.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS)))
  };
}

export function defaultSchedule(): Pipeline["schedule"] {
  return {
    enabled: false,
    cron: "",
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    task: "",
    runMode: "smart",
    inputs: {} as Record<string, string>
  };
}

export function normalizeSchedule(
  schedule: Pipeline["schedule"] | PipelinePayload["schedule"] | undefined
): Pipeline["schedule"] {
  const cron = typeof schedule?.cron === "string" ? schedule.cron.trim() : "";
  const timezone =
    typeof schedule?.timezone === "string" && schedule.timezone.trim().length > 0
      ? schedule.timezone.trim()
      : DEFAULT_SCHEDULE_TIMEZONE;
  const task = typeof schedule?.task === "string" ? schedule.task : "";
  const runMode: Pipeline["schedule"]["runMode"] = schedule?.runMode === "quick" ? "quick" : "smart";
  const inputs = normalizeSmartRunInputs(schedule?.inputs);

  return {
    enabled: schedule?.enabled === true && cron.length > 0,
    cron,
    timezone,
    task,
    runMode,
    inputs
  };
}

export function isValidTimeZoneValue(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function createOrchestratorStep(index: number): PipelinePayload["steps"][number] {
  const providerId: ProviderId = "openai";
  const model = getDefaultModelForProvider(providerId);

  return {
    id: createStepId(),
    name: `${index + 1}. Main Orchestrator`,
    role: "orchestrator",
    prompt:
      "Act as the main orchestrator. Route work to connected subagents, decide pass/fail routing, and stop only when quality gates pass.",
    providerId,
    model,
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: getDefaultContextWindowForModel(providerId, model),
    position: defaultStepPosition(index),
    contextTemplate: "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}\n\nAll outputs:\n{{all_outputs}}",
    enableDelegation: true,
    delegationCount: 3,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: []
  };
}

export function createDraftStep(index: number): PipelinePayload["steps"][number] {
  const providerId: ProviderId = "openai";
  const model = getDefaultModelForProvider(providerId);

  return {
    id: createStepId(),
    name: `${index + 1}. Analysis Bot`,
    role: "analysis",
    prompt: "Analyze the request and define constraints before planning.",
    providerId,
    model,
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: getDefaultContextWindowForModel(providerId, model),
    position: defaultStepPosition(index),
    contextTemplate: "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}",
    enableDelegation: false,
    delegationCount: 2,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: []
  };
}

export function toDraft(pipeline: Pipeline): PipelinePayload {
  return {
    name: pipeline.name,
    description: pipeline.description,
    steps: pipeline.steps.map((step, index) => ({
      id: step.id,
      name: step.name,
      role: step.role,
      prompt: step.prompt,
      providerId: step.providerId,
      model: step.model,
      reasoningEffort: step.reasoningEffort,
      fastMode: step.fastMode,
      use1MContext: step.use1MContext,
      contextWindowTokens: step.contextWindowTokens,
      position: step.position ?? defaultStepPosition(index),
      contextTemplate: step.contextTemplate,
      enableDelegation: step.enableDelegation,
      delegationCount: step.delegationCount,
      enableIsolatedStorage: step.enableIsolatedStorage,
      enableSharedStorage: step.enableSharedStorage,
      enabledMcpServerIds: step.enabledMcpServerIds,
      outputFormat: step.outputFormat,
      requiredOutputFields: step.requiredOutputFields,
      requiredOutputFiles: step.requiredOutputFiles,
      scenarios: Array.isArray(step.scenarios) ? step.scenarios : [],
      skipIfArtifacts: Array.isArray(step.skipIfArtifacts) ? step.skipIfArtifacts : []
    })),
    links: (pipeline.links ?? []).map((link) => ({
      id: link.id,
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition ?? "always"
    })),
    qualityGates: (pipeline.qualityGates ?? []).map((gate) => ({
      id: gate.id,
      name: gate.name,
      targetStepId: gate.targetStepId,
      kind: gate.kind,
      blocking: gate.blocking,
      pattern: gate.pattern,
      flags: gate.flags,
      jsonPath: gate.jsonPath,
      artifactPath: gate.artifactPath,
      message: gate.message
    })),
    runtime: normalizeRuntime(pipeline.runtime),
    schedule: normalizeSchedule(pipeline.schedule)
  };
}

export function emptyDraft(): PipelinePayload {
  return {
    name: "",
    description: "",
    steps: [createDraftStep(0)],
    links: [],
    qualityGates: [],
    runtime: defaultRuntime(),
    schedule: defaultSchedule()
  };
}

export function isActiveRunStatus(status: RunStatus): boolean {
  return status === "queued" || status === "running" || status === "paused" || status === "awaiting_approval";
}

export function getPipelineSaveValidationError(draft: PipelinePayload): string | null {
  if (draft.name.trim().length < 2) {
    return "Flow name must have at least 2 characters.";
  }

  if (draft.steps.length === 0) {
    return "Add at least one step.";
  }

  if (draft.steps.some((step) => step.prompt.trim().length === 0 || step.name.trim().length === 0)) {
    return "Every step needs a name and prompt.";
  }

  const schedule = normalizeSchedule(draft.schedule);
  if (schedule.enabled && schedule.cron.length === 0) {
    return "Cron expression is required when scheduling is enabled.";
  }

  if (schedule.enabled) {
    const cronSegments = schedule.cron.trim().split(/\s+/).filter((segment) => segment.length > 0);
    if (cronSegments.length !== 5) {
      return "Cron expression must have 5 fields: minute hour day month weekday.";
    }
  }

  if (schedule.enabled && !isValidTimeZoneValue(schedule.timezone)) {
    return `Timezone "${schedule.timezone}" is not valid.`;
  }

  return null;
}
