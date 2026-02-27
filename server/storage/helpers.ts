import path from "node:path";
import { nanoid } from "nanoid";
import { resolveDefaultModel } from "../modelCatalog.js";
import { createDefaultPipeline } from "./pipelineStore.js";
import { sanitizePipelines } from "./pipelineStore.js";
import { MASK_VALUE } from "../secureInputs.js";
import { decryptSecret, encryptSecret } from "../secretsCrypto.js";
import { normalizeRuns } from "./runStore.js";
import { resolveDataRootPath } from "../runtime/dataPaths.js";
import type {
  DashboardState,
  McpServerConfig,
  McpServerInput,
  ProviderConfig,
  ProviderId,
  ProviderUpdateInput,
  StorageConfig,
  StorageUpdateInput
} from "../types.js";

const DATA_ROOT_PATH = resolveDataRootPath();

export const DB_PATH = path.join(DATA_ROOT_PATH, "local-db.json");
export const DEFAULT_STORAGE_ROOT_PATH = path.join(DATA_ROOT_PATH, "agent-storage");
export const DEFAULT_SHARED_FOLDER = "shared";
export const DEFAULT_ISOLATED_FOLDER = "isolated";
export const DEFAULT_RUNS_FOLDER = "runs";

export function nowIso(): string {
  return new Date().toISOString();
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export function isMaskedSecretValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() === MASK_VALUE;
}

export function applyProviderUpdate(
  current: ProviderConfig,
  input: ProviderUpdateInput,
  updatedAt: string = nowIso()
): ProviderConfig {
  return {
    ...current,
    authMode: input.authMode ?? current.authMode,
    apiKey: input.apiKey === undefined || isMaskedSecretValue(input.apiKey) ? current.apiKey : input.apiKey,
    oauthToken:
      input.oauthToken === undefined || isMaskedSecretValue(input.oauthToken) ? current.oauthToken : input.oauthToken,
    baseUrl: input.baseUrl ?? current.baseUrl,
    defaultModel: input.defaultModel ?? current.defaultModel,
    updatedAt
  };
}

export function createMcpServerRecord(input: McpServerInput, now = nowIso()): McpServerConfig {
  return {
    id: nanoid(),
    name: input.name.trim(),
    enabled: input.enabled === true,
    transport: input.transport ?? "http",
    command: input.command ?? "",
    args: input.args ?? "",
    url: input.url ?? "",
    env: input.env ?? "",
    headers: input.headers ?? "",
    toolAllowlist: input.toolAllowlist ?? "",
    health: input.health ?? "unknown",
    updatedAt: now
  };
}

export function applyMcpServerUpdate(
  current: McpServerConfig,
  input: Partial<McpServerInput>,
  updatedAt: string = nowIso()
): McpServerConfig {
  return {
    ...current,
    name: typeof input.name === "string" && input.name.trim().length > 0 ? input.name.trim() : current.name,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    transport: input.transport ?? current.transport,
    command: typeof input.command === "string" ? input.command : current.command,
    args: typeof input.args === "string" ? input.args : current.args,
    url: typeof input.url === "string" ? input.url : current.url,
    env: typeof input.env === "string" ? (isMaskedSecretValue(input.env) ? current.env : input.env) : current.env,
    headers:
      typeof input.headers === "string"
        ? isMaskedSecretValue(input.headers)
          ? current.headers
          : input.headers
        : current.headers,
    toolAllowlist: typeof input.toolAllowlist === "string" ? input.toolAllowlist : current.toolAllowlist,
    health: input.health ?? current.health,
    updatedAt
  };
}

export function applyStorageConfigUpdate(
  current: StorageConfig,
  input: StorageUpdateInput,
  updatedAt: string = nowIso()
): StorageConfig {
  return {
    ...current,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    rootPath:
      typeof input.rootPath === "string" && input.rootPath.trim().length > 0 ? input.rootPath.trim() : current.rootPath,
    sharedFolder:
      typeof input.sharedFolder === "string" && input.sharedFolder.trim().length > 0
        ? input.sharedFolder.trim()
        : current.sharedFolder,
    isolatedFolder:
      typeof input.isolatedFolder === "string" && input.isolatedFolder.trim().length > 0
        ? input.isolatedFolder.trim()
        : current.isolatedFolder,
    runsFolder:
      typeof input.runsFolder === "string" && input.runsFolder.trim().length > 0
        ? input.runsFolder.trim()
        : current.runsFolder,
    updatedAt
  };
}

export function decryptProviderSecrets(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: decryptSecret(provider.apiKey),
    oauthToken: decryptSecret(provider.oauthToken)
  };
}

export function encryptProviderSecrets(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: encryptSecret(provider.apiKey),
    oauthToken: encryptSecret(provider.oauthToken)
  };
}

export function decryptMcpSecrets(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: decryptSecret(server.env),
    headers: decryptSecret(server.headers)
  };
}

export function encryptMcpSecrets(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: encryptSecret(server.env),
    headers: encryptSecret(server.headers)
  };
}

function createDefaultProviders(now: string): Record<ProviderId, ProviderConfig> {
  return {
    openai: {
      id: "openai",
      label: "OpenAI / Codex",
      authMode: "api_key",
      apiKey: "",
      oauthToken: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: resolveDefaultModel("openai"),
      updatedAt: now
    },
    claude: {
      id: "claude",
      label: "Anthropic",
      authMode: "api_key",
      apiKey: "",
      oauthToken: "",
      baseUrl: "https://api.anthropic.com/v1",
      defaultModel: resolveDefaultModel("claude"),
      updatedAt: now
    }
  };
}

export function createDefaultStorageConfig(now: string): StorageConfig {
  return {
    enabled: true,
    rootPath: DEFAULT_STORAGE_ROOT_PATH,
    sharedFolder: DEFAULT_SHARED_FOLDER,
    isolatedFolder: DEFAULT_ISOLATED_FOLDER,
    runsFolder: DEFAULT_RUNS_FOLDER,
    updatedAt: now
  };
}

export function createDefaultState(): DashboardState {
  const now = nowIso();

  return {
    providers: createDefaultProviders(now),
    pipelines: [createDefaultPipeline(now)],
    runs: [],
    mcpServers: [],
    storage: createDefaultStorageConfig(now)
  };
}

export function normalizeStorageConfig(raw: DashboardState["storage"] | undefined): StorageConfig {
  const now = nowIso();
  const defaults = createDefaultStorageConfig(now);
  const rootPath =
    raw && typeof raw.rootPath === "string" && raw.rootPath.trim().length > 0 ? raw.rootPath.trim() : defaults.rootPath;
  const sharedFolder =
    raw && typeof raw.sharedFolder === "string" && raw.sharedFolder.trim().length > 0
      ? raw.sharedFolder.trim()
      : defaults.sharedFolder;
  const isolatedFolder =
    raw && typeof raw.isolatedFolder === "string" && raw.isolatedFolder.trim().length > 0
      ? raw.isolatedFolder.trim()
      : defaults.isolatedFolder;
  const runsFolder =
    raw && typeof raw.runsFolder === "string" && raw.runsFolder.trim().length > 0
      ? raw.runsFolder.trim()
      : defaults.runsFolder;

  return {
    enabled: raw?.enabled !== false,
    rootPath,
    sharedFolder,
    isolatedFolder,
    runsFolder,
    updatedAt: typeof raw?.updatedAt === "string" && raw.updatedAt.length > 0 ? raw.updatedAt : now
  };
}

export function normalizeMcpServers(servers: DashboardState["mcpServers"]): DashboardState["mcpServers"] {
  if (!Array.isArray(servers)) {
    return [];
  }

  const now = nowIso();
  return servers
    .map((server) => {
      const transport: McpServerConfig["transport"] =
        server.transport === "stdio" || server.transport === "sse" || server.transport === "http" ? server.transport : "http";
      const health: McpServerConfig["health"] =
        server.health === "healthy" || server.health === "degraded" || server.health === "down" || server.health === "unknown"
          ? server.health
          : "unknown";

      return {
        id: typeof server.id === "string" && server.id.trim().length > 0 ? server.id : nanoid(),
        name: typeof server.name === "string" && server.name.trim().length > 0 ? server.name.trim() : "Untitled MCP",
        enabled: server.enabled === true,
        transport,
        command: typeof server.command === "string" ? server.command : "",
        args: typeof server.args === "string" ? server.args : "",
        url: typeof server.url === "string" ? server.url : "",
        env: typeof server.env === "string" ? server.env : "",
        headers: typeof server.headers === "string" ? server.headers : "",
        toolAllowlist: typeof server.toolAllowlist === "string" ? server.toolAllowlist : "",
        health,
        updatedAt: typeof server.updatedAt === "string" && server.updatedAt.length > 0 ? server.updatedAt : now
      };
    })
    .slice(0, 40);
}

export function sanitizeState(raw: DashboardState): DashboardState {
  const now = nowIso();
  const providers = createDefaultProviders(now);

  const safeProviders = {
    openai: {
      ...providers.openai,
      ...(raw.providers?.openai ?? providers.openai)
    },
    claude: {
      ...providers.claude,
      ...(raw.providers?.claude ?? providers.claude)
    }
  };

  const decryptedProviders = {
    openai: decryptProviderSecrets(safeProviders.openai),
    claude: decryptProviderSecrets(safeProviders.claude)
  };

  return {
    providers: decryptedProviders,
    pipelines: sanitizePipelines(raw.pipelines, now),
    runs: normalizeRuns(raw.runs),
    mcpServers: normalizeMcpServers(raw.mcpServers).map((server) => decryptMcpSecrets(server)),
    storage: normalizeStorageConfig(raw.storage)
  };
}

export function serializeStateForDisk(state: DashboardState): DashboardState {
  return {
    ...state,
    providers: {
      openai: encryptProviderSecrets(state.providers.openai),
      claude: encryptProviderSecrets(state.providers.claude)
    },
    mcpServers: state.mcpServers.map((server) => encryptMcpSecrets(server))
  };
}
