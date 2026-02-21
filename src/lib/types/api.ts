import type {
  AuthMode,
  McpHealth,
  McpTransport,
  PipelinePayload,
  Pipeline,
  ProviderId,
  ReasoningEffort,
} from "./pipeline";
import type { PipelineRun } from "./runtime";

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
  cliCommand?: string;
  cliAvailable: boolean;
  loggedIn: boolean;
  tokenAvailable: boolean;
  canUseApi: boolean;
  canUseCli: boolean;
  message: string;
  checkedAt: string;
  runtimeProbe?: ProviderRuntimeProbe;
}

export interface ProviderRuntimeProbe {
  status: "pass" | "fail";
  message: string;
  checkedAt: string;
  latencyMs?: number;
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

export type FlowBuilderAction = "answer" | "update_current_flow" | "replace_flow";

export interface FlowBuilderQuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface FlowBuilderQuestion {
  id: string;
  question: string;
  options: FlowBuilderQuestionOption[];
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
  availableMcpServers?: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    transport?: McpTransport;
    summary?: string;
  }>;
}

export interface FlowBuilderResponse {
  action: FlowBuilderAction;
  message: string;
  draft?: PipelinePayload;
  questions?: FlowBuilderQuestion[];
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
  questions?: FlowBuilderQuestion[];
  source?: "model" | "fallback";
  notes?: string[];
  timestamp: number;
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
