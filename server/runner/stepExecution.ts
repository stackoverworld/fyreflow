import { isAbortError } from "../abort.js";
import type { LocalStore } from "../storage.js";
import type {
  McpServerConfig,
  PipelineLink,
  PipelineQualityGate,
  PipelineStep,
  ProviderConfig
} from "../types.js";
import type { RunInputs } from "../runInputs.js";
import type { StepStoragePaths } from "./types.js";
import { evaluateStepExecution, type StepExecutionOutput } from "./execution.js";

export interface StepExecutionInput {
  store: LocalStore;
  runId: string;
  step: PipelineStep;
  attempt: number;
  provider: ProviderConfig | undefined;
  context: string;
  task: string;
  stageTimeoutMs: number;
  mcpServersById: Map<string, McpServerConfig>;
  runInputs: RunInputs;
  outgoingLinks: PipelineLink[];
  qualityGates: PipelineQualityGate[];
  stepById: Map<string, PipelineStep>;
  storagePaths: StepStoragePaths;
  abortSignal?: AbortSignal;
}

export type StepExecutionOutcome =
  | { status: "success"; stepExecution: StepExecutionOutput }
  | { status: "cancelled" }
  | { status: "aborted"; message: string }
  | { status: "failed"; message: string };

export async function executeStepForPipeline(input: StepExecutionInput): Promise<StepExecutionOutcome> {
  try {
    return {
      status: "success",
      stepExecution: await evaluateStepExecution(input)
    };
  } catch (error) {
    if (input.abortSignal?.aborted) {
      return { status: "cancelled" };
    }

    if (isAbortError(error)) {
      return {
        status: "aborted",
        message: error instanceof Error ? error.message : "Step aborted"
      };
    }

    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown step execution error"
    };
  }
}
