import type { Dispatch, SetStateAction } from "react";
import { createDraftWorkflowKey, emptyDraft, normalizeRuntime, normalizeSchedule, toDraft } from "@/lib/pipelineDraft";
import { createPipeline, deletePipeline, updatePipeline } from "@/lib/api";
import { moveAiChatHistory } from "@/lib/aiChatStorage";
import { moveRunDraft } from "@/lib/runDraftStorage";
import type { WorkspacePanel } from "@/app/useNavigationState";
import type { DashboardState, PipelinePayload, SmartRunPlan } from "@/lib/types";
import { withDraftEditLock } from "../../appStateReducers";
import { hasPipelineRunActivity } from "../../appStateRunHelpers";
import { selectPipelineSaveValidationError } from "../../appStateSelectors";

export function applyEditableDraftChangeAction(
  next: Parameters<typeof withDraftEditLock>[2],
  selectedPipelineEditLocked: boolean,
  applyDraftChange: (next: Parameters<typeof withDraftEditLock>[2]) => void
): void {
  withDraftEditLock(selectedPipelineEditLocked, applyDraftChange, next);
}

export function handleSelectPipelineAction(
  pipelineId: string,
  ctx: {
    pipelines: DashboardState["pipelines"];
    autosaveTimerRef: { current?: number };
    setSelectedPipelineId: Dispatch<SetStateAction<string | null>>;
    resetDraftHistory: (draft: PipelinePayload) => void;
    setBaselineDraft: Dispatch<SetStateAction<PipelinePayload>>;
    setSmartRunPlan: Dispatch<SetStateAction<SmartRunPlan | null>>;
    setScheduleRunPlan: Dispatch<SetStateAction<SmartRunPlan | null>>;
    setNotice: Dispatch<SetStateAction<string>>;
    setActivePanel: Dispatch<SetStateAction<WorkspacePanel>>;
  }
): void {
  const selected = ctx.pipelines.find((pipeline) => pipeline.id === pipelineId);
  if (!selected) {
    return;
  }

  clearTimeout(ctx.autosaveTimerRef.current);
  const nextDraft = toDraft(selected);
  ctx.setSelectedPipelineId(pipelineId);
  ctx.resetDraftHistory(nextDraft);
  ctx.setBaselineDraft(nextDraft);
  ctx.setSmartRunPlan(null);
  ctx.setScheduleRunPlan(null);
  ctx.setNotice("");
  ctx.setActivePanel(null);
}

export function handleCreatePipelineDraftAction(ctx: {
  autosaveTimerRef: { current?: number };
  setDraftWorkflowKey: Dispatch<SetStateAction<string>>;
  setSelectedPipelineId: Dispatch<SetStateAction<string | null>>;
  resetDraftHistory: (draft: PipelinePayload) => void;
  setBaselineDraft: Dispatch<SetStateAction<PipelinePayload>>;
  setIsNewDraft: Dispatch<SetStateAction<boolean>>;
  setSmartRunPlan: Dispatch<SetStateAction<SmartRunPlan | null>>;
  setScheduleRunPlan: Dispatch<SetStateAction<SmartRunPlan | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setActivePanel: Dispatch<SetStateAction<WorkspacePanel>>;
}): void {
  clearTimeout(ctx.autosaveTimerRef.current);
  const nextDraft = emptyDraft();
  ctx.setSelectedPipelineId(null);
  ctx.setDraftWorkflowKey(createDraftWorkflowKey());
  ctx.resetDraftHistory(nextDraft);
  ctx.setBaselineDraft(nextDraft);
  ctx.setIsNewDraft(true);
  ctx.setSmartRunPlan(null);
  ctx.setScheduleRunPlan(null);
  ctx.setNotice("Drafting a new flow.");
  ctx.setActivePanel("flow");
}

export async function handleDeletePipelineAction(
  pipelineId: string,
  ctx: {
    runs: DashboardState["runs"];
    selectedPipelineId: string | null;
    startingRunPipelineId: string | null;
    stoppingRunPipelineId: string | null;
    pausingRunPipelineId: string | null;
    resumingRunPipelineId: string | null;
    setNotice: Dispatch<SetStateAction<string>>;
    setPipelines: Dispatch<SetStateAction<DashboardState["pipelines"]>>;
    pipelines: DashboardState["pipelines"];
    selectPipeline: (pipelineId: string) => void;
    handleCreatePipelineDraft: () => void;
  }
): Promise<void> {
  const hasActiveRun = hasPipelineRunActivity(pipelineId, ctx.runs, {
    startingRunPipelineId: ctx.startingRunPipelineId,
    stoppingRunPipelineId: ctx.stoppingRunPipelineId,
    pausingRunPipelineId: ctx.pausingRunPipelineId,
    resumingRunPipelineId: ctx.resumingRunPipelineId
  });

  if (hasActiveRun) {
    ctx.setNotice("Stop the running flow before deleting it.");
    return;
  }

  try {
    await deletePipeline(pipelineId);
    const nextPipelines = ctx.pipelines.filter((pipeline) => pipeline.id !== pipelineId);
    ctx.setPipelines(nextPipelines);

    if (ctx.selectedPipelineId === pipelineId) {
      if (nextPipelines.length > 0) {
        ctx.selectPipeline(nextPipelines[0].id);
      } else {
        ctx.handleCreatePipelineDraft();
      }
    }

    ctx.setNotice("Flow deleted.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete flow";
    ctx.setNotice(message);
  }
}

export async function handleSavePipelineAction(
  opts: { draftSnapshot?: PipelinePayload; silent?: boolean },
  ctx: {
    draft: PipelinePayload;
    selectPipelineSaveValidationError: typeof selectPipelineSaveValidationError;
    savingPipelineRef: { current: boolean };
    setSavingPipeline: Dispatch<SetStateAction<boolean>>;
    setPipelines: Dispatch<SetStateAction<DashboardState["pipelines"]>>;
    selectedPipelineId: string | null;
    draftWorkflowKey: string;
    isNewDraft: boolean;
    resetDraftHistory?: (draft: PipelinePayload) => void;
    setSelectedPipelineId: Dispatch<SetStateAction<string | null>>;
    setBaselineDraft: Dispatch<SetStateAction<PipelinePayload>>;
    setIsNewDraft: Dispatch<SetStateAction<boolean>>;
    setNotice: Dispatch<SetStateAction<string>>;
    selectedPipelineIdRef: { current: string | null };
    draftWorkflowKeyRef: { current: string };
  }
): Promise<boolean> {
  const draftSnapshot = opts.draftSnapshot ?? ctx.draft;
  const silent = opts.silent ?? false;
  const validationError = ctx.selectPipelineSaveValidationError(draftSnapshot);

  if (validationError) {
    if (!silent) {
      ctx.setNotice(validationError);
    }
    return false;
  }

  if (ctx.savingPipelineRef.current) {
    return false;
  }

  ctx.savingPipelineRef.current = true;
  ctx.setSavingPipeline(true);

  const payload: PipelinePayload = {
    ...draftSnapshot,
    runtime: normalizeRuntime(draftSnapshot.runtime),
    schedule: normalizeSchedule(draftSnapshot.schedule)
  };

  const saveTargetPipelineId = ctx.selectedPipelineId;
  const saveTargetDraftKey = ctx.draftWorkflowKey;
  const savingNewDraft = ctx.isNewDraft || !saveTargetPipelineId;

  try {
    if (savingNewDraft) {
      const response = await createPipeline(payload);
      const created = response.pipeline;
      moveAiChatHistory(saveTargetDraftKey, created.id);
      moveRunDraft(saveTargetDraftKey, created.id);
      ctx.setPipelines((current) => [created, ...current.filter((pipeline) => pipeline.id !== created.id)]);
      if (
        ctx.selectedPipelineIdRef.current === saveTargetPipelineId &&
        ctx.draftWorkflowKeyRef.current === saveTargetDraftKey
      ) {
        ctx.setSelectedPipelineId(created.id);
        ctx.setBaselineDraft(payload);
        ctx.setIsNewDraft(false);
      }

      if (!silent) {
        ctx.setNotice("Flow created.");
      }
    } else {
      if (!saveTargetPipelineId) {
        return false;
      }

      const response = await updatePipeline(saveTargetPipelineId, payload);
      const updated = response.pipeline;
      ctx.setPipelines((current) => current.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)));

      if (ctx.selectedPipelineIdRef.current === saveTargetPipelineId) {
        ctx.setBaselineDraft(payload);
      }

      if (!silent) {
        ctx.setNotice("Flow saved.");
      }
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save flow";
    ctx.setNotice(silent ? `Autosave failed: ${message}` : message);
    return false;
  } finally {
    ctx.savingPipelineRef.current = false;
    ctx.setSavingPipeline(false);
  }
}
