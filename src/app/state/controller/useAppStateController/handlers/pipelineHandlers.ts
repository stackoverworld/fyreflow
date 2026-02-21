import { useCallback, type MutableRefObject, type SetStateAction } from "react";
import type { DashboardState, PipelinePayload, SmartRunPlan } from "@/lib/types";
import type { AppStateSetState, PipelineSaveOptions, UseAppStateOptions } from "../../types";
import {
  handleAddStepAction,
  handleCreatePipelineDraftAction,
  handleDeletePipelineAction,
  handleSavePipelineAction,
  handleSelectPipelineAction,
  handleSpawnOrchestratorAction
} from "../dispatchers";
import { selectPipelineSaveValidationError } from "../stateSelectors";

type SetAppPanel = UseAppStateOptions["setActivePanel"];

export interface PipelineHandlersArgs {
  pipelines: DashboardState["pipelines"];
  runs: DashboardState["runs"];
  draft: PipelinePayload;
  selectedPipelineId: string | null;
  draftWorkflowKey: string;
  isNewDraft: boolean;
  startingRunPipelineId: string | null;
  stoppingRunPipelineId: string | null;
  pausingRunPipelineId: string | null;
  resumingRunPipelineId: string | null;
  selectedPipelineEditLocked: boolean;
  autosaveTimerRef: MutableRefObject<number | undefined>;
  savingPipelineRef: MutableRefObject<boolean>;
  selectedPipelineIdRef: MutableRefObject<string | null>;
  draftWorkflowKeyRef: MutableRefObject<string>;
  setActivePanel: SetAppPanel;
  applyDraftChange: (next: SetStateAction<PipelinePayload>) => void;
  resetDraftHistory: (nextDraft: PipelinePayload) => void;
  setNotice: AppStateSetState<string>;
  setPipelines: AppStateSetState<DashboardState["pipelines"]>;
  setSmartRunPlan: AppStateSetState<SmartRunPlan | null>;
  setScheduleRunPlan: AppStateSetState<SmartRunPlan | null>;
  setSelectedPipelineId: AppStateSetState<string | null>;
  setDraftWorkflowKey: AppStateSetState<string>;
  setBaselineDraft: AppStateSetState<PipelinePayload>;
  setIsNewDraft: AppStateSetState<boolean>;
  setSavingPipeline: AppStateSetState<boolean>;
}

export interface PipelineHandlersResult {
  selectPipeline: (pipelineId: string) => void;
  handleCreatePipelineDraft: () => void;
  handleDeletePipeline: (pipelineId: string) => Promise<void>;
  handleSavePipeline: (args?: PipelineSaveOptions) => Promise<boolean>;
  handleAddStep: () => void;
  handleSpawnOrchestrator: () => void;
}

export function usePipelineHandlers(args: PipelineHandlersArgs): PipelineHandlersResult {
  const {
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
  } = args;

  const selectPipeline = useCallback(
    (pipelineId: string) => {
      handleSelectPipelineAction(pipelineId, {
        pipelines,
        autosaveTimerRef,
        setSelectedPipelineId,
        resetDraftHistory,
        setBaselineDraft,
        setSmartRunPlan,
        setScheduleRunPlan,
        setNotice,
        setActivePanel
      });
    },
    [autosaveTimerRef, pipelines, resetDraftHistory, setActivePanel]
  );

  const handleCreatePipelineDraft = useCallback(() => {
    handleCreatePipelineDraftAction({
      autosaveTimerRef,
      setDraftWorkflowKey,
      setSelectedPipelineId,
      resetDraftHistory,
      setBaselineDraft,
      setIsNewDraft,
      setSmartRunPlan,
      setScheduleRunPlan,
      setNotice,
      setActivePanel
    });
  }, [resetDraftHistory, setActivePanel]);

  const handleDeletePipeline = async (pipelineId: string) => {
    await handleDeletePipelineAction(pipelineId, {
      runs,
      selectedPipelineId,
      startingRunPipelineId,
      stoppingRunPipelineId,
      pausingRunPipelineId,
      resumingRunPipelineId,
      setNotice,
      setPipelines,
      pipelines,
      selectPipeline,
      handleCreatePipelineDraft
    });
  };

  const handleSavePipeline = useCallback(
    async ({
      draftSnapshot = draft,
      silent = false
    }: PipelineSaveOptions = {}) => {
      return await handleSavePipelineAction(
        { draftSnapshot, silent },
        {
          draft,
          selectPipelineSaveValidationError,
          savingPipelineRef,
          setSavingPipeline,
          setPipelines,
          selectedPipelineId,
          draftWorkflowKey,
          isNewDraft,
          setSelectedPipelineId,
          setBaselineDraft,
          setIsNewDraft,
          setNotice,
          selectedPipelineIdRef,
          draftWorkflowKeyRef
        }
      );
    },
    [draft, draftWorkflowKey, isNewDraft, selectedPipelineId]
  );

  const handleAddStep = () => {
    handleAddStepAction({
      selectedPipelineEditLocked,
      applyDraftChange,
      setNotice
    });
  };

  const handleSpawnOrchestrator = () => {
    handleSpawnOrchestratorAction({
      selectedPipelineEditLocked,
      applyDraftChange,
      setNotice
    });
  };

  return {
    selectPipeline,
    handleCreatePipelineDraft,
    handleDeletePipeline,
    handleSavePipeline,
    handleAddStep,
    handleSpawnOrchestrator
  };
}
