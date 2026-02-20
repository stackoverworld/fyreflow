export type ProviderId = "openai" | "claude";
export type AuthMode = "api_key" | "oauth";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentRole = "analysis" | "planner" | "orchestrator" | "executor" | "tester" | "review";
export type WorkflowOutcome = "neutral" | "pass" | "fail";
export type LinkCondition = "always" | "on_pass" | "on_fail";
export type McpTransport = "stdio" | "http" | "sse";
export type McpHealth = "unknown" | "healthy" | "degraded" | "down";
export type StepOutputFormat = "markdown" | "json";
export type QualityGateKind = "regex_must_match" | "regex_must_not_match" | "json_field_exists" | "artifact_exists";
export type QualityGateTarget = "any_step" | string;
export type QualityGateResultStatus = "pass" | "fail";
export type SmartRunFieldType = "text" | "multiline" | "secret" | "path" | "url";
export type SmartRunCheckStatus = "pass" | "warn" | "fail";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  authMode: AuthMode;
  apiKey: string;
  oauthToken: string;
  baseUrl: string;
  defaultModel: string;
  updatedAt: string;
}

export interface ProviderOAuthStatus {
  providerId: ProviderId;
  loginSource: string;
  cliAvailable: boolean;
  loggedIn: boolean;
  tokenAvailable: boolean;
  canUseApi: boolean;
  canUseCli: boolean;
  message: string;
  checkedAt: string;
}

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
  qualityGates: PipelineQualityGate[];
}

export type StepRunStatus = "pending" | "running" | "completed" | "failed";
export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface StepQualityGateResult {
  gateId: string;
  gateName: string;
  kind: QualityGateKind | "step_contract";
  status: QualityGateResultStatus;
  blocking: boolean;
  message: string;
  details: string;
}

export interface StepRun {
  stepId: string;
  stepName: string;
  role: AgentRole;
  status: StepRunStatus;
  attempts: number;
  workflowOutcome: WorkflowOutcome;
  inputContext: string;
  output: string;
  subagentNotes: string[];
  qualityGateResults: StepQualityGateResult[];
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  pipelineName: string;
  task: string;
  inputs: Record<string, string>;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  steps: StepRun[];
}

export interface SmartRunField {
  key: string;
  label: string;
  type: SmartRunFieldType;
  required: boolean;
  description: string;
  placeholder: string;
  sources: string[];
}

export interface SmartRunCheck {
  id: string;
  title: string;
  status: SmartRunCheckStatus;
  message: string;
  details?: string;
}

export interface SmartRunPlan {
  fields: SmartRunField[];
  checks: SmartRunCheck[];
  canRun: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
  toolAllowlist: string;
  health: McpHealth;
  updatedAt: string;
}

export interface StorageConfig {
  enabled: boolean;
  rootPath: string;
  sharedFolder: string;
  isolatedFolder: string;
  runsFolder: string;
  updatedAt: string;
}

export interface DashboardState {
  providers: Record<ProviderId, ProviderConfig>;
  pipelines: Pipeline[];
  runs: PipelineRun[];
  mcpServers: McpServerConfig[];
  storage: StorageConfig;
}

export interface FlowBuilderRequest {
  prompt: string;
  providerId: ProviderId;
  model: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  use1MContext?: boolean;
  history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  currentDraft?: PipelinePayload;
}

export type FlowBuilderAction = "answer" | "update_current_flow" | "replace_flow";

export interface FlowBuilderResponse {
  action: FlowBuilderAction;
  message: string;
  draft?: PipelinePayload;
  source: "model" | "fallback";
  notes: string[];
  rawOutput?: string;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  generatedDraft?: PipelinePayload;
  action?: FlowBuilderAction;
  source?: "model" | "fallback";
  notes?: string[];
  timestamp: number;
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
}

export interface McpServerPayload {
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

export interface StorageConfigPayload {
  enabled?: boolean;
  rootPath?: string;
  sharedFolder?: string;
  isolatedFolder?: string;
  runsFolder?: string;
}
