import { useEffect, type MutableRefObject } from "react";
import { listRuns } from "@/lib/api";
import type { DashboardState, PipelinePayload, PipelineScheduleConfig, RunStatus, SmartRunPlan } from "@/lib/types";
import { loadRunDraft } from "@/lib/runDraftStorage";
import { saveAppSettings, type DesktopNotificationSettings, type ThemePreference } from "@/lib/appSettingsStorage";
import { loadAiChatPending, subscribeAiChatLifecycle } from "@/lib/aiChatStorage";
import {
  AUTOSAVE_DELAY_MS,
  SCHEDULE_RUN_PLAN_DEBOUNCE_MS,
  type DesktopNotificationEvent,
  type RunCompletionModalContext,
  type RunInputModalContext,
  type UseAppStateOptions
} from "../../appStateTypes";
import { clearTimeoutRef } from "../utils";
import { buildRunCompletionModalContext, buildRunInputFallbackSummary, buildRunInputModalSignature } from "./stateSelectors";
import { inspectRuntimeInputPrompts, loadInitialState, syncRunStatusNotifications } from "./effects";
import type { AppStateSetState } from "../types";

type AppStateSetRuns = AppStateSetState<DashboardState["runs"]>;

export interface AppStateControllerRuntimeArgs {
  activePanel: UseAppStateOptions["activePanel"];
  autosaveTimerRef: MutableRefObject<number | undefined>;
  canvasDragActive: boolean;
  debugEnabled: boolean;
  draft: PipelinePayload;
  draftWorkflowKey: string;
  draftWorkflowKeyRef: MutableRefObject<string>;
  desktopNotifications: DesktopNotificationSettings;
  isDirty: boolean;
  notice: string;
  noticeTimerRef: MutableRefObject<number | undefined>;
  pipelineSaveValidationError: string;
  processingRunInputModal: boolean;
  runInputModal: RunInputModalContext | null;
  runStatusSnapshotRef: MutableRefObject<Map<string, RunStatus>>;
  runs: DashboardState["runs"];
  selectedPipelineId: string | null;
  selectedPipelineIdRef: MutableRefObject<string | null>;
  scheduleDraft: PipelineScheduleConfig;
  scheduleRunPlan: SmartRunPlan | null;
  scheduleRunPlanRef: MutableRefObject<SmartRunPlan | null>;
  scheduleRunPlanSignature: string;
  scheduleRunPlanInFlightSignatureRef: MutableRefObject<string>;
  scheduleRunPlanLastSignatureRef: MutableRefObject<string>;
  savingPipeline: boolean;
  setDraftWorkflowKey: AppStateSetState<string>;
  setAiChatPending: AppStateSetState<boolean>;
  setBaselineDraft: AppStateSetState<PipelinePayload>;
  setIsNewDraft: AppStateSetState<boolean>;
  setNotice: AppStateSetState<string>;
  setPipelines: AppStateSetState<DashboardState["pipelines"]>;
  setProviders: AppStateSetState<DashboardState["providers"] | null>;
  setMcpServers: AppStateSetState<DashboardState["mcpServers"]>;
  setRunInputModal: AppStateSetState<RunInputModalContext | null>;
  setRunCompletionModal: AppStateSetState<RunCompletionModalContext | null>;
  setRuns: AppStateSetRuns;
  setScheduleRunPlan: AppStateSetState<SmartRunPlan | null>;
  setSelectedPipelineId: AppStateSetState<string | null>;
  setSmartRunPlan: AppStateSetState<SmartRunPlan | null>;
  setStorageConfig: AppStateSetState<DashboardState["storage"] | null>;
  runtimeInputPromptSeenRef: MutableRefObject<Set<string>>;
  inputModalNotificationSignatureRef: MutableRefObject<string>;
  smartRunPlan: SmartRunPlan | null;
  smartRunPlanRef: MutableRefObject<SmartRunPlan | null>;
  themePreference: ThemePreference;
  aiWorkflowKey: string;
  notifyDesktop: (event: DesktopNotificationEvent, title: string, body?: string) => void;
  handleLoadScheduleRunPlan: (
    runMode: "smart" | "quick",
    inputs?: Record<string, string>,
    options?: { force?: boolean }
  ) => Promise<void>;
  handleLoadSmartRunPlan: (inputs?: Record<string, string>, options?: { force?: boolean }) => Promise<void>;
  handleSavePipeline: (args?: { draftSnapshot?: PipelinePayload; silent?: boolean }) => Promise<boolean>;
  resetDraftHistory: (draft: PipelinePayload) => void;
}

export function useAppStateControllerRuntime(args: AppStateControllerRuntimeArgs): void {
  const {
    activePanel,
    autosaveTimerRef,
    canvasDragActive,
    debugEnabled,
    draft,
    draftWorkflowKey,
    draftWorkflowKeyRef,
    desktopNotifications,
    isDirty,
    notice,
    noticeTimerRef,
    pipelineSaveValidationError,
    processingRunInputModal,
    runInputModal,
    runStatusSnapshotRef,
    runs,
    selectedPipelineId,
    selectedPipelineIdRef,
    scheduleDraft,
    scheduleRunPlan,
    scheduleRunPlanRef,
    scheduleRunPlanSignature,
    scheduleRunPlanInFlightSignatureRef,
    scheduleRunPlanLastSignatureRef,
    savingPipeline,
    setDraftWorkflowKey,
    setAiChatPending,
    setBaselineDraft,
    setIsNewDraft,
    setNotice,
    setPipelines,
    setProviders,
    setMcpServers,
    setRunInputModal,
    setRunCompletionModal,
    setRuns,
    setScheduleRunPlan,
    setSelectedPipelineId,
    setSmartRunPlan,
    setStorageConfig,
    runtimeInputPromptSeenRef,
    inputModalNotificationSignatureRef,
    smartRunPlan,
    smartRunPlanRef,
    themePreference,
    aiWorkflowKey,
    notifyDesktop,
    handleLoadScheduleRunPlan,
    handleLoadSmartRunPlan,
    handleSavePipeline,
    resetDraftHistory
  } = args;

  useEffect(() => {
    selectedPipelineIdRef.current = selectedPipelineId;
  }, [selectedPipelineId, selectedPipelineIdRef]);

  useEffect(() => {
    runtimeInputPromptSeenRef.current = new Set();
  }, [runtimeInputPromptSeenRef, selectedPipelineId]);

  useEffect(() => {
    syncRunStatusNotifications(runs, runStatusSnapshotRef, notifyDesktop, {
      onRunCompleted: (run) => {
        setRunCompletionModal(buildRunCompletionModalContext(run));
      }
    });
  }, [notifyDesktop, runStatusSnapshotRef, runs, setRunCompletionModal]);

  useEffect(() => {
    draftWorkflowKeyRef.current = draftWorkflowKey;
  }, [draftWorkflowKeyRef, draftWorkflowKey]);

  useEffect(() => {
    setAiChatPending(loadAiChatPending(aiWorkflowKey));
    return subscribeAiChatLifecycle(aiWorkflowKey, () => {
      setAiChatPending(loadAiChatPending(aiWorkflowKey));
    });
  }, [aiWorkflowKey, setAiChatPending]);

  useEffect(() => {
    smartRunPlanRef.current = smartRunPlan;
  }, [smartRunPlan, smartRunPlanRef]);

  useEffect(() => {
    scheduleRunPlanRef.current = scheduleRunPlan;
  }, [scheduleRunPlan, scheduleRunPlanRef]);

  useEffect(() => {
    return () => {
      clearTimeoutRef(autosaveTimerRef);
      clearTimeoutRef(noticeTimerRef);
    };
  }, [autosaveTimerRef, noticeTimerRef]);

  useEffect(() => {
    clearTimeoutRef(noticeTimerRef);
    if (notice) {
      noticeTimerRef.current = window.setTimeout(() => setNotice(""), 3500);
    }
    return () => clearTimeoutRef(noticeTimerRef);
  }, [notice, noticeTimerRef, setNotice]);

  useEffect(() => {
    saveAppSettings({ debugEnabled, theme: themePreference, desktopNotifications });
  }, [debugEnabled, themePreference, desktopNotifications]);

  useEffect(() => {
    if (!runInputModal) {
      inputModalNotificationSignatureRef.current = "";
      return;
    }

    const signature = buildRunInputModalSignature(runInputModal);
    if (inputModalNotificationSignatureRef.current === signature) {
      return;
    }

    inputModalNotificationSignatureRef.current = signature;
    const fallbackSummary = buildRunInputFallbackSummary(runInputModal);
    notifyDesktop(
      "inputRequired",
      runInputModal.source === "runtime" ? "Run paused: input required" : "Run startup input required",
      runInputModal.summary || fallbackSummary
    );
  }, [inputModalNotificationSignatureRef, notifyDesktop, runInputModal]);

  useEffect(() => {
    let cancelled = false;
    void loadInitialState({
      setPipelines,
      setProviders,
      setMcpServers,
      setStorageConfig,
      setRuns,
      setSelectedPipelineId,
      setDraftWorkflowKey,
      resetDraftHistory,
      setBaselineDraft,
      setIsNewDraft,
      setNotice,
      isCancelled: () => cancelled
    });

    return () => {
      cancelled = true;
    };
  }, [resetDraftHistory, setBaselineDraft, setDraftWorkflowKey, setIsNewDraft, setNotice, setPipelines, setProviders, setMcpServers, setRuns, setSelectedPipelineId, setStorageConfig]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void listRuns(40)
        .then((response) => {
          setRuns(response.runs);
        })
        .catch(() => {
        });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [setRuns]);

  useEffect(() => {
    clearTimeoutRef(autosaveTimerRef);

    if (!isDirty || pipelineSaveValidationError || savingPipeline || canvasDragActive) {
      return;
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void handleSavePipeline({ draftSnapshot: draft, silent: true });
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeoutRef(autosaveTimerRef);
  }, [autosaveTimerRef, canvasDragActive, draft, handleSavePipeline, isDirty, pipelineSaveValidationError, savingPipeline]);

  useEffect(() => {
    inspectRuntimeInputPrompts({
      runs,
      processingRunInputModal,
      runInputModal,
      runtimeInputPromptSeenRef,
      setRunInputModal,
      setNotice
    });
  }, [processingRunInputModal, runInputModal, runtimeInputPromptSeenRef, runs, setNotice, setRunInputModal]);

  useEffect(() => {
    if (!selectedPipelineId) {
      setSmartRunPlan(null);
      setScheduleRunPlan(null);
      scheduleRunPlanLastSignatureRef.current = "";
      scheduleRunPlanInFlightSignatureRef.current = "";
      return;
    }

    void handleLoadSmartRunPlan();
  }, [handleLoadSmartRunPlan, scheduleRunPlanInFlightSignatureRef, scheduleRunPlanLastSignatureRef, selectedPipelineId, setScheduleRunPlan, setSmartRunPlan]);

  useEffect(() => {
    if (!selectedPipelineId || activePanel !== "schedules" || scheduleRunPlanSignature.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handleLoadScheduleRunPlan(scheduleDraft.runMode, scheduleDraft.inputs);
    }, SCHEDULE_RUN_PLAN_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [activePanel, handleLoadScheduleRunPlan, scheduleDraft.inputs, scheduleDraft.runMode, scheduleRunPlanSignature, selectedPipelineId]);

  useEffect(() => {
    if (activePanel !== "debug" || !selectedPipelineId) {
      return;
    }

    const draft = loadRunDraft(aiWorkflowKey);
    void handleLoadSmartRunPlan(draft.inputs);
  }, [activePanel, aiWorkflowKey, handleLoadSmartRunPlan, selectedPipelineId]);
}
