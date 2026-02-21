import type { DashboardState, PipelinePayload, ProviderId, RunInputRequest, RunStartupBlocker, SmartRunPlan } from "@/lib/types";
import { type WorkspacePanel } from "../useNavigationState";
import type { Dispatch, SetStateAction } from "react";

export type RunInputModalSource = "startup" | "runtime";
export type DesktopNotificationEvent = "inputRequired" | "runFailed" | "runCompleted";

export interface RunInputModalContext {
  source: RunInputModalSource;
  pipelineId: string;
  task: string;
  runId?: string;
  requests: RunInputRequest[];
  blockers: RunStartupBlocker[];
  summary: string;
  inputs: Record<string, string>;
  confirmLabel: string;
}

export interface RunCompletionModalContext {
  runId: string;
  pipelineId: string;
  pipelineName: string;
  task: string;
  completedSteps: number;
  totalSteps: number;
  finishedAt?: string;
  finalStepName?: string;
  finalOutputPreview?: string;
}

export interface UseAppStateOptions {
  activePanel: WorkspacePanel;
  setActivePanel: Dispatch<SetStateAction<WorkspacePanel>>;
}

export interface AppStateDraftState {
  draft: PipelinePayload;
  baselineDraft: PipelinePayload;
  isNewDraft: boolean;
}

export interface AppStateRunState {
  smartRunPlan: SmartRunPlan | null;
  scheduleRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  loadingScheduleRunPlan: boolean;
}

export interface AppStateGlobalState {
  pipelines: DashboardState["pipelines"];
  providers: DashboardState["providers"] | null;
  mcpServers: DashboardState["mcpServers"];
  storageConfig: DashboardState["storage"] | null;
  runs: DashboardState["runs"];
  selectedPipelineId: string | null;
}

export interface AppStateUiState {
  notice: string;
  savingPipeline: boolean;
  startingRunPipelineId: string | null;
  stoppingRunPipelineId: string | null;
  pausingRunPipelineId: string | null;
  resumingRunPipelineId: string | null;
  resolvingApprovalId: string | null;
  settingsOpen: boolean;
  canvasDragActive: boolean;
}

export interface AppStateNotificationConfig {
  providers: DashboardState["providers"] | null;
}

export interface AppStateProviderInfo {
  id: ProviderId;
}

export interface AppStateEffectsDeps {
  setNotice: (notice: string) => void;
}

export const AUTOSAVE_DELAY_MS = 1000;
export const SCHEDULE_RUN_PLAN_DEBOUNCE_MS = 750;
export const RUNTIME_INPUT_PROMPT_CACHE_LIMIT = 240;
export const MAX_DESKTOP_NOTIFICATION_BODY_LENGTH = 220;

export const jsonEquals = (a: unknown, b: unknown): boolean => {
  return JSON.stringify(a) === JSON.stringify(b);
};

export function truncateNotificationBody(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_DESKTOP_NOTIFICATION_BODY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_DESKTOP_NOTIFICATION_BODY_LENGTH - 1)}…`;
}
