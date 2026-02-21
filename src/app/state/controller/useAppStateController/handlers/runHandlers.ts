import { useCallback, type SetStateAction } from "react";
import { normalizeSchedule } from "@/lib/pipelineDraft";
import type { DashboardState, PipelinePayload, SmartRunPlan } from "@/lib/types";
import type {
  AppStateRunPanelDraftState,
  AppStateSetState,
  HandleStartRunOptions,
  RunInputModalContext,
  SmartRunPlanLoaderRefs
} from "../../types";
import { loadScheduleRunPlan, loadSmartRunPlan } from "../effects";
import {
  handleConfirmRunInputModalAction,
  handleForgetSecureInputAction,
  handlePauseRunAction,
  handleResolveRunApprovalAction,
  handleResumeRunAction,
  handleRunPanelDraftStateChangeAction,
  handleStartRunAction,
  handleStopRunAction,
  persistRunDraftInputsAction
} from "../dispatchers";

type SetDashboardRuns = AppStateSetState<DashboardState["runs"]>;

export interface RunHandlersArgs {
  runs: DashboardState["runs"];
  selectedPipelineId: string | null;
  pipelineSaveValidationError: string;
  savingPipeline: boolean;
  isDirty: boolean;
  aiChatPending: boolean;
  selectedPipelineEditLocked: boolean;
  aiWorkflowKey: string;
  runInputModal: RunInputModalContext | null;
  activePipelineRun: DashboardState["runs"][number] | null;
  smartRunPlanRefs: SmartRunPlanLoaderRefs;
  scheduleRunPlanRefs: SmartRunPlanLoaderRefs;
  applyEditableDraftChange: (next: SetStateAction<PipelinePayload>) => void;
  setNotice: AppStateSetState<string>;
  setSmartRunPlan: AppStateSetState<SmartRunPlan | null>;
  setLoadingSmartRunPlan: AppStateSetState<boolean>;
  setScheduleRunPlan: AppStateSetState<SmartRunPlan | null>;
  setLoadingScheduleRunPlan: AppStateSetState<boolean>;
  setStartingRunPipelineId: AppStateSetState<string | null>;
  setStoppingRunPipelineId: AppStateSetState<string | null>;
  setPausingRunPipelineId: AppStateSetState<string | null>;
  setResumingRunPipelineId: AppStateSetState<string | null>;
  setResolvingApprovalId: AppStateSetState<string | null>;
  setRuns: SetDashboardRuns;
  setRunInputModal: AppStateSetState<RunInputModalContext | null>;
  setProcessingRunInputModal: AppStateSetState<boolean>;
}

export interface RunHandlersResult {
  persistRunDraftInputs: (task: string, inputs: Record<string, string>) => void;
  handleRunPanelDraftStateChange: (runDraftState: AppStateRunPanelDraftState) => void;
  handleStartRun: (
    task: string,
    inputs?: Record<string, string>,
    options?: HandleStartRunOptions
  ) => Promise<void>;
  handleStopRun: (runId?: string) => Promise<void>;
  handlePauseRun: (runId?: string) => Promise<void>;
  handleResumeRun: (runId?: string) => Promise<void>;
  handleResolveRunApproval: (
    runId: string,
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string
  ) => Promise<void>;
  handleForgetSecureInput: (key: string) => Promise<void>;
  handleConfirmRunInputModal: (submittedValues: Record<string, string>) => Promise<void>;
  handleLoadSmartRunPlan: (inputs?: Record<string, string>, options?: { force?: boolean }) => Promise<void>;
  handleLoadScheduleRunPlan: (
    runMode: "smart" | "quick",
    inputs?: Record<string, string>,
    options?: { force?: boolean }
  ) => Promise<void>;
}

export function useRunHandlers(args: RunHandlersArgs): RunHandlersResult {
  const {
    runs,
    selectedPipelineId,
    pipelineSaveValidationError,
    savingPipeline,
    isDirty,
    aiChatPending,
    selectedPipelineEditLocked,
    aiWorkflowKey,
    runInputModal,
    activePipelineRun,
    smartRunPlanRefs,
    scheduleRunPlanRefs,
    applyEditableDraftChange,
    setNotice,
    setSmartRunPlan,
    setLoadingSmartRunPlan,
    setScheduleRunPlan,
    setLoadingScheduleRunPlan,
    setStartingRunPipelineId,
    setStoppingRunPipelineId,
    setPausingRunPipelineId,
    setResumingRunPipelineId,
    setResolvingApprovalId,
    setRuns,
    setRunInputModal,
    setProcessingRunInputModal
  } = args;

  const persistRunDraftInputs = useCallback(
    (task: string, inputs: Record<string, string>) => {
      persistRunDraftInputsAction(task, inputs, {
        aiWorkflowKey,
        selectedPipelineEditLocked,
        applyEditableDraftChange,
        normalizeSchedule
      });
    },
    [aiWorkflowKey, applyEditableDraftChange, selectedPipelineEditLocked]
  );

  const handleRunPanelDraftStateChange = useCallback(
    (runDraftState: AppStateRunPanelDraftState) => {
      handleRunPanelDraftStateChangeAction(runDraftState, {
        selectedPipelineEditLocked,
        applyEditableDraftChange,
        normalizeSchedule
      });
    },
    [applyEditableDraftChange, selectedPipelineEditLocked]
  );

  const handleStartRun = async (
    task: string,
    inputs?: Record<string, string>,
    options?: HandleStartRunOptions
  ) => {
    await handleStartRunAction(task, inputs, options, {
      selectedPipelineId,
      setNotice,
      setRunInputModal,
      persistRunDraftInputs,
      runs,
      pipelineSaveValidationError,
      savingPipeline,
      isDirty,
      aiChatPending,
      setStartingRunPipelineId,
      setRuns
    });
  };

  const handleStopRun = async (runId?: string) => {
    await handleStopRunAction(runId, {
      activePipelineRun,
      runs,
      selectedPipelineId,
      setStoppingRunPipelineId,
      setRuns,
      setNotice
    });
  };

  const handlePauseRun = async (runId?: string) => {
    await handlePauseRunAction(runId, {
      activePipelineRun,
      runs,
      selectedPipelineId,
      setPausingRunPipelineId,
      setRuns,
      setNotice
    });
  };

  const handleResumeRun = async (runId?: string) => {
    await handleResumeRunAction(runId, {
      activePipelineRun,
      runs,
      selectedPipelineId,
      setResumingRunPipelineId,
      setRuns,
      setNotice
    });
  };

  const handleResolveRunApproval = async (
    runId: string,
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string
  ) => {
    await handleResolveRunApprovalAction(runId, approvalId, decision, note, {
      setResolvingApprovalId,
      setRuns,
      setNotice
    });
  };

  const handleForgetSecureInput = useCallback(
    async (key: string) => {
      await handleForgetSecureInputAction(key, {
        selectedPipelineId,
        setNotice
      });
    },
    [selectedPipelineId, setNotice]
  );

  const handleConfirmRunInputModal = useCallback(
    async (submittedValues: Record<string, string>) => {
      await handleConfirmRunInputModalAction(submittedValues, {
        runInputModal,
        runs,
        selectedPipelineId,
        persistRunDraftInputs,
        setRunInputModal,
        setProcessingRunInputModal,
        handleStopRun,
        handleStartRun
      });
    },
    [handleStartRun, handleStopRun, persistRunDraftInputs, runInputModal, runs, selectedPipelineId]
  );

  const handleLoadSmartRunPlan = useCallback(
    async (inputs?: Record<string, string>, options?: { force?: boolean }) => {
      await loadSmartRunPlan({
        selectedPipelineId,
        inputs,
        force: options?.force,
        setPlan: setSmartRunPlan,
        setLoading: setLoadingSmartRunPlan,
        requestIdRef: smartRunPlanRefs.requestIdRef,
        inFlightSignatureRef: smartRunPlanRefs.inFlightSignatureRef,
        lastSignatureRef: smartRunPlanRefs.lastSignatureRef,
        cacheRef: smartRunPlanRefs.cacheRef,
        setNotice
      });
    },
    [selectedPipelineId]
  );

  const handleLoadScheduleRunPlan = useCallback(
    async (
      runMode: "smart" | "quick",
      inputs?: Record<string, string>,
      options?: { force?: boolean }
    ) => {
      await loadScheduleRunPlan({
        selectedPipelineId,
        runMode,
        inputs,
        force: options?.force,
        setPlan: setScheduleRunPlan,
        setLoading: setLoadingScheduleRunPlan,
        requestIdRef: scheduleRunPlanRefs.requestIdRef,
        inFlightSignatureRef: scheduleRunPlanRefs.inFlightSignatureRef,
        lastSignatureRef: scheduleRunPlanRefs.lastSignatureRef,
        cacheRef: scheduleRunPlanRefs.cacheRef,
        setNotice
      });
    },
    [selectedPipelineId]
  );

  return {
    persistRunDraftInputs,
    handleRunPanelDraftStateChange,
    handleStartRun,
    handleStopRun,
    handlePauseRun,
    handleResumeRun,
    handleResolveRunApproval,
    handleForgetSecureInput,
    handleConfirmRunInputModal,
    handleLoadSmartRunPlan,
    handleLoadScheduleRunPlan
  };
}
