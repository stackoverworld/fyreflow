import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PipelinePayload, SmartRunPlan } from "@/lib/types";
import type { DesktopNotificationEvent, RunInputModalContext, UseAppStateOptions } from "../appStateTypes";
import type { HandleStartRunOptions } from "../appStateRunController";

export type AppStateSetState<T> = Dispatch<SetStateAction<T>>;

export interface AppStateRef<T> {
  value: MutableRefObject<T>;
}

export interface SmartRunPlanLoaderRefs {
  requestIdRef: MutableRefObject<number>;
  inFlightSignatureRef: MutableRefObject<string>;
  lastSignatureRef: MutableRefObject<string>;
  cacheRef: MutableRefObject<Map<string, SmartRunPlan>>;
}

export interface AppStatePlanLoadDeps {
  selectedPipelineId: string | null;
  setLoading: AppStateSetState<boolean>;
  setPlan: AppStateSetState<SmartRunPlan | null>;
  refs: SmartRunPlanLoaderRefs;
  setNotice: (notice: string) => void;
}

export interface AppStateToastConfig {
  event: DesktopNotificationEvent;
  title: string;
  body?: string;
}

export interface AppStateRunPanelDraftState {
  task: string;
  mode: "smart" | "quick";
  inputs: Record<string, string>;
}

export interface PipelineSaveOptions {
  draftSnapshot?: PipelinePayload;
  silent?: boolean;
}

export type { HandleStartRunOptions, UseAppStateOptions, RunInputModalContext };
