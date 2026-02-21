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
  RunStartupCheck,
  SmartRunPlan,
  StorageConfig,
  StorageConfigPayload
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_TOKEN = (import.meta.env.VITE_DASHBOARD_API_TOKEN ?? "").trim();

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors; fallback to raw text.
  }

  return null;
}

function extractApiErrorMessage(payload: Record<string, unknown>): string | null {
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error.trim();
  }
  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message.trim();
  }
  return null;
}

function extractFirstFailure(payload: Record<string, unknown>): string | null {
  const failedChecks = payload.failedChecks;
  if (Array.isArray(failedChecks) && failedChecks.length > 0) {
    const first = failedChecks[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const check = first as Record<string, unknown>;
      const title = typeof check.title === "string" ? check.title.trim() : "";
      const message = typeof check.message === "string" ? check.message.trim() : "";
      if (title.length > 0 && message.length > 0) {
        return `${title}: ${message}`;
      }
      if (message.length > 0) {
        return message;
      }
    }
  }

  const details = payload.details;
  if (Array.isArray(details) && details.length > 0) {
    const first = details[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const detail = first as Record<string, unknown>;
      const message = typeof detail.message === "string" ? detail.message.trim() : "";
      if (message.length > 0) {
        return message;
      }
    }
  }

  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (API_TOKEN.length > 0) {
    headers.set("Authorization", `Bearer ${API_TOKEN}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = (await response.text()).trim();
    const payload = tryParseJsonObject(text);
    const baseMessage = payload ? extractApiErrorMessage(payload) : null;
    const firstFailure = payload ? extractFirstFailure(payload) : null;
    let message = baseMessage || text || `Request failed with ${response.status}`;

    if (firstFailure && !message.includes(firstFailure)) {
      message = `${message} (${firstFailure})`;
    }

    throw new Error(message);
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

export async function getProviderOAuthStatus(
  providerId: ProviderId,
  options?: {
    includeRuntimeProbe?: boolean;
  }
) {
  const params = options?.includeRuntimeProbe ? "?deep=1" : "";
  return request<{ status: ProviderOAuthStatus }>(`/api/providers/${providerId}/oauth/status${params}`);
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

export async function startRun(
  pipelineId: string,
  task?: string,
  inputs?: Record<string, string>,
  scenario?: string
) {
  return request<{ run: PipelineRun }>(`/api/pipelines/${pipelineId}/runs`, {
    method: "POST",
    body: JSON.stringify({ task, inputs, scenario })
  });
}

export async function stopRun(runId: string) {
  return request<{ run: PipelineRun }>(`/api/runs/${runId}/stop`, {
    method: "POST"
  });
}

export async function pauseRun(runId: string) {
  return request<{ run: PipelineRun }>(`/api/runs/${runId}/pause`, {
    method: "POST"
  });
}

export async function resumeRun(runId: string) {
  return request<{ run: PipelineRun }>(`/api/runs/${runId}/resume`, {
    method: "POST"
  });
}

export async function resolveRunApproval(
  runId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string
) {
  return request<{ run: PipelineRun }>(`/api/runs/${runId}/approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    body: JSON.stringify({
      decision,
      note
    })
  });
}

export async function getSmartRunPlan(pipelineId: string, inputs?: Record<string, string>) {
  return request<{ plan: SmartRunPlan }>(`/api/pipelines/${pipelineId}/smart-run-plan`, {
    method: "POST",
    body: JSON.stringify({ inputs: inputs ?? {} })
  });
}

export async function getRunStartupCheck(pipelineId: string, task?: string, inputs?: Record<string, string>) {
  return request<{ check: RunStartupCheck }>(`/api/pipelines/${pipelineId}/startup-check`, {
    method: "POST",
    body: JSON.stringify({ task, inputs: inputs ?? {} })
  });
}

export async function savePipelineSecureInputs(pipelineId: string, inputs: Record<string, string>) {
  return request<{ savedKeys: string[] }>(`/api/pipelines/${pipelineId}/secure-inputs`, {
    method: "POST",
    body: JSON.stringify({ inputs })
  });
}

export async function deletePipelineSecureInputs(pipelineId: string, keys?: string[]) {
  return request<{ deletedKeys: string[]; remainingKeys: string[] }>(`/api/pipelines/${pipelineId}/secure-inputs`, {
    method: "DELETE",
    body: JSON.stringify({ keys: keys ?? [] })
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
