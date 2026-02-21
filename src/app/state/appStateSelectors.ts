import { buildScheduleRunPlanSignature } from "@/lib/smartRunInputs";
import { getPipelineSaveValidationError, isActiveRunStatus, normalizeRuntime, normalizeSchedule } from "@/lib/pipelineDraft";
import type { DashboardState, PipelinePayload, RunStatus } from "@/lib/types";

export function selectIsDirty(draft: PipelinePayload, baselineDraft: PipelinePayload): boolean {
  return JSON.stringify(draft) !== JSON.stringify(baselineDraft);
}

export function selectPipelineSaveValidationError(draft: PipelinePayload): string {
  return getPipelineSaveValidationError(draft) ?? "";
}

export function selectHasOrchestrator(draft: PipelinePayload): boolean {
  return draft.steps.some((step) => step.role === "orchestrator");
}

export function selectSelectedPipeline(pipelines: DashboardState["pipelines"], selectedPipelineId: string | null) {
  if (!selectedPipelineId) {
    return undefined;
  }

  return pipelines.find((pipeline) => pipeline.id === selectedPipelineId);
}

export function selectActivePipelineRun(runs: DashboardState["runs"], selectedPipelineId: string | null) {
  if (!selectedPipelineId) {
    return null;
  }

  const running = runs.find((run) => run.pipelineId === selectedPipelineId && run.status === "running");
  if (running) {
    return running;
  }

  const awaitingApproval = runs.find(
    (run) => run.pipelineId === selectedPipelineId && run.status === "awaiting_approval"
  );
  if (awaitingApproval) {
    return awaitingApproval;
  }

  const paused = runs.find((run) => run.pipelineId === selectedPipelineId && run.status === "paused");
  if (paused) {
    return paused;
  }

  return runs.find((run) => run.pipelineId === selectedPipelineId && run.status === "queued") ?? null;
}

export function selectActiveRunPipelineIds(
  runs: DashboardState["runs"],
  startingRunPipelineId: string | null,
  stoppingRunPipelineId: string | null,
  pausingRunPipelineId: string | null,
  resumingRunPipelineId: string | null
) {
  const ids = new Set(runs.filter((run) => isActiveRunStatus(run.status)).map((run) => run.pipelineId));
  if (startingRunPipelineId) {
    ids.add(startingRunPipelineId);
  }
  if (stoppingRunPipelineId) {
    ids.add(stoppingRunPipelineId);
  }
  if (pausingRunPipelineId) {
    ids.add(pausingRunPipelineId);
  }
  if (resumingRunPipelineId) {
    ids.add(resumingRunPipelineId);
  }

  return [...ids];
}

export function selectRunPanelFlags(
  selectedPipelineId: string | null,
  selectedPipelineRunActive: boolean,
  startingRun: boolean,
  stoppingRun: boolean,
  pausingRun: boolean,
  resumingRun: boolean,
  savingPipeline: boolean,
  isDirty: boolean,
  canvasDragActive: boolean,
  pipelineSaveValidationMessage: string,
  aiChatPending: boolean
) {
  const selectedPipelineEditLocked =
    selectedPipelineRunActive || startingRun || stoppingRun || pausingRun || resumingRun;

  const runPanelToggleDisabled =
    !selectedPipelineId ||
    startingRun ||
    stoppingRun ||
    pausingRun ||
    resumingRun ||
    savingPipeline ||
    isDirty ||
    canvasDragActive ||
    aiChatPending;

  const runTooltip = selectedPipelineRunActive
    ? "Run in progress."
    : aiChatPending
      ? "AI is updating this flow. Wait until it finishes before running."
    : !selectedPipelineId
      ? pipelineSaveValidationMessage
        ? `Fix before autosave: ${pipelineSaveValidationMessage}`
        : "Autosave pending..."
      : canvasDragActive
        ? "Finish moving nodes before running."
        : pipelineSaveValidationMessage
          ? `Fix before autosave: ${pipelineSaveValidationMessage}`
          : savingPipeline || isDirty
            ? "Autosaving changes..."
            : "Run flow";

  return { selectedPipelineEditLocked, runPanelToggleDisabled, runTooltip };
}

export function selectAutosaveStatusLabel(
  pipelineSaveValidationMessage: string,
  canvasDragActive: boolean,
  savingPipeline: boolean,
  isDirty: boolean
): string {
  return pipelineSaveValidationMessage
    ? `Autosave paused: ${pipelineSaveValidationMessage}`
    : canvasDragActive
      ? "Autosave paused while moving nodes..."
      : savingPipeline
        ? "Autosaving changes..."
        : isDirty
          ? "Autosaving pending..."
          : "All changes saved";
}

export function selectRuntimeDraft(draft: PipelinePayload) {
  return normalizeRuntime(draft.runtime);
}

export function selectScheduleDraft(draft: PipelinePayload) {
  return normalizeSchedule(draft.schedule);
}

export function selectAiWorkflowKey(selectedPipelineId: string | null, draftWorkflowKey: string): string {
  return selectedPipelineId ?? draftWorkflowKey;
}

export function selectRunStateFlags(
  selectedPipelineRunActive: boolean,
  activePipelineRunStatus: RunStatus | null
) {
  const canPauseActiveRun = Boolean(
    selectedPipelineRunActive &&
      (activePipelineRunStatus === "queued" ||
        activePipelineRunStatus === "running" ||
        activePipelineRunStatus === "awaiting_approval")
  );
  const canResumeActiveRun = Boolean(activePipelineRunStatus === "paused");

  return { canPauseActiveRun, canResumeActiveRun };
}

export function selectScheduleRunPlanSignature(
  selectedPipelineId: string | null,
  scheduleMode: "smart" | "quick",
  inputs: Record<string, string>
): string {
  if (!selectedPipelineId) {
    return "";
  }

  return buildScheduleRunPlanSignature(selectedPipelineId, scheduleMode, inputs);
}
