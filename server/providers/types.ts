import type { PipelineStep, ProviderConfig } from "../types.js";

export type ClaudeEffort = "low" | "medium" | "high";

export interface ClaudeApiOptions {
  disable1MContext?: boolean;
  disableEffort?: boolean;
  disableOutputFormat?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface ProviderExecutionInput {
  provider: ProviderConfig;
  step: PipelineStep;
  context: string;
  task: string;
  mcpServerIds?: string[];
  stageTimeoutMs?: number;
  log?: (message: string) => void;
  outputMode?: "markdown" | "json";
  signal?: AbortSignal;
}

export type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";
