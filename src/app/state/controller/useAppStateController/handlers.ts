import type { MutableRefObject, SetStateAction } from "react";
import type { ProviderOAuthMessageMap, ProviderOAuthStatusMap } from "@/lib/pipelineDraft";
import type {
  DashboardState,
  PipelinePayload,
  SmartRunPlan,
} from "@/lib/types";
import type {
  AppStateSetState,
  RunInputModalContext,
  SmartRunPlanLoaderRefs,
  UseAppStateOptions
} from "../types";
import {
  usePipelineHandlers,
  type PipelineHandlersArgs,
  type PipelineHandlersResult
} from "./handlers/pipelineHandlers";
import {
  useRunHandlers,
  type RunHandlersArgs,
  type RunHandlersResult
} from "./handlers/runHandlers";
import {
  useConfigHandlers,
  type ConfigHandlersArgs,
  type ConfigHandlersResult
} from "./handlers/configHandlers";

type SetDashboardRuns = AppStateSetState<DashboardState["runs"]>;
type SetAppPanel = UseAppStateOptions["setActivePanel"];

export interface UseAppStateControllerHandlersArgs {
  pipelines: DashboardState["pipelines"];
  runs: DashboardState["runs"];
  draft: PipelinePayload;
  selectedPipelineId: string | null;
  draftWorkflowKey: string;
  isNewDraft: boolean;
  savingPipeline: boolean;
  pipelineSaveValidationError: string;
  isDirty: boolean;
  aiChatPending: boolean;
  selectedPipelineEditLocked: boolean;
  aiWorkflowKey: string;
  runInputModal: RunInputModalContext | null;
  startingRunPipelineId: string | null;
  stoppingRunPipelineId: string | null;
  pausingRunPipelineId: string | null;
  resumingRunPipelineId: string | null;
  activePipelineRun: DashboardState["runs"][number] | null;
  autosaveTimerRef: MutableRefObject<number | undefined>;
  savingPipelineRef: MutableRefObject<boolean>;
  selectedPipelineIdRef: MutableRefObject<string | null>;
  draftWorkflowKeyRef: MutableRefObject<string>;
  smartRunPlanRefs: SmartRunPlanLoaderRefs;
  scheduleRunPlanRefs: SmartRunPlanLoaderRefs;
  setActivePanel: SetAppPanel;
  applyDraftChange: (next: SetStateAction<PipelinePayload>) => void;
  applyEditableDraftChange: (next: SetStateAction<PipelinePayload>) => void;
  resetDraftHistory: (nextDraft: PipelinePayload) => void;
  setNotice: AppStateSetState<string>;
  setPipelines: AppStateSetState<DashboardState["pipelines"]>;
  setProviders: AppStateSetState<DashboardState["providers"] | null>;
  setMcpServers: AppStateSetState<DashboardState["mcpServers"]>;
  setStorageConfig: AppStateSetState<DashboardState["storage"] | null>;
  setSmartRunPlan: AppStateSetState<SmartRunPlan | null>;
  setLoadingSmartRunPlan: AppStateSetState<boolean>;
  setScheduleRunPlan: AppStateSetState<SmartRunPlan | null>;
  setLoadingScheduleRunPlan: AppStateSetState<boolean>;
  setSelectedPipelineId: AppStateSetState<string | null>;
  setDraftWorkflowKey: AppStateSetState<string>;
  setBaselineDraft: AppStateSetState<PipelinePayload>;
  setIsNewDraft: AppStateSetState<boolean>;
  setSavingPipeline: AppStateSetState<boolean>;
  setStartingRunPipelineId: AppStateSetState<string | null>;
  setStoppingRunPipelineId: AppStateSetState<string | null>;
  setPausingRunPipelineId: AppStateSetState<string | null>;
  setResumingRunPipelineId: AppStateSetState<string | null>;
  setResolvingApprovalId: AppStateSetState<string | null>;
  setRuns: SetDashboardRuns;
  setProviderOauthStatuses: AppStateSetState<ProviderOAuthStatusMap>;
  setProviderOauthMessages: AppStateSetState<ProviderOAuthMessageMap>;
  setRunInputModal: AppStateSetState<RunInputModalContext | null>;
  setProcessingRunInputModal: AppStateSetState<boolean>;
}

export interface UseAppStateControllerHandlersResult
  extends PipelineHandlersResult,
    RunHandlersResult,
    ConfigHandlersResult {}

export function useAppStateControllerHandlers(
  args: UseAppStateControllerHandlersArgs
): UseAppStateControllerHandlersResult {
  const {
    pipelines,
    runs,
    draft,
    selectedPipelineId,
    draftWorkflowKey,
    isNewDraft,
    savingPipeline,
    pipelineSaveValidationError,
    isDirty,
    aiChatPending,
    selectedPipelineEditLocked,
    aiWorkflowKey,
    runInputModal,
    startingRunPipelineId,
    stoppingRunPipelineId,
    pausingRunPipelineId,
    resumingRunPipelineId,
    activePipelineRun,
    autosaveTimerRef,
    savingPipelineRef,
    selectedPipelineIdRef,
    draftWorkflowKeyRef,
    smartRunPlanRefs,
    scheduleRunPlanRefs,
    setActivePanel,
    applyDraftChange,
    applyEditableDraftChange,
    resetDraftHistory,
    setNotice,
    setPipelines,
    setProviders,
    setMcpServers,
    setStorageConfig,
    setSmartRunPlan,
    setLoadingSmartRunPlan,
    setScheduleRunPlan,
    setLoadingScheduleRunPlan,
    setSelectedPipelineId,
    setDraftWorkflowKey,
    setBaselineDraft,
    setIsNewDraft,
    setSavingPipeline,
    setStartingRunPipelineId,
    setStoppingRunPipelineId,
    setPausingRunPipelineId,
    setResumingRunPipelineId,
    setResolvingApprovalId,
    setRuns,
    setProviderOauthStatuses,
    setProviderOauthMessages,
    setRunInputModal,
    setProcessingRunInputModal
  } = args;

  const pipelineHandlersArgs: PipelineHandlersArgs = {
    pipelines,
    runs,
    draft,
    selectedPipelineId,
    draftWorkflowKey,
    isNewDraft,
    startingRunPipelineId,
    stoppingRunPipelineId,
    pausingRunPipelineId,
    resumingRunPipelineId,
    selectedPipelineEditLocked,
    autosaveTimerRef,
    savingPipelineRef,
    selectedPipelineIdRef,
    draftWorkflowKeyRef,
    setActivePanel,
    applyDraftChange,
    resetDraftHistory,
    setNotice,
    setPipelines,
    setSmartRunPlan,
    setScheduleRunPlan,
    setSelectedPipelineId,
    setDraftWorkflowKey,
    setBaselineDraft,
    setIsNewDraft,
    setSavingPipeline
  };

  const configHandlersArgs: ConfigHandlersArgs = {
    setProviders,
    setMcpServers,
    setStorageConfig,
    setNotice,
    setProviderOauthStatuses,
    setProviderOauthMessages
  };

  const runHandlersArgs: RunHandlersArgs = {
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
  };

  const pipelineHandlers = usePipelineHandlers(pipelineHandlersArgs);
  const configHandlers = useConfigHandlers(configHandlersArgs);
  const runHandlers = useRunHandlers(runHandlersArgs);

  return {
    selectPipeline: pipelineHandlers.selectPipeline,
    handleCreatePipelineDraft: pipelineHandlers.handleCreatePipelineDraft,
    handleDeletePipeline: pipelineHandlers.handleDeletePipeline,
    handleSavePipeline: pipelineHandlers.handleSavePipeline,
    handleSaveProvider: configHandlers.handleSaveProvider,
    handleCreateMcpServer: configHandlers.handleCreateMcpServer,
    handleUpdateMcpServer: configHandlers.handleUpdateMcpServer,
    handleDeleteMcpServer: configHandlers.handleDeleteMcpServer,
    handleSaveStorageConfig: configHandlers.handleSaveStorageConfig,
    handleProviderOauthStatusChange: configHandlers.handleProviderOauthStatusChange,
    handleProviderOauthMessageChange: configHandlers.handleProviderOauthMessageChange,
    persistRunDraftInputs: runHandlers.persistRunDraftInputs,
    handleRunPanelDraftStateChange: runHandlers.handleRunPanelDraftStateChange,
    handleStartRun: runHandlers.handleStartRun,
    handleStopRun: runHandlers.handleStopRun,
    handlePauseRun: runHandlers.handlePauseRun,
    handleResumeRun: runHandlers.handleResumeRun,
    handleResolveRunApproval: runHandlers.handleResolveRunApproval,
    handleForgetSecureInput: runHandlers.handleForgetSecureInput,
    handleConfirmRunInputModal: runHandlers.handleConfirmRunInputModal,
    handleLoadSmartRunPlan: runHandlers.handleLoadSmartRunPlan,
    handleLoadScheduleRunPlan: runHandlers.handleLoadScheduleRunPlan,
    handleAddStep: pipelineHandlers.handleAddStep,
    handleSpawnOrchestrator: pipelineHandlers.handleSpawnOrchestrator
  };
}
