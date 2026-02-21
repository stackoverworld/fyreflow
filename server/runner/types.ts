import type { LocalStore } from "../storage.js";
import type { Pipeline } from "../types.js";
import type { RunInputs } from "../runInputs.js";

export interface RunPipelineInput {
  store: LocalStore;
  runId: string;
  pipeline: Pipeline;
  task: string;
  runInputs?: RunInputs;
  scenario?: string;
  abortSignal?: AbortSignal;
}

export interface RuntimeConfig {
  maxLoops: number;
  maxStepExecutions: number;
  stageTimeoutMs: number;
}

export interface TimelineEntry {
  stepId: string;
  stepName: string;
  output: string;
}

export interface StepStoragePaths {
  sharedStoragePath: string;
  isolatedStoragePath: string;
  runStoragePath: string;
}
