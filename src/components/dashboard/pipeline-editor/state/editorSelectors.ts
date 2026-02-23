import { getDefaultModelForProvider, type ModelCatalogEntry } from "@/lib/modelCatalog";
import {
  buildPotentialDispatchRouteId,
  parsePotentialDispatchRouteId
} from "@/components/dashboard/pipeline-canvas/potentialDispatchRouteId";
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

export function getOptimisticStartingNodeId(
  draft: PipelinePayload,
  activeRun: PipelineRun | null | undefined,
  startingRun: boolean
): string | null {
  const startupPhaseActive = activeRun ? activeRun.status === "queued" : startingRun;
  if (!startupPhaseActive) {
    return null;
  }

  const orchestratorRunStep = activeRun?.steps.find((step) => step.role === "orchestrator");
  if (orchestratorRunStep) {
    return orchestratorRunStep.stepId;
  }

  const orchestratorDraftStep = draft.steps.find((step) => step.role === "orchestrator");
  if (orchestratorDraftStep) {
    return orchestratorDraftStep.id;
  }

  if (activeRun?.steps[0]?.stepId) {
    return activeRun.steps[0].stepId;
  }

  return draft.steps[0]?.id ?? null;
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
  const FALLBACK_HANDOFF_WINDOW_MS = 5_000;

  for (const targetStep of runningSteps) {
    if (targetStep.triggeredByStepId && targetStep.triggeredByStepId.length > 0) {
      const visualTriggerSourceStepId = resolveVisualTriggerSourceStepId(
        targetStep.triggeredByStepId,
        runStepById
      );
      if (targetStep.triggeredByReason === "disconnected_fallback") {
        const fallbackSourceStep = runStepById.get(visualTriggerSourceStepId);
        if (fallbackSourceStep?.role === "orchestrator") {
          animated.add(buildPotentialDispatchRouteId(visualTriggerSourceStepId, targetStep.stepId));
          continue;
        }
      }

      const triggeredLinks = canvasLinks.filter(
        (link) =>
          link.sourceStepId === visualTriggerSourceStepId &&
          link.targetStepId === targetStep.stepId
      );
      if (triggeredLinks.length > 0) {
        for (const link of triggeredLinks) {
          animated.add(link.id);
        }
      } else {
        const triggeringStep = runStepById.get(visualTriggerSourceStepId);
        if (triggeringStep?.role === "orchestrator") {
          const targetStartedAt = parseIsoTimestamp(targetStep.startedAt);
          const recentIncomingFallbackLinks =
            targetStartedAt === null
              ? []
              : selectAnimatedIncomingLinkIds(
                  getIncomingLinkCandidates(targetStep.stepId, canvasLinks, runStepById).filter(
                    (entry) =>
                      !entry.sourceWasSkipped &&
                      entry.sourceFinishedAt !== null &&
                      targetStartedAt >= entry.sourceFinishedAt &&
                      targetStartedAt - entry.sourceFinishedAt <= FALLBACK_HANDOFF_WINDOW_MS
                  )
                );

          if (recentIncomingFallbackLinks.length > 0) {
            for (const linkId of recentIncomingFallbackLinks) {
              animated.add(linkId);
            }
          } else {
            animated.add(buildPotentialDispatchRouteId(visualTriggerSourceStepId, targetStep.stepId));
          }
        }
      }
      continue;
    }

    const incomingAnimatedLinkIds = selectAnimatedIncomingLinkIds(
      getIncomingLinkCandidates(targetStep.stepId, canvasLinks, runStepById)
    );
    for (const linkId of incomingAnimatedLinkIds) {
      animated.add(linkId);
    }
  }

  return [...animated];
}

interface IncomingLinkCandidate {
  linkId: string;
  sourceFinishedAt: number | null;
  conditionMatched: boolean;
  sourceWasSkipped: boolean;
}

function getIncomingLinkCandidates(
  targetStepId: string,
  canvasLinks: PipelineEditorCanvasLink[],
  runStepById: Map<string, PipelineRun["steps"][number]>
): IncomingLinkCandidate[] {
  return canvasLinks
    .map((link) => {
      if (link.targetStepId !== targetStepId) {
        return null;
      }

      const sourceStep = runStepById.get(link.sourceStepId);
      if (!sourceStep) {
        return null;
      }

      if (sourceStep.status !== "completed" && sourceStep.status !== "failed") {
        return null;
      }

      return {
        linkId: link.id,
        sourceFinishedAt: parseIsoTimestamp(sourceStep.finishedAt),
        conditionMatched: routeConditionMatchesOutcome(link.condition, sourceStep.workflowOutcome),
        sourceWasSkipped: isStepRunSkipped(sourceStep)
      };
    })
    .filter((entry): entry is IncomingLinkCandidate => entry !== null);
}

function selectAnimatedIncomingLinkIds(candidates: IncomingLinkCandidate[]): string[] {
  if (candidates.length === 0) {
    return [];
  }

  const matchedCandidates = candidates.filter((entry) => entry.conditionMatched);
  const effectiveCandidates = matchedCandidates.length > 0 ? matchedCandidates : candidates;
  const timestampedCandidates = effectiveCandidates.filter(
    (entry): entry is IncomingLinkCandidate & { sourceFinishedAt: number } => entry.sourceFinishedAt !== null
  );

  if (timestampedCandidates.length === 0) {
    return effectiveCandidates.map((entry) => entry.linkId);
  }

  const latestFinishedAt = Math.max(...timestampedCandidates.map((entry) => entry.sourceFinishedAt));
  return timestampedCandidates
    .filter((entry) => latestFinishedAt - entry.sourceFinishedAt <= 1_500)
    .map((entry) => entry.linkId);
}

function isStepRunSkipped(step: PipelineRun["steps"][number]): boolean {
  if (!step.output) {
    return false;
  }

  return /(^|\n)STEP_STATUS:\s*SKIPPED\b/i.test(step.output);
}

function resolveVisualTriggerSourceStepId(
  triggeredByStepId: string,
  runStepById: Map<string, PipelineRun["steps"][number]>
): string {
  const visited = new Set<string>();
  let currentSourceStepId = triggeredByStepId;

  while (currentSourceStepId.length > 0 && !visited.has(currentSourceStepId)) {
    visited.add(currentSourceStepId);
    const sourceStep = runStepById.get(currentSourceStepId);
    if (!sourceStep || !isStepRunSkipped(sourceStep) || !sourceStep.triggeredByStepId) {
      return currentSourceStepId;
    }
    currentSourceStepId = sourceStep.triggeredByStepId;
  }

  return triggeredByStepId;
}

export interface DebugPreviewDispatchAnimation {
  routeId: string | null;
  nodeIds: string[];
}

export function getDebugPreviewDispatchAnimation(
  debugPreviewDispatchRouteId: string | null | undefined,
  canvasNodes: PipelineEditorCanvasNode[]
): DebugPreviewDispatchAnimation {
  if (!debugPreviewDispatchRouteId) {
    return { routeId: null, nodeIds: [] };
  }

  const parsed = parsePotentialDispatchRouteId(debugPreviewDispatchRouteId);
  if (!parsed) {
    return { routeId: null, nodeIds: [] };
  }

  const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
  const orchestratorNode = nodeById.get(parsed.orchestratorId);
  const targetNode = nodeById.get(parsed.targetNodeId);
  if (!orchestratorNode || orchestratorNode.role !== "orchestrator") {
    return { routeId: null, nodeIds: [] };
  }

  if (!targetNode || targetNode.role === "orchestrator" || targetNode.id === orchestratorNode.id) {
    return { routeId: null, nodeIds: [] };
  }

  return {
    routeId: buildPotentialDispatchRouteId(orchestratorNode.id, targetNode.id),
    nodeIds: [orchestratorNode.id, targetNode.id]
  };
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
