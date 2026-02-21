import type { LinkCondition, PipelinePayload } from "@/lib/types";
import { connectNodes, createStep, resolveCanvasLinkId, updateStepById } from "./editorActions";
import type { EditorModelCatalog, EditorNodeMove, EditorStepPatch } from "./editorTypes";

export function applyRemoveStepsByIds(
  draft: PipelinePayload,
  stepIds: string[],
  modelCatalog: EditorModelCatalog
): PipelinePayload {
  const toDelete = new Set(stepIds);
  if (toDelete.size === 0) {
    return draft;
  }

  const nextSteps = draft.steps.filter((step) => !toDelete.has(step.id));
  if (nextSteps.length === 0) {
    const fallback = createStep(0, modelCatalog);
    return {
      ...draft,
      steps: [fallback],
      links: []
    };
  }

  const nextLinks = draft.links.filter(
    (link) => !toDelete.has(link.sourceStepId) && !toDelete.has(link.targetStepId)
  );

  return {
    ...draft,
    steps: nextSteps,
    links: nextLinks
  };
}

export function applyRemoveLinkById(draft: PipelinePayload, linkId: string): PipelinePayload {
  return {
    ...draft,
    links: draft.links.filter((link, index) => resolveCanvasLinkId(link, index) !== linkId)
  };
}

export function applyPatchSelectedStep(
  draft: PipelinePayload,
  selectedStepId: string | null,
  patch: EditorStepPatch
): PipelinePayload {
  if (!selectedStepId) {
    return draft;
  }

  return updateStepById(draft, selectedStepId, patch);
}

export function applyAddConnectionFromSelectedStep(
  draft: PipelinePayload,
  selectedStepId: string | null,
  targetStepId: string,
  condition: LinkCondition
): PipelinePayload {
  if (!selectedStepId || !targetStepId) {
    return draft;
  }

  return {
    ...draft,
    links: connectNodes(draft.links, selectedStepId, targetStepId, condition)
  };
}

export function applyUpdateConnectionCondition(
  draft: PipelinePayload,
  linkId: string,
  condition: LinkCondition
): PipelinePayload {
  const linkIndex = draft.links.findIndex((link, index) => resolveCanvasLinkId(link, index) === linkId);
  if (linkIndex < 0) {
    return draft;
  }

  return {
    ...draft,
    links: draft.links.map((entry, index) => (index === linkIndex ? { ...entry, condition } : entry))
  };
}

export function applyMoveNode(
  draft: PipelinePayload,
  nodeId: string,
  position: { x: number; y: number }
): PipelinePayload {
  return {
    ...draft,
    steps: draft.steps.map((step) => (step.id === nodeId ? { ...step, position } : step))
  };
}

export function applyMoveNodes(draft: PipelinePayload, updates: EditorNodeMove[]): PipelinePayload {
  const updatesById = new Map(updates.map((entry) => [entry.nodeId, entry.position]));
  return {
    ...draft,
    steps: draft.steps.map((step) => {
      const position = updatesById.get(step.id);
      return position ? { ...step, position } : step;
    })
  };
}

export function applyCanvasConnectNodes(
  draft: PipelinePayload,
  sourceNodeId: string,
  targetNodeId: string
): PipelinePayload {
  return {
    ...draft,
    links: connectNodes(draft.links, sourceNodeId, targetNodeId)
  };
}
