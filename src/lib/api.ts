import type {
  DashboardState,
  FlowBuilderRequest,
  FlowBuilderResponse,
  McpServerConfig,
  McpServerPayload,
  PipelinePayload,
  PipelineRun,
  ProviderConfig,
  ProviderId,
  ProviderOAuthStatus,
  SmartRunPlan,
  StorageConfig,
  StorageConfigPayload
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getState(): Promise<DashboardState> {
  return request<DashboardState>("/api/state");
}

export async function createPipeline(payload: PipelinePayload) {
  return request<{ pipeline: DashboardState["pipelines"][number] }>("/api/pipelines", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updatePipeline(pipelineId: string, payload: PipelinePayload) {
  return request<{ pipeline: DashboardState["pipelines"][number] }>(`/api/pipelines/${pipelineId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deletePipeline(pipelineId: string): Promise<void> {
  return request<void>(`/api/pipelines/${pipelineId}`, { method: "DELETE" });
}

export async function updateProvider(providerId: ProviderId, payload: Partial<ProviderConfig>) {
  return request<{ provider: ProviderConfig }>(`/api/providers/${providerId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function listMcpServers() {
  return request<{ mcpServers: McpServerConfig[] }>("/api/mcp-servers");
}

export async function createMcpServer(payload: McpServerPayload) {
  return request<{ mcpServer: McpServerConfig }>("/api/mcp-servers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateMcpServer(serverId: string, payload: Partial<McpServerPayload>) {
  return request<{ mcpServer: McpServerConfig }>(`/api/mcp-servers/${serverId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteMcpServer(serverId: string) {
  return request<void>(`/api/mcp-servers/${serverId}`, {
    method: "DELETE"
  });
}

export async function updateStorageConfig(payload: StorageConfigPayload) {
  return request<{ storage: StorageConfig }>("/api/storage", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function getProviderOAuthStatus(providerId: ProviderId) {
  return request<{ status: ProviderOAuthStatus }>(`/api/providers/${providerId}/oauth/status`);
}

export async function startProviderOAuthLogin(providerId: ProviderId) {
  return request<{ result: { message: string; command: string }; status: ProviderOAuthStatus }>(
    `/api/providers/${providerId}/oauth/start`,
    {
      method: "POST"
    }
  );
}

export async function syncProviderOAuthToken(providerId: ProviderId) {
  return request<{
    provider: ProviderConfig;
    result: { message: string; oauthToken?: string; status: ProviderOAuthStatus };
  }>(`/api/providers/${providerId}/oauth/sync-token`, {
    method: "POST"
  });
}

export async function startRun(pipelineId: string, task: string, inputs?: Record<string, string>) {
  return request<{ run: PipelineRun }>(`/api/pipelines/${pipelineId}/runs`, {
    method: "POST",
    body: JSON.stringify({ task, inputs })
  });
}

export async function getSmartRunPlan(pipelineId: string, inputs?: Record<string, string>) {
  return request<{ plan: SmartRunPlan }>(`/api/pipelines/${pipelineId}/smart-run-plan`, {
    method: "POST",
    body: JSON.stringify({ inputs: inputs ?? {} })
  });
}

export async function listRuns(limit = 30) {
  return request<{ runs: PipelineRun[] }>(`/api/runs?limit=${limit}`);
}

export async function generateFlowDraft(payload: FlowBuilderRequest) {
  return request<FlowBuilderResponse>("/api/flow-builder/generate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
