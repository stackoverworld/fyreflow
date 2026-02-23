import { type useAppState } from "@/app/useAppState";

export type AppShellActions = Pick<
  ReturnType<typeof useAppState>,
  |
    "setNotice"
    | "setTheme"
    | "setCanvasDragActive"
    | "setRunInputModal"
    | "setRunCompletionModal"
    | "setMockRunActive"
    | "setDebugPreviewDispatchRouteId"
    | "setDebugEnabled"
    | "setDesktopNotifications"
    | "setSettingsOpen"
    | "applyEditableDraftChange"
    | "applyDraftChange"
    | "undoDraftChange"
    | "redoDraftChange"
    | "handleAddStep"
    | "handleSpawnOrchestrator"
    | "handleLoadSmartRunPlan"
    | "handleLoadScheduleRunPlan"
    | "handleRunPanelDraftStateChange"
    | "handleStartRun"
    | "handleStopRun"
    | "handlePauseRun"
    | "handleResumeRun"
    | "handleResolveRunApproval"
    | "handleForgetSecureInput"
    | "handleConfirmRunInputModal"
    | "handleCreatePipelineDraft"
    | "handleDeletePipeline"
    | "selectPipeline"
    | "handleSaveProvider"
    | "handleCreateMcpServer"
    | "handleUpdateMcpServer"
    | "handleDeleteMcpServer"
    | "handleSaveStorageConfig"
    | "handleProviderOauthStatusChange"
    | "handleProviderOauthMessageChange"
>;

export function useAppShellActions(state: ReturnType<typeof useAppState>): AppShellActions {
  const {
    setNotice,
    setTheme,
    setCanvasDragActive,
    setRunInputModal,
    setRunCompletionModal,
    setMockRunActive,
    setDebugPreviewDispatchRouteId,
    setDebugEnabled,
    setDesktopNotifications,
    setSettingsOpen,
    applyEditableDraftChange,
    applyDraftChange,
    undoDraftChange,
    redoDraftChange,
    handleAddStep,
    handleSpawnOrchestrator,
    handleLoadSmartRunPlan,
    handleLoadScheduleRunPlan,
    handleRunPanelDraftStateChange,
    handleStartRun,
    handleStopRun,
    handlePauseRun,
    handleResumeRun,
    handleResolveRunApproval,
    handleForgetSecureInput,
    handleConfirmRunInputModal,
    handleCreatePipelineDraft,
    handleDeletePipeline,
    selectPipeline,
    handleSaveProvider,
    handleCreateMcpServer,
    handleUpdateMcpServer,
    handleDeleteMcpServer,
    handleSaveStorageConfig,
    handleProviderOauthStatusChange,
    handleProviderOauthMessageChange
  } = state;

  return {
    setNotice,
    setTheme,
    setCanvasDragActive,
    setRunInputModal,
    setRunCompletionModal,
    setMockRunActive,
    setDebugPreviewDispatchRouteId,
    setDebugEnabled,
    setDesktopNotifications,
    setSettingsOpen,
    applyEditableDraftChange,
    applyDraftChange,
    undoDraftChange,
    redoDraftChange,
    handleAddStep,
    handleSpawnOrchestrator,
    handleLoadSmartRunPlan,
    handleLoadScheduleRunPlan,
    handleRunPanelDraftStateChange,
    handleStartRun,
    handleStopRun,
    handlePauseRun,
    handleResumeRun,
    handleResolveRunApproval,
    handleForgetSecureInput,
    handleConfirmRunInputModal,
    handleCreatePipelineDraft,
    handleDeletePipeline,
    selectPipeline,
    handleSaveProvider,
    handleCreateMcpServer,
    handleUpdateMcpServer,
    handleDeleteMcpServer,
    handleSaveStorageConfig,
    handleProviderOauthStatusChange,
    handleProviderOauthMessageChange
  };
}
