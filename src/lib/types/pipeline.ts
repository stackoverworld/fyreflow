export type ProviderId = "openai" | "claude";
export type AuthMode = "api_key" | "oauth";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentRole =
  | "analysis"
  | "planner"
  | "orchestrator"
  | "executor"
  | "tester"
  | "review";
export type WorkflowOutcome = "neutral" | "pass" | "fail";
export type LinkCondition = "always" | "on_pass" | "on_fail";
export type McpTransport = "stdio" | "http" | "sse";
export type McpHealth = "unknown" | "healthy" | "degraded" | "down";
export type StepOutputFormat = "markdown" | "json";
export type QualityGateKind =
  | "regex_must_match"
  | "regex_must_not_match"
  | "json_field_exists"
  | "artifact_exists"
  | "manual_approval";
export type QualityGateTarget = "any_step" | string;
export type ScheduleRunMode = "smart" | "quick";

export interface PipelineStep {
  id: string;
  name: string;
  role: AgentRole;
  prompt: string;
  providerId: ProviderId;
  model: string;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  use1MContext: boolean;
  contextWindowTokens: number;
  position: {
    x: number;
    y: number;
  };
  contextTemplate: string;
  enableDelegation: boolean;
  delegationCount: number;
  enableIsolatedStorage: boolean;
  enableSharedStorage: boolean;
  enabledMcpServerIds: string[];
  outputFormat: StepOutputFormat;
  requiredOutputFields: string[];
  requiredOutputFiles: string[];
  scenarios: string[];
  skipIfArtifacts: string[];
  policyProfileIds: string[];
  cacheBypassInputKeys: string[];
  cacheBypassOrchestratorPromptPatterns: string[];
}

export interface PipelineLink {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  condition: LinkCondition;
}

export interface PipelineRuntimeConfig {
  maxLoops: number;
  maxStepExecutions: number;
  stageTimeoutMs: number;
}

export interface PipelineScheduleConfig {
  enabled: boolean;
  cron: string;
  timezone: string;
  task: string;
  runMode: ScheduleRunMode;
  inputs: Record<string, string>;
}

export interface PipelineQualityGate {
  id: string;
  name: string;
  targetStepId: QualityGateTarget;
  kind: QualityGateKind;
  blocking: boolean;
  pattern: string;
  flags: string;
  jsonPath: string;
  artifactPath: string;
  message: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  steps: PipelineStep[];
  links: PipelineLink[];
  runtime: PipelineRuntimeConfig;
  schedule: PipelineScheduleConfig;
  qualityGates: PipelineQualityGate[];
}

export interface PipelinePayload {
  name: string;
  description: string;
  steps: Array<{
    id: string;
    name: string;
    role: AgentRole;
    prompt: string;
    providerId: ProviderId;
    model: string;
    reasoningEffort: ReasoningEffort;
    fastMode: boolean;
    use1MContext: boolean;
    contextWindowTokens: number;
    position: {
      x: number;
      y: number;
    };
    contextTemplate: string;
    enableDelegation: boolean;
    delegationCount: number;
    enableIsolatedStorage: boolean;
    enableSharedStorage: boolean;
    enabledMcpServerIds: string[];
    outputFormat: StepOutputFormat;
    requiredOutputFields: string[];
    requiredOutputFiles: string[];
    scenarios: string[];
    skipIfArtifacts: string[];
    policyProfileIds: string[];
    cacheBypassInputKeys: string[];
    cacheBypassOrchestratorPromptPatterns: string[];
  }>;
  links: Array<{
    id?: string;
    sourceStepId: string;
    targetStepId: string;
    condition?: LinkCondition;
  }>;
  qualityGates: Array<{
    id?: string;
    name: string;
    targetStepId: QualityGateTarget;
    kind: QualityGateKind;
    blocking: boolean;
    pattern?: string;
    flags?: string;
    jsonPath?: string;
    artifactPath?: string;
    message?: string;
  }>;
  runtime?: Partial<PipelineRuntimeConfig>;
  schedule?: Partial<PipelineScheduleConfig>;
}
