import type { Dispatch, SetStateAction } from "react";
import { normalizeSmartRunInputs } from "@/lib/smartRunInputs";
import { deletePipelineSecureInputs } from "@/lib/api";
import { loadRunDraft, saveRunDraft } from "@/lib/runDraftStorage";
import type { DashboardState, PipelinePayload } from "@/lib/types";
import type { RunInputModalContext } from "../../appStateTypes";
import { normalizeDraftTask } from "../utils";
import { hasActiveRunForPipeline, sanitizeRunPanelInputs } from "../../appStateRunHelpers";
import {
  confirmRunInputModalAndRestart,
  launchRunAndRefresh,
  pauseRunAndRefresh,
  resolveRunApprovalAndRefresh,
  runStartupCheckBeforeStart,
  stopRunAndRefresh,
  resumeRunAndRefresh,
  type HandleStartRunOptions
} from "../../appStateRunController";

export function persistRunDraftInputsAction(
  task: string,
  inputs: Record<string, string>,
  ctx: {
    aiWorkflowKey: string;
    selectedPipelineEditLocked: boolean;
    applyEditableDraftChange: (next: SetStateAction<PipelinePayload>) => void;
    normalizeSchedule: (
      schedule: PipelinePayload["schedule"]
    ) => { runMode: "smart" | "quick"; inputs: Record<string, string> };
  }
): void {
  const normalizedTask = normalizeDraftTask(task);
  const currentDraft = loadRunDraft(ctx.aiWorkflowKey);
  const normalizedInputs = normalizeSmartRunInputs(inputs);
  const mergedInputs = normalizeSmartRunInputs({
    ...currentDraft.inputs,
    ...normalizedInputs
  });

  saveRunDraft(ctx.aiWorkflowKey, {
    ...currentDraft,
    task: normalizedTask.length > 0 ? normalizedTask : currentDraft.task,
    inputs: mergedInputs
  });

  if (ctx.selectedPipelineEditLocked) {
    return;
  }

  ctx.applyEditableDraftChange((current: PipelinePayload) => {
    const schedule = ctx.normalizeSchedule(current.schedule);
    const nextScheduleInputs = normalizeSmartRunInputs({
      ...schedule.inputs,
      ...mergedInputs
    });

    if (JSON.stringify(schedule.inputs) === JSON.stringify(nextScheduleInputs)) {
      return current;
    }

    return {
      ...current,
      schedule: {
        ...schedule,
        inputs: nextScheduleInputs
      }
    };
  });
}

export function handleRunPanelDraftStateChangeAction(
  runDraftState: { task: string; mode: "smart" | "quick"; inputs: Record<string, string> },
  ctx: {
    selectedPipelineEditLocked: boolean;
    applyEditableDraftChange: (next: SetStateAction<PipelinePayload>) => void;
    normalizeSchedule: (
      schedule: PipelinePayload["schedule"]
    ) => { runMode: "smart" | "quick"; inputs: Record<string, string> };
  }
): void {
  const normalizedInputs = normalizeSmartRunInputs(runDraftState.inputs);
  const safeInputs = sanitizeRunPanelInputs(normalizedInputs);

  if (ctx.selectedPipelineEditLocked) {
    return;
  }

  ctx.applyEditableDraftChange((current: PipelinePayload) => {
    const schedule = ctx.normalizeSchedule(current.schedule);
    const nextInputs = normalizeSmartRunInputs({
      ...schedule.inputs,
      ...safeInputs
    });

    if (schedule.runMode === runDraftState.mode && JSON.stringify(schedule.inputs) === JSON.stringify(nextInputs)) {
      return current;
    }

    return {
      ...current,
      schedule: {
        ...schedule,
        runMode: runDraftState.mode,
        inputs: nextInputs
      }
    };
  });
}

export async function handleStartRunAction(
  task: string,
  inputs: Record<string, string> | undefined,
  options: (HandleStartRunOptions & { pipelineId?: string }) | undefined,
  ctx: {
    selectedPipelineId: string | null;
    setNotice: (message: string) => void;
    setRunInputModal: Dispatch<SetStateAction<RunInputModalContext | null>>;
    persistRunDraftInputs: (task: string, inputs: Record<string, string>) => void;
    runs: DashboardState["runs"];
    pipelineSaveValidationError: string;
    savingPipeline: boolean;
    isDirty: boolean;
    aiChatPending: boolean;
    setStartingRunPipelineId: Dispatch<SetStateAction<string | null>>;
    setRuns: Dispatch<SetStateAction<DashboardState["runs"]>>;
  }
): Promise<void> {
  const normalizedTask = normalizeDraftTask(task);
  const normalizedInputs = normalizeSmartRunInputs(inputs);
  const normalizedOptions = {
    ...options,
    inputs: normalizedInputs
  };
  const targetPipelineId = normalizedOptions.pipelineId ?? ctx.selectedPipelineId;

  if (!targetPipelineId) {
    if (ctx.pipelineSaveValidationError) {
      ctx.setNotice(`Fix flow before run: ${ctx.pipelineSaveValidationError}`);
    } else {
      ctx.setNotice("Flow is still autosaving. Try again in a moment.");
    }
    return;
  }

  if (!normalizedOptions.skipActiveRunCheck) {
    const hasActiveRun = hasActiveRunForPipeline(targetPipelineId, ctx.runs);
    if (hasActiveRun) {
      ctx.setNotice("This flow is already running.");
      return;
    }
  }

  if (ctx.aiChatPending && targetPipelineId === ctx.selectedPipelineId) {
    ctx.setNotice("AI is updating this flow. Wait for it to finish before running.");
    return;
  }

  if (!normalizedOptions.skipAutosaveCheck && targetPipelineId === ctx.selectedPipelineId && (ctx.savingPipeline || ctx.isDirty)) {
    if (ctx.pipelineSaveValidationError) {
      ctx.setNotice(`Fix flow before run: ${ctx.pipelineSaveValidationError}`);
    } else {
      ctx.setNotice("Autosave in progress. Try again in a moment.");
    }
    return;
  }

  ctx.persistRunDraftInputs(normalizedTask, normalizedOptions.inputs);
  ctx.setStartingRunPipelineId(targetPipelineId);

  try {
    const startupCheckResult = await runStartupCheckBeforeStart({
      pipelineId: targetPipelineId,
      task: normalizedTask,
      inputs: normalizedOptions.inputs,
      source: normalizedOptions.source ?? "startup",
      runId: normalizedOptions.runId,
      setNotice: ctx.setNotice,
      setRunInputModal: ctx.setRunInputModal
    });

    if (startupCheckResult !== "pass") {
      return;
    }

    await launchRunAndRefresh({
      pipelineId: targetPipelineId,
      task: normalizedTask,
      inputs: normalizedOptions.inputs,
      setRuns: ctx.setRuns,
      setNotice: ctx.setNotice
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start run";
    ctx.setNotice(message);
  } finally {
    ctx.setStartingRunPipelineId((current) => (current === targetPipelineId ? null : current));
  }
}

export function handleStopRunAction(
  runId: string | undefined,
  ctx: {
    activePipelineRun: DashboardState["runs"][number] | null;
    runs: DashboardState["runs"];
    selectedPipelineId: string | null;
    setStoppingRunPipelineId: Dispatch<SetStateAction<string | null>>;
    setRuns: Dispatch<SetStateAction<DashboardState["runs"]>>;
    setNotice: (message: string) => void;
  }
): Promise<void> {
  return stopRunAndRefresh({
    runId,
    activePipelineRun: ctx.activePipelineRun,
    runs: ctx.runs,
    selectedPipelineId: ctx.selectedPipelineId,
    setTransitionPipelineId: ctx.setStoppingRunPipelineId,
    setRuns: ctx.setRuns,
    setNotice: ctx.setNotice
  });
}

export function handlePauseRunAction(
  runId: string | undefined,
  ctx: {
    activePipelineRun: DashboardState["runs"][number] | null;
    runs: DashboardState["runs"];
    selectedPipelineId: string | null;
    setPausingRunPipelineId: Dispatch<SetStateAction<string | null>>;
    setRuns: Dispatch<SetStateAction<DashboardState["runs"]>>;
    setNotice: (message: string) => void;
  }
): Promise<void> {
  return pauseRunAndRefresh({
    runId,
    activePipelineRun: ctx.activePipelineRun,
    runs: ctx.runs,
    selectedPipelineId: ctx.selectedPipelineId,
    setTransitionPipelineId: ctx.setPausingRunPipelineId,
    setRuns: ctx.setRuns,
    setNotice: ctx.setNotice
  });
}

export function handleResumeRunAction(
  runId: string | undefined,
  ctx: {
    activePipelineRun: DashboardState["runs"][number] | null;
    runs: DashboardState["runs"];
    selectedPipelineId: string | null;
    setResumingRunPipelineId: Dispatch<SetStateAction<string | null>>;
    setRuns: Dispatch<SetStateAction<DashboardState["runs"]>>;
    setNotice: (message: string) => void;
  }
): Promise<void> {
  return resumeRunAndRefresh({
    runId,
    activePipelineRun: ctx.activePipelineRun,
    runs: ctx.runs,
    selectedPipelineId: ctx.selectedPipelineId,
    setTransitionPipelineId: ctx.setResumingRunPipelineId,
    setRuns: ctx.setRuns,
    setNotice: ctx.setNotice
  });
}

export function handleResolveRunApprovalAction(
  runId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  note: string | undefined,
  ctx: {
    setResolvingApprovalId: Dispatch<SetStateAction<string | null>>;
    setRuns: Dispatch<SetStateAction<DashboardState["runs"]>>;
    setNotice: (message: string) => void;
  }
): Promise<void> {
  return resolveRunApprovalAndRefresh({
    runId,
    approvalId,
    decision,
    note,
    setResolvingApprovalId: ctx.setResolvingApprovalId,
    setRuns: ctx.setRuns,
    setNotice: ctx.setNotice
  });
}

export async function handleForgetSecureInputAction(
  key: string,
  ctx: { selectedPipelineId: string | null; setNotice: (message: string) => void }
): Promise<void> {
  if (!ctx.selectedPipelineId) {
    ctx.setNotice("Open a saved flow first.");
    return;
  }

  await deletePipelineSecureInputs(ctx.selectedPipelineId, [key]);
  ctx.setNotice(`Forgot saved secret: ${key}`);
}

export async function handleConfirmRunInputModalAction(
  submittedValues: Record<string, string>,
  ctx: {
    runInputModal: RunInputModalContext | null;
    runs: DashboardState["runs"];
    selectedPipelineId: string | null;
    persistRunDraftInputs: (task: string, inputs: Record<string, string>) => void;
    setRunInputModal: Dispatch<SetStateAction<RunInputModalContext | null>>;
    setProcessingRunInputModal: Dispatch<SetStateAction<boolean>>;
    handleStopRun: (runId?: string) => Promise<void>;
    handleStartRun: (
      task: string,
      inputs?: Record<string, string>,
      options?: HandleStartRunOptions
    ) => Promise<void>;
  }
): Promise<void> {
  await confirmRunInputModalAndRestart({
    runInputModal: ctx.runInputModal,
    submittedValues,
    runs: ctx.runs,
    selectedPipelineId: ctx.selectedPipelineId,
    persistRunDraftInputs: ctx.persistRunDraftInputs,
    setRunInputModal: ctx.setRunInputModal,
    setProcessingRunInputModal: ctx.setProcessingRunInputModal,
    handleStopRun: ctx.handleStopRun,
    handleStartRun: ctx.handleStartRun
  });
}
