import { getDefaultModelForProvider, type ModelCatalogEntry } from "@/lib/modelCatalog";
import type { PipelinePayload, PipelineRun, ReasoningEffort } from "@/lib/types";
import type { PipelineEditorCanvasLink, PipelineEditorCanvasNode } from "../types";
import { getModelMeta, makeStepName, parseIsoTimestamp, resolveCanvasLinkId, routeConditionMatchesOutcome } from "./editorActions";
import type { EditorModelCatalog } from "./editorTypes";

export function getSelectedStepIndex(draft: PipelinePayload, selectedStepId: string | null): number {
  return draft.steps.findIndex((step) => step.id === selectedStepId);
}

export function getSelectedStep(
  draft: PipelinePayload,
  selectedStepIndex: number
): PipelinePayload["steps"][number] | undefined {
  return selectedStepIndex >= 0 ? draft.steps[selectedStepIndex] : undefined;
}

export function getCanvasNodes(draft: PipelinePayload): PipelineEditorCanvasNode[] {
  return draft.steps.map((step, index) => ({
    id: step.id,
    name: step.name || makeStepName(step.role, index),
    role: step.role,
    providerId: step.providerId,
    model: step.model,
    position: step.position ?? defaultStepPosition(index),
    enableDelegation: step.enableDelegation,
    delegationCount: step.delegationCount,
    fastMode: step.fastMode,
    use1MContext: step.use1MContext,
    enableIsolatedStorage: step.enableIsolatedStorage,
    enableSharedStorage: step.enableSharedStorage
  }));
}

export function getCanvasLinks(draft: PipelinePayload): PipelineEditorCanvasLink[] {
  const validIds = new Set(draft.steps.map((step) => step.id));
  const uniqueDirectional = new Set<string>();

  return draft.links
    .map((link, index) => ({
      id: resolveCanvasLinkId(link, index),
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition ?? "always"
    }))
    .filter(
      (link) =>
        link.sourceStepId !== link.targetStepId &&
        validIds.has(link.sourceStepId) &&
        validIds.has(link.targetStepId)
    )
    .filter((link) => {
      const directionalKey = `${link.sourceStepId}|${link.targetStepId}|${link.condition ?? "always"}`;
      if (uniqueDirectional.has(directionalKey)) {
        return false;
      }

      uniqueDirectional.add(directionalKey);
      return true;
    });
}

export function getAnimatedNodeIds(activeRun: PipelineRun | null | undefined): string[] {
  if (!activeRun || activeRun.status !== "running") {
    return [];
  }

  return activeRun.steps.filter((step) => step.status === "running").map((step) => step.stepId);
}

export function getAnimatedLinkIds(
  activeRun: PipelineRun | null | undefined,
  canvasLinks: PipelineEditorCanvasLink[]
): string[] {
  if (!activeRun || activeRun.status !== "running") {
    return [];
  }

  const runningSteps = activeRun.steps.filter((step) => step.status === "running");
  if (runningSteps.length === 0) {
    return [];
  }

  const runStepById = new Map(activeRun.steps.map((step) => [step.stepId, step]));
  const animated = new Set<string>();

  for (const targetStep of runningSteps) {
    const incomingCandidates = canvasLinks
      .map((link) => {
        if (link.targetStepId !== targetStep.stepId) {
          return null;
        }

        const sourceStep = runStepById.get(link.sourceStepId);
        if (!sourceStep) {
          return null;
        }

        if (sourceStep.status !== "completed" && sourceStep.status !== "failed") {
          return null;
        }

        const sourceFinishedAt = parseIsoTimestamp(sourceStep.finishedAt);

        return {
          linkId: link.id,
          sourceFinishedAt,
          conditionMatched: routeConditionMatchesOutcome(link.condition, sourceStep.workflowOutcome)
        };
      })
      .filter(
        (entry): entry is { linkId: string; sourceFinishedAt: number | null; conditionMatched: boolean } =>
          entry !== null
      );

    if (incomingCandidates.length === 0) {
      continue;
    }

    const matchedCandidates = incomingCandidates.filter((entry) => entry.conditionMatched);
    const effectiveCandidates = matchedCandidates.length > 0 ? matchedCandidates : incomingCandidates;
    const timestampedCandidates = effectiveCandidates.filter(
      (entry): entry is { linkId: string; sourceFinishedAt: number; conditionMatched: boolean } =>
        entry.sourceFinishedAt !== null
    );

    if (timestampedCandidates.length === 0) {
      for (const entry of effectiveCandidates) {
        animated.add(entry.linkId);
      }
      continue;
    }

    const latestFinishedAt = Math.max(...timestampedCandidates.map((entry) => entry.sourceFinishedAt));
    for (const entry of timestampedCandidates) {
      if (latestFinishedAt - entry.sourceFinishedAt <= 1500) {
        animated.add(entry.linkId);
      }
    }
  }

  return [...animated];
}

export function getSelectedModelMeta(
  draft: PipelinePayload,
  selectedStepId: string | null,
  modelCatalog: EditorModelCatalog
): ModelCatalogEntry | undefined {
  const selectedIndex = getSelectedStepIndex(draft, selectedStepId);
  const selectedStep = getSelectedStep(draft, selectedIndex);
  return selectedStep ? getModelMeta(modelCatalog, selectedStep.providerId, selectedStep.model) : undefined;
}

export function getReasoningModes(selectedModelMeta: ModelCatalogEntry | undefined): ReasoningEffort[] {
  return selectedModelMeta?.reasoningEfforts ?? ["minimal", "low", "medium", "high", "xhigh"];
}

export function getProviderDefaultModel(selectedStep: PipelinePayload["steps"][number] | undefined): string {
  if (!selectedStep) {
    return "";
  }

  return getDefaultModelForProvider(selectedStep.providerId);
}

export function getStepNameById(draft: PipelinePayload): Map<string, string> {
  return new Map(draft.steps.map((step) => [step.id, step.name || step.role]));
}

export function getOutgoingLinks(
  draft: PipelinePayload,
  selectedStep: PipelinePayload["steps"][number] | undefined
): PipelinePayload["links"] {
  if (!selectedStep) {
    return [];
  }
  return draft.links.filter((link) => link.sourceStepId === selectedStep.id);
}

export function getIncomingLinks(
  draft: PipelinePayload,
  selectedStep: PipelinePayload["steps"][number] | undefined
): PipelinePayload["links"] {
  if (!selectedStep) {
    return [];
  }
  return draft.links.filter((link) => link.targetStepId === selectedStep.id);
}

function defaultStepPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + index * 280,
    y: 130 + (index % 2 === 0 ? 0 : 24)
  };
}
