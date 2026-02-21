import {
  getDefaultContextWindowForModel,
  getDefaultModelForProvider
} from "@/lib/modelCatalog";
import type { LinkCondition, PipelinePayload, PipelineRun, ProviderId, ReasoningEffort } from "@/lib/types";
import type { EditorModelCatalog, EditorStepPatch } from "./editorTypes";

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

export function defaultStepPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + index * 280,
    y: 130 + (index % 2 === 0 ? 0 : 24)
  };
}

export function makeStepName(role: PipelinePayload["steps"][number]["role"], index: number): string {
  return `${index + 1}. ${role[0].toUpperCase()}${role.slice(1)} Bot`;
}

export function getModelMeta(
  modelCatalog: EditorModelCatalog,
  providerId: ProviderId,
  modelId: string
) {
  return modelCatalog[providerId].find((entry) => entry.id === modelId);
}

export function normalizeReasoning(
  modelCatalog: EditorModelCatalog,
  providerId: ProviderId,
  modelId: string,
  requested: ReasoningEffort
): ReasoningEffort {
  const model = getModelMeta(modelCatalog, providerId, modelId);
  const supported = model?.reasoningEfforts ?? ["minimal", "low", "medium", "high", "xhigh"];
  if (supported.includes(requested)) {
    return requested;
  }

  if (supported.includes("medium")) {
    return "medium";
  }

  return supported[0] ?? "medium";
}

export function resolvePreferredModel(
  modelCatalog: EditorModelCatalog,
  providerId: ProviderId
): string {
  const preferred = getDefaultModelForProvider(providerId);
  if (modelCatalog[providerId].some((entry) => entry.id === preferred)) {
    return preferred;
  }

  return modelCatalog[providerId][0]?.id ?? preferred;
}

export function updateStepById(
  draft: PipelinePayload,
  stepId: string,
  patch: EditorStepPatch
): PipelinePayload {
  return {
    ...draft,
    steps: draft.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step))
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

export function createStep(index: number, modelCatalog: EditorModelCatalog): PipelinePayload["steps"][number] {
  const providerId: ProviderId = "openai";
  const model = resolvePreferredModel(modelCatalog, providerId);

  return {
    id: createStepId(),
    name: makeStepName("analysis", index),
    role: "analysis",
    prompt: "Analyze requirements and produce structured constraints.",
    providerId,
    model,
    reasoningEffort: normalizeReasoning(modelCatalog, providerId, model, "medium"),
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

export function resolveCanvasLinkId(link: PipelinePayload["links"][number], index: number): string {
  if (link.id && link.id.length > 0) {
    return link.id;
  }

  return `${link.sourceStepId}-${link.targetStepId}-${link.condition ?? "always"}-${index}`;
}

export function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function routeConditionMatchesOutcome(
  condition: LinkCondition | undefined,
  outcome: PipelineRun["steps"][number]["workflowOutcome"]
): boolean {
  if (condition === "on_pass") {
    return outcome === "pass";
  }

  if (condition === "on_fail") {
    return outcome === "fail";
  }

  return true;
}
