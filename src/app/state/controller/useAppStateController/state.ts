import { useMemo, useReducer, useRef, useState } from "react";
import { loadAppSettings, type DesktopNotificationSettings } from "@/lib/appSettingsStorage";
import { draftHistoryReducer } from "@/lib/draftHistory";
import {
  createDraftWorkflowKey,
  emptyDraft,
  type ProviderOAuthMessageMap,
  type ProviderOAuthStatusMap
} from "@/lib/pipelineDraft";
import type { DashboardState, PipelinePayload, RunStatus, SmartRunPlan } from "@/lib/types";
import type { RunCompletionModalContext, RunInputModalContext } from "../../appStateTypes";
import { createDraftHistoryReducers } from "../../appStateReducers";

export function useAppStateControllerState() {
  const [initialStateLoading, setInitialStateLoading] = useState(true);
  const [pipelines, setPipelines] = useState<DashboardState["pipelines"]>([]);
  const [providers, setProviders] = useState<DashboardState["providers"] | null>(null);
  const [mcpServers, setMcpServers] = useState<DashboardState["mcpServers"]>([]);
  const [storageConfig, setStorageConfig] = useState<DashboardState["storage"] | null>(null);
  const [runs, setRuns] = useState<DashboardState["runs"]>([]);
  const [smartRunPlan, setSmartRunPlan] = useState<SmartRunPlan | null>(null);
  const [loadingSmartRunPlan, setLoadingSmartRunPlan] = useState(false);
  const [scheduleRunPlan, setScheduleRunPlan] = useState<SmartRunPlan | null>(null);
  const [loadingScheduleRunPlan, setLoadingScheduleRunPlan] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [draftWorkflowKey, setDraftWorkflowKey] = useState<string>(() => createDraftWorkflowKey());
  const [aiChatPending, setAiChatPending] = useState(false);
  const [draftHistory, dispatchDraftHistory] = useReducer(draftHistoryReducer, {
    draft: emptyDraft(),
    undoStack: [],
    redoStack: []
  });
  const [baselineDraft, setBaselineDraft] = useState<PipelinePayload>(emptyDraft());
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [startingRunPipelineId, setStartingRunPipelineId] = useState<string | null>(null);
  const [stoppingRunPipelineId, setStoppingRunPipelineId] = useState<string | null>(null);
  const [pausingRunPipelineId, setPausingRunPipelineId] = useState<string | null>(null);
  const [resumingRunPipelineId, setResumingRunPipelineId] = useState<string | null>(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  const noticeTimerRef = useRef<number>();
  const autosaveTimerRef = useRef<number>();
  const smartRunPlanRequestIdRef = useRef(0);
  const smartRunPlanLastSignatureRef = useRef("");
  const smartRunPlanInFlightSignatureRef = useRef("");
  const smartRunPlanCacheRef = useRef<Map<string, SmartRunPlan>>(new Map());
  const scheduleRunPlanRef = useRef<SmartRunPlan | null>(null);
  const scheduleRunPlanRequestIdRef = useRef(0);
  const scheduleRunPlanInFlightSignatureRef = useRef("");
  const scheduleRunPlanLastSignatureRef = useRef("");
  const scheduleRunPlanCacheRef = useRef<Map<string, SmartRunPlan>>(new Map());
  const smartRunPlanRef = useRef<SmartRunPlan | null>(null);
  const savingPipelineRef = useRef(false);
  const selectedPipelineIdRef = useRef<string | null>(null);
  const draftWorkflowKeyRef = useRef<string>(draftWorkflowKey);
  const [mockRunActive, setMockRunActive] = useState(false);
  const [debugPreviewDispatchRouteId, setDebugPreviewDispatchRouteId] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(() => loadAppSettings().debugEnabled);
  const [desktopNotifications, setDesktopNotifications] = useState<DesktopNotificationSettings>(
    () => loadAppSettings().desktopNotifications
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canvasDragActive, setCanvasDragActive] = useState(false);
  const [providerOauthStatuses, setProviderOauthStatuses] = useState<ProviderOAuthStatusMap>({
    openai: null,
    claude: null
  });
  const [providerOauthMessages, setProviderOauthMessages] = useState<ProviderOAuthMessageMap>({
    openai: "",
    claude: ""
  });
  const [runInputModal, setRunInputModal] = useState<RunInputModalContext | null>(null);
  const [runCompletionModal, setRunCompletionModal] = useState<RunCompletionModalContext | null>(null);
  const [processingRunInputModal, setProcessingRunInputModal] = useState(false);
  const runtimeInputPromptSeenRef = useRef<Set<string>>(new Set());
  const runStatusSnapshotRef = useRef<Map<string, RunStatus>>(new Map());
  const inputModalNotificationSignatureRef = useRef("");

  const draft = draftHistory.draft;
  const draftHistoryReducers = useMemo(() => createDraftHistoryReducers(dispatchDraftHistory), [dispatchDraftHistory]);
  const {
    applyDraftChange,
    resetDraftHistory,
    undoDraftChange,
    redoDraftChange
  } = draftHistoryReducers;
  const canUndo = draftHistory.undoStack.length > 0;
  const canRedo = draftHistory.redoStack.length > 0;

  return {
    initialStateLoading,
    setInitialStateLoading,
    pipelines,
    setPipelines,
    providers,
    setProviders,
    mcpServers,
    setMcpServers,
    storageConfig,
    setStorageConfig,
    runs,
    setRuns,
    smartRunPlan,
    setSmartRunPlan,
    loadingSmartRunPlan,
    setLoadingSmartRunPlan,
    scheduleRunPlan,
    setScheduleRunPlan,
    loadingScheduleRunPlan,
    setLoadingScheduleRunPlan,
    selectedPipelineId,
    setSelectedPipelineId,
    draftWorkflowKey,
    setDraftWorkflowKey,
    aiChatPending,
    setAiChatPending,
    baselineDraft,
    setBaselineDraft,
    isNewDraft,
    setIsNewDraft,
    savingPipeline,
    setSavingPipeline,
    startingRunPipelineId,
    setStartingRunPipelineId,
    stoppingRunPipelineId,
    setStoppingRunPipelineId,
    pausingRunPipelineId,
    setPausingRunPipelineId,
    resumingRunPipelineId,
    setResumingRunPipelineId,
    resolvingApprovalId,
    setResolvingApprovalId,
    notice,
    setNotice,
    noticeTimerRef,
    autosaveTimerRef,
    smartRunPlanRequestIdRef,
    smartRunPlanLastSignatureRef,
    smartRunPlanInFlightSignatureRef,
    smartRunPlanCacheRef,
    scheduleRunPlanRef,
    scheduleRunPlanRequestIdRef,
    scheduleRunPlanInFlightSignatureRef,
    scheduleRunPlanLastSignatureRef,
    scheduleRunPlanCacheRef,
    smartRunPlanRef,
    savingPipelineRef,
    selectedPipelineIdRef,
    draftWorkflowKeyRef,
    mockRunActive,
    setMockRunActive,
    debugPreviewDispatchRouteId,
    setDebugPreviewDispatchRouteId,
    debugEnabled,
    setDebugEnabled,
    desktopNotifications,
    setDesktopNotifications,
    settingsOpen,
    setSettingsOpen,
    canvasDragActive,
    setCanvasDragActive,
    providerOauthStatuses,
    setProviderOauthStatuses,
    providerOauthMessages,
    setProviderOauthMessages,
    runInputModal,
    setRunInputModal,
    runCompletionModal,
    setRunCompletionModal,
    processingRunInputModal,
    setProcessingRunInputModal,
    runtimeInputPromptSeenRef,
    runStatusSnapshotRef,
    inputModalNotificationSignatureRef,
    draft,
    applyDraftChange,
    resetDraftHistory,
    undoDraftChange,
    redoDraftChange,
    canUndo,
    canRedo
  };
}
