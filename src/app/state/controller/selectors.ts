import { useMemo } from "react";
import type { PipelineScheduleConfig } from "@/lib/types";
import { selectScheduleRunPlanSignature } from "../appStateSelectors";

export {
  selectActivePipelineRun,
  selectActiveRunPipelineIds,
  selectAiWorkflowKey,
  selectAutosaveStatusLabel,
  selectHasOrchestrator,
  selectIsDirty,
  selectPipelineSaveValidationError,
  selectRunPanelFlags,
  selectRuntimeDraft,
  selectSelectedPipeline,
  selectScheduleDraft,
  selectRunStateFlags,
  selectScheduleRunPlanSignature
} from "../appStateSelectors";

export {
  buildRuntimeInputPromptSignature,
  hasActiveRunForPipeline,
  hasPipelineRunActivity,
  sanitizeRunPanelInputs,
  selectRuntimeInputPromptCandidateRuns,
  trimRuntimeInputPromptSeenCache,
  seedRunInputsWithDefaults
} from "../appStateRunHelpers";

export {
  buildRunCompletionModalContext,
  extractCompletedRunSummary,
  buildRunInputFallbackSummary,
  buildRunInputModalSignature,
  hasTransitionedFromActive
} from "../appStateEffects";

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
