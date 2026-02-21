import { useEffect, useRef, useState } from "react";
import type { Pipeline, PipelineRun, SmartRunPlan } from "@/lib/types";
import { loadRunDraft, saveRunDraft, type RunDraftState, type RunMode } from "@/lib/runDraftStorage";
import { getRunInputValue, normalizeRunInputKey } from "@/lib/runInputAliases";
import { createRunPanelStateActions } from "./stateActions";
import { useRunPanelDerivations } from "./stateDerivations";

const AUTO_PREFLIGHT_REFRESH_DEBOUNCE_MS = 900;

interface UseRunPanelStateProps {
  draftStorageKey: string | undefined;
  aiChatPending?: boolean;
  selectedPipeline: Pipeline | undefined;
  runs: PipelineRun[];
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  onRefreshSmartRunPlan: (inputs?: Record<string, string>, options?: { force?: boolean }) => Promise<void>;
  activeRun: PipelineRun | null;
  startingRun: boolean;
  stoppingRun: boolean;
  onPause?: (runId: string) => Promise<void>;
  onResume?: (runId: string) => Promise<void>;
  pausingRun?: boolean;
  resumingRun?: boolean;
  onForgetSecretInput?: (key: string) => Promise<void>;
  syncedMode?: RunMode;
  syncedInputs?: Record<string, string>;
  onDraftStateChange?: (draft: RunDraftState) => void;
}

export function useRunPanelState({
  draftStorageKey,
  aiChatPending = false,
  selectedPipeline,
  runs,
  smartRunPlan,
  loadingSmartRunPlan,
  onRefreshSmartRunPlan,
  activeRun,
  startingRun,
  stoppingRun,
  onPause,
  onResume,
  pausingRun = false,
  resumingRun = false,
  onForgetSecretInput,
  syncedMode,
  syncedInputs,
  onDraftStateChange
}: UseRunPanelStateProps) {
  const [task, setTask] = useState("");
  const [mode, setMode] = useState<RunMode>("smart");
  const [smartInputs, setSmartInputs] = useState<Record<string, string>>({});
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [forgettingSecretKeys, setForgettingSecretKeys] = useState<Record<string, boolean>>({});
  const [draftHydrated, setDraftHydrated] = useState(false);

  const smartInputsRef = useRef<Record<string, string>>({});
  const onRefreshSmartRunPlanRef = useRef(onRefreshSmartRunPlan);

  useEffect(() => {
    smartInputsRef.current = smartInputs;
  }, [smartInputs]);

  useEffect(() => {
    onRefreshSmartRunPlanRef.current = onRefreshSmartRunPlan;
  }, [onRefreshSmartRunPlan]);

  const {
    autoRefreshInputSignature,
    canPauseActiveRun,
    canQuickRun,
    canResumeActiveRun,
    canSmartRun,
    controlsLocked,
    firstBlockingCheck,
    hasMissingRequiredInputs,
    missingRequiredInputs,
    passCount,
    pendingApprovals,
    runActive,
    scopedRuns,
    shouldRefreshMissingRequiredChecks,
    totalChecks,
    syncedInputsSignature
  } = useRunPanelDerivations({
    activeRun,
    aiChatPending,
    loadingSmartRunPlan,
    mode,
    onPause,
    onResume,
    pausingRun,
    resumingRun,
    runs,
    selectedPipeline,
    smartInputs,
    smartRunPlan,
    startingRun,
    stoppingRun,
    syncedInputs
  });

  useEffect(() => {
    setDraftHydrated(false);
    const draft = loadRunDraft(draftStorageKey);
    setTask(draft.task);
    setMode(draft.mode);
    setSmartInputs(draft.inputs);
    setDraftHydrated(true);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }

    const nextDraft: RunDraftState = {
      task,
      mode,
      inputs: smartInputs
    };
    saveRunDraft(draftStorageKey, nextDraft);
    onDraftStateChange?.(nextDraft);
  }, [draftHydrated, draftStorageKey, mode, onDraftStateChange, smartInputs, task]);

  useEffect(() => {
    if (!draftHydrated || !syncedMode) {
      return;
    }

    setMode((current) => (current === syncedMode ? current : syncedMode));
  }, [draftHydrated, syncedMode]);

  useEffect(() => {
    if (!draftHydrated || !syncedInputs || syncedInputsSignature.length === 0) {
      return;
    }

    setSmartInputs((current) => {
      const next: Record<string, string> = { ...current };
      let changed = false;
      for (const [rawKey, value] of Object.entries(syncedInputs)) {
        const key = normalizeRunInputKey(rawKey);
        if (key.length === 0) {
          continue;
        }
        if (next[key] === value) {
          continue;
        }
        next[key] = value;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [draftHydrated, syncedInputs, syncedInputsSignature]);

  useEffect(() => {
    if (!smartRunPlan) {
      return;
    }

    setSmartInputs((current) => {
      const next: Record<string, string> = { ...current };
      let changed = false;
      for (const field of smartRunPlan.fields) {
        if (next[field.key] === undefined) {
          next[field.key] = getRunInputValue(next, field.key) ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [smartRunPlan]);

  useEffect(() => {
    if (
      !draftHydrated ||
      aiChatPending ||
      autoRefreshInputSignature.length === 0 ||
      loadingSmartRunPlan ||
      Boolean(activeRun) ||
      startingRun ||
      stoppingRun ||
      (hasMissingRequiredInputs && !shouldRefreshMissingRequiredChecks)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void onRefreshSmartRunPlanRef.current(smartInputsRef.current);
    }, AUTO_PREFLIGHT_REFRESH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeRun,
    aiChatPending,
    autoRefreshInputSignature,
    draftHydrated,
    hasMissingRequiredInputs,
    loadingSmartRunPlan,
    shouldRefreshMissingRequiredChecks,
    startingRun,
    stoppingRun
  ]);

  const { forgetSecretInput, refreshSmartRunPlan } = createRunPanelStateActions({
    onForgetSecretInput,
    onRefreshSmartRunPlan,
    setForgettingSecretKeys,
    setSmartInputs,
    smartInputsRef
  });

  return {
    approvalNotes,
    activeRun,
    canPauseActiveRun,
    canQuickRun,
    canResumeActiveRun,
    canSmartRun,
    controlsLocked,
    firstBlockingCheck,
    forgettingSecretKeys,
    hasMissingRequiredInputs,
    mode,
    missingRequiredInputs,
    passCount,
    pendingApprovals,
    runActive,
    scopedRuns,
    shouldRefreshMissingRequiredChecks,
    smartInputs,
    totalChecks,
    task,
    setTask,
    setMode,
    setSmartInputs,
    setApprovalNotes,
    setForgettingSecretKeys,
    refreshSmartRunPlan,
    forgetSecretInput
  };
}
