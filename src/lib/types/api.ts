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

export interface ApiHealthStatus {
  ok: boolean;
  now: string;
  version?: string;
  realtime?: {
    enabled: boolean;
    path: string;
  };
  updater?: {
    configured: boolean;
  };
}

export type PairingSessionStatus =
  | "pending"
  | "approved"
  | "claimed"
  | "cancelled"
  | "expired";

export interface PairingSessionSummary {
  id: string;
  status: PairingSessionStatus;
  clientName: string;
  platform: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  approvedAt?: string;
  claimedAt?: string;
  deviceTokenExpiresAt?: string;
}

export interface PairingSessionCreated extends PairingSessionSummary {
  code: string;
  realtimePath: string;
}

export type UpdateChannel = "stable" | "prerelease";

export interface UpdateServiceStatus {
  channel: UpdateChannel;
  currentTag: string;
  currentVersion?: string;
  latestTag?: string;
  latestPublishedAt?: string;
  updateAvailable: boolean;
  rollbackAvailable: boolean;
  busy: boolean;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  lastError?: string;
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
  requestId?: string;
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
  requestId?: string;
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

export type StorageFilesScope = "shared" | "isolated" | "runs";

export interface StorageFileEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  sizeBytes: number | null;
  updatedAt: string;
}

export interface StorageFileListQuery {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string;
  path?: string;
}

export interface StorageFileListResponse {
  pipelineId: string;
  scope: StorageFilesScope;
  runId: string | null;
  rootLabel: string;
  currentPath: string;
  parentPath: string | null;
  exists: boolean;
  entries: StorageFileEntry[];
  truncated: boolean;
}

export interface StorageFileContentQuery {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string;
  path: string;
  maxBytes?: number;
}

export type StorageFilePreviewKind = "text" | "html";

export interface StorageFileContentResponse {
  pipelineId: string;
  scope: StorageFilesScope;
  runId: string | null;
  rootLabel: string;
  path: string;
  name: string;
  mimeType: string;
  previewKind: StorageFilePreviewKind;
  sizeBytes: number;
  truncated: boolean;
  maxBytes: number;
  content: string;
}

export interface StorageFileDeletePayload {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string;
  path: string;
  recursive?: boolean;
}

export interface StorageFileUploadChunkPayload {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string;
  destinationPath: string;
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  totalSizeBytes: number;
  chunkBase64: string;
  overwrite?: boolean;
}

export interface StorageFileUploadResponse {
  pipelineId: string;
  scope: StorageFilesScope;
  runId: string | null;
  path: string;
  sizeBytes?: number;
  chunkIndex?: number;
  totalChunks?: number;
  receivedBytes?: number;
  status: "chunk_received" | "completed";
}

export interface StorageFileImportUrlPayload {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string;
  sourceUrl: string;
  destinationPath?: string;
  overwrite?: boolean;
}

export interface StorageFileImportUrlResponse {
  pipelineId: string;
  scope: StorageFilesScope;
  runId: string | null;
  path: string;
  sizeBytes: number;
  sourceUrl: string;
}
