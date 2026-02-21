import type {
  PipelineStep,
  PipelineLink,
  PipelineRuntimeConfig,
  PipelineScheduleConfig,
  PipelineQualityGate,
  AuthMode,
  McpTransport,
  McpHealth,
} from "./contracts.js";

export interface PipelineInput {
  name: string;
  description: string;
  steps: Array<Partial<PipelineStep> & Pick<PipelineStep, "name" | "role" | "prompt">>;
  links?: Array<Partial<PipelineLink> & Pick<PipelineLink, "sourceStepId" | "targetStepId">>;
  runtime?: Partial<PipelineRuntimeConfig>;
  schedule?: Partial<PipelineScheduleConfig>;
  qualityGates?: Array<Partial<PipelineQualityGate> & Pick<PipelineQualityGate, "name" | "kind">>;
}

export interface ProviderUpdateInput {
  authMode?: AuthMode;
  apiKey?: string;
  oauthToken?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface McpServerInput {
  name: string;
  enabled?: boolean;
  transport?: McpTransport;
  command?: string;
  args?: string;
  url?: string;
  env?: string;
  headers?: string;
  toolAllowlist?: string;
  health?: McpHealth;
}

export interface StorageUpdateInput {
  enabled?: boolean;
  rootPath?: string;
  sharedFolder?: string;
  isolatedFolder?: string;
  runsFolder?: string;
}
