import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { autoLayoutPipelineDraftSmart } from "@/lib/flowLayout";
import type { PipelinePayload, LinkCondition } from "@/lib/types";
import type {
  PipelineEditorCanvasSelection,
  PipelineEditorProps,
  PipelineEditorState
} from "./types";
import {
  getAnimatedLinkIds,
  getAnimatedNodeIds,
  getCanvasLinks,
  getCanvasNodes,
  getIncomingLinks,
  getOutgoingLinks,
  getProviderDefaultModel,
  getReasoningModes,
  getSelectedModelMeta,
  getSelectedStep,
  getSelectedStepIndex,
  getStepNameById
} from "./state/editorSelectors";
import {
  applyAddConnectionFromSelectedStep,
  applyCanvasConnectNodes,
  applyMoveNode,
  applyMoveNodes,
  applyPatchSelectedStep,
  applyRemoveLinkById,
  applyRemoveStepsByIds,
  applyUpdateConnectionCondition
} from "./state/editorReducer";

export function usePipelineEditorState({
  draft,
  activeRun,
  readOnly = false,
  modelCatalog,
  onChange,
  onStepPanelChange,
  stepPanelBlocked
}: PipelineEditorProps): PipelineEditorState {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [pendingTargetId, setPendingTargetId] = useState<string>("");
  const [pendingCondition, setPendingCondition] = useState<LinkCondition>("always");

  useEffect(() => {
    const validStepIds = new Set(draft.steps.map((step) => step.id));
    setSelectedStepIds((current) => current.filter((stepId) => validStepIds.has(stepId)));
    setSelectedStepId((current) => (current && validStepIds.has(current) ? current : null));
  }, [draft.steps]);

  const canvasLinks = useMemo(() => getCanvasLinks(draft), [draft.links, draft.steps]);

  useEffect(() => {
    const validLinkIds = new Set(canvasLinks.map((link) => link.id));
    setSelectedLinkId((current) => (current && validLinkIds.has(current) ? current : null));
  }, [canvasLinks]);

  const selectedStepIndex = useMemo(() => getSelectedStepIndex(draft, selectedStepId), [draft.steps, selectedStepId]);
  const selectedStep = useMemo(
    () => getSelectedStep(draft, selectedStepIndex),
    [draft.steps, selectedStepIndex]
  );
  const isSingleStepPanelOpen = !!selectedStep && selectedStepIds.length === 1;

  useEffect(() => {
    if (!selectedStep) {
      setPendingTargetId("");
      setPendingCondition("always");
      return;
    }

    const fallback = draft.steps.find((step) => step.id !== selectedStep.id)?.id ?? "";
    setPendingTargetId((current) => {
      if (current && current !== selectedStep.id && draft.steps.some((step) => step.id === current)) {
        return current;
      }
      return fallback;
    });
    setPendingCondition("always");
  }, [draft.steps, selectedStep]);

  useLayoutEffect(() => {
    onStepPanelChange?.(isSingleStepPanelOpen);
  }, [isSingleStepPanelOpen, onStepPanelChange]);

  useEffect(() => {
    if (stepPanelBlocked && selectedStepId) {
      setSelectedStepId(null);
      setSelectedStepIds([]);
    }
  }, [stepPanelBlocked, selectedStepId]);

  const canvasNodes = useMemo(() => getCanvasNodes(draft), [draft.steps]);

  const animatedNodeIds = useMemo(() => getAnimatedNodeIds(activeRun), [activeRun]);
  const animatedLinkIds = useMemo(() => getAnimatedLinkIds(activeRun, canvasLinks), [activeRun, canvasLinks]);

  const selectedModelMeta = useMemo(() => {
    return getSelectedModelMeta(draft, selectedStepId, modelCatalog);
  }, [draft, selectedStepId, modelCatalog]);
  const reasoningModes = useMemo(() => getReasoningModes(selectedModelMeta), [selectedModelMeta]);
  const providerDefaultModel = useMemo(() => getProviderDefaultModel(selectedStep), [selectedStep]);
  const stepNameById = useMemo(() => getStepNameById(draft), [draft.steps]);
  const outgoingLinks = useMemo(() => getOutgoingLinks(draft, selectedStep), [draft.links, selectedStep]);
  const incomingLinks = useMemo(() => getIncomingLinks(draft, selectedStep), [draft.links, selectedStep]);

  const removeStepsByIds = useCallback(
    (stepIds: string[]) => {
      if (readOnly) {
        return;
      }

      if (stepIds.length === 0) {
        return;
      }

      onChange(applyRemoveStepsByIds(draft, stepIds, modelCatalog));
      setSelectedStepId(null);
      setSelectedStepIds([]);
      setSelectedLinkId(null);
    },
    [draft, modelCatalog, onChange, readOnly]
  );

  const removeLinkById = useCallback(
    (linkId: string) => {
      if (readOnly) {
        return;
      }

      onChange(applyRemoveLinkById(draft, linkId));
      setSelectedLinkId(null);
    },
    [draft, onChange, readOnly]
  );

  const removeSelectedStep = useCallback(() => {
    if (!selectedStep) {
      return;
    }

    removeStepsByIds([selectedStep.id]);
  }, [removeStepsByIds, selectedStep]);

  const applyAutoLayout = useCallback(() => {
    if (readOnly) {
      return;
    }

    void autoLayoutPipelineDraftSmart(draft).then((nextDraft) => {
      onChange(nextDraft);
    });
  }, [draft, onChange, readOnly]);

  const patchSelectedStep = useCallback(
    (patch: Partial<PipelinePayload["steps"][number]>) => {
      if (!selectedStepId) {
        return;
      }

      onChange(applyPatchSelectedStep(draft, selectedStepId, patch));
    },
    [draft, onChange, selectedStepId]
  );

  const addConnectionFromSelectedStep = useCallback(
    (targetStepId: string, condition: LinkCondition) => {
      if (readOnly || !selectedStepId || !targetStepId) {
        return;
      }

      onChange(applyAddConnectionFromSelectedStep(draft, selectedStepId, targetStepId, condition));
    },
    [draft, onChange, readOnly, selectedStepId]
  );

  const updateConnectionCondition = useCallback(
    (linkId: string, condition: LinkCondition) => {
      if (readOnly) {
        return;
      }

      onChange(applyUpdateConnectionCondition(draft, linkId, condition));
    },
    [draft, onChange, readOnly]
  );

  const handleCanvasSelectionChange = useCallback(
    ({ nodeIds, primaryNodeId, linkId, isDragStart }: PipelineEditorCanvasSelection) => {
      setSelectedStepIds(nodeIds);
      if (!isDragStart) {
        setSelectedStepId(primaryNodeId ?? (nodeIds.length > 0 ? nodeIds[nodeIds.length - 1] : null));
      }
      setSelectedLinkId(linkId);
    },
    []
  );

  const handleCanvasMoveNode = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      if (readOnly) {
        return;
      }

      onChange(applyMoveNode(draft, nodeId, position));
    },
    [draft, onChange, readOnly]
  );

  const handleCanvasMoveNodes = useCallback(
    (updates: Array<{ nodeId: string; position: { x: number; y: number } }>) => {
      if (readOnly) {
        return;
      }

      onChange(applyMoveNodes(draft, updates));
    },
    [draft, onChange, readOnly]
  );

  const handleCanvasConnectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (readOnly) {
        return;
      }

      onChange(applyCanvasConnectNodes(draft, sourceNodeId, targetNodeId));
    },
    [draft, onChange, readOnly]
  );

  useEffect(() => {
    if (readOnly) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (isTypingField) {
        return;
      }

      event.preventDefault();
      if (selectedLinkId) {
        removeLinkById(selectedLinkId);
        return;
      }

      if (selectedStepIds.length > 0) {
        removeStepsByIds(selectedStepIds);
        return;
      }

      if (selectedStepId) {
        removeStepsByIds([selectedStepId]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [readOnly, removeLinkById, removeStepsByIds, selectedLinkId, selectedStepId, selectedStepIds]);

  return {
    selectedStepId,
    selectedStepIds,
    selectedLinkId,
    pendingTargetId,
    pendingCondition,
    setPendingTargetId,
    setPendingCondition,
    setSelectedStepId,
    removeSelectedStep,
    selectedStepIndex,
    selectedStep,
    selectedModelMeta,
    reasoningModes,
    providerDefaultModel,
    canvasNodes,
    canvasLinks,
    animatedNodeIds,
    animatedLinkIds,
    stepNameById,
    outgoingLinks,
    incomingLinks,
    removeStepsByIds,
    removeLinkById,
    applyAutoLayout,
    handleCanvasSelectionChange,
    handleCanvasMoveNode,
    handleCanvasMoveNodes,
    handleCanvasConnectNodes,
    patchSelectedStep,
    addConnectionFromSelectedStep,
    updateConnectionCondition
  };
}
