import { useMemo } from "react";
import type { DashboardState, PipelinePayload, PipelineRun, PipelineScheduleConfig } from "@/lib/types";
import {
  selectActivePipelineRun,
  selectActiveRunPipelineIds,
  selectAiWorkflowKey,
  selectAutosaveStatusLabel,
  selectHasOrchestrator,
  selectIsDirty,
  selectPipelineSaveValidationError,
  selectRunPanelFlags,
  selectRuntimeDraft,
  selectRunStateFlags,
  selectScheduleDraft,
  selectScheduleRunPlanSignature,
  selectSelectedPipeline
} from "./stateSelectors";

interface UseAppStateControllerDerivedStateArgs {
  draft: PipelinePayload;
  baselineDraft: PipelinePayload;
  pipelines: DashboardState["pipelines"];
  runs: DashboardState["runs"];
  selectedPipelineId: string | null;
  draftWorkflowKey: string;
  startingRunPipelineId: string | null;
  stoppingRunPipelineId: string | null;
  pausingRunPipelineId: string | null;
  resumingRunPipelineId: string | null;
  savingPipeline: boolean;
  canvasDragActive: boolean;
  mockRunActive: boolean;
  aiChatPending: boolean;
}

function createMockPipelineRun(draft: PipelinePayload, pipelineId: string): PipelineRun {
  const now = new Date().toISOString();
  return {
    id: "mock-run-debug",
    pipelineId,
    pipelineName: draft.name || "Mock Run",
    task: "Debug mock run — testing running animation",
    inputs: {},
    status: "running",
    startedAt: now,
    logs: ["[mock] Pipeline started", "[mock] Running step 1..."],
    steps: draft.steps.map((step, i) => ({
      stepId: step.id,
      stepName: step.name || step.role,
      role: step.role,
      status: i === 0 ? "running" as const : "pending" as const,
      attempts: i === 0 ? 1 : 0,
      workflowOutcome: "neutral" as const,
      inputContext: "",
      output: "",
      subagentNotes: [],
      qualityGateResults: [],
      startedAt: i === 0 ? now : undefined
    })),
    approvals: []
  };
}

export function useAppStateControllerDerivedState(args: UseAppStateControllerDerivedStateArgs) {
  const {
    draft,
    baselineDraft,
    pipelines,
    runs,
    selectedPipelineId,
    draftWorkflowKey,
    startingRunPipelineId,
    stoppingRunPipelineId,
    pausingRunPipelineId,
    resumingRunPipelineId,
    savingPipeline,
    canvasDragActive,
    mockRunActive,
    aiChatPending
  } = args;

  const isDirty = useMemo(() => selectIsDirty(draft, baselineDraft), [draft, baselineDraft]);
  const pipelineSaveValidationError = useMemo(() => selectPipelineSaveValidationError(draft), [draft]);
  const hasOrchestrator = useMemo(() => selectHasOrchestrator(draft), [draft]);

  const selectedPipeline = useMemo(() => selectSelectedPipeline(pipelines, selectedPipelineId), [pipelines, selectedPipelineId]);
  const realActivePipelineRun = useMemo(() => selectActivePipelineRun(runs, selectedPipelineId), [runs, selectedPipelineId]);
  const activePipelineRun = useMemo(() => {
    if (realActivePipelineRun) return realActivePipelineRun;
    if (mockRunActive && selectedPipelineId && draft.steps.length > 0) {
      return createMockPipelineRun(draft, selectedPipelineId);
    }
    return null;
  }, [realActivePipelineRun, mockRunActive, selectedPipelineId, draft]);
  const activeRunPipelineIds = useMemo(
    () =>
      selectActiveRunPipelineIds(runs, startingRunPipelineId, stoppingRunPipelineId, pausingRunPipelineId, resumingRunPipelineId),
    [runs, startingRunPipelineId, stoppingRunPipelineId, pausingRunPipelineId, resumingRunPipelineId]
  );

  const startingRun = Boolean(selectedPipelineId && startingRunPipelineId === selectedPipelineId);
  const stoppingRun = Boolean(selectedPipelineId && stoppingRunPipelineId === selectedPipelineId);
  const pausingRun = Boolean(selectedPipelineId && pausingRunPipelineId === selectedPipelineId);
  const resumingRun = Boolean(selectedPipelineId && resumingRunPipelineId === selectedPipelineId);
  const selectedPipelineRunActive = Boolean(activePipelineRun);

  const { canPauseActiveRun, canResumeActiveRun } = selectRunStateFlags(
    selectedPipelineRunActive,
    activePipelineRun?.status ?? null
  );

  const { selectedPipelineEditLocked, runPanelToggleDisabled, runTooltip } = selectRunPanelFlags(
    selectedPipelineId,
    selectedPipelineRunActive,
    startingRun,
    stoppingRun,
    pausingRun,
    resumingRun,
    savingPipeline,
    isDirty,
    canvasDragActive,
    pipelineSaveValidationError,
    aiChatPending
  );

  const runtimeDraft = useMemo(() => selectRuntimeDraft(draft), [draft]);
  const scheduleDraft = useMemo(() => selectScheduleDraft(draft), [draft]);
  const aiWorkflowKey = useMemo(() => selectAiWorkflowKey(selectedPipelineId, draftWorkflowKey), [selectedPipelineId, draftWorkflowKey]);

  const autosaveStatusLabel = selectAutosaveStatusLabel(pipelineSaveValidationError, canvasDragActive, savingPipeline, isDirty);

  return {
    isDirty,
    pipelineSaveValidationError,
    hasOrchestrator,
    selectedPipeline,
    activePipelineRun,
    activeRunPipelineIds,
    startingRun,
    stoppingRun,
    pausingRun,
    resumingRun,
    selectedPipelineRunActive,
    canPauseActiveRun,
    canResumeActiveRun,
    selectedPipelineEditLocked,
    runPanelToggleDisabled,
    runTooltip,
    runtimeDraft,
    scheduleDraft,
    aiChatPending,
    aiWorkflowKey,
    autosaveStatusLabel
  };
}

interface UseScheduleRunPlanSignatureArgs {
  selectedPipelineId: string | null;
  scheduleDraft: PipelineScheduleConfig;
}

export function useScheduleRunPlanSignature(args: UseScheduleRunPlanSignatureArgs): string {
  const { selectedPipelineId, scheduleDraft } = args;

  return useMemo(() => {
    return selectScheduleRunPlanSignature(selectedPipelineId, scheduleDraft.runMode, scheduleDraft.inputs);
  }, [scheduleDraft.inputs, scheduleDraft.runMode, selectedPipelineId]);
}
