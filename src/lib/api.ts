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
  StorageConfigPayload,
  StorageFileContentQuery,
  StorageFileContentResponse,
  StorageFileDeletePayload,
  StorageFileListQuery,
  StorageFileListResponse,
  StorageFilesScope
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_TOKEN = (import.meta.env.VITE_DASHBOARD_API_TOKEN ?? "").trim();
const FLOW_BUILDER_GENERATE_PATH = "/api/flow-builder/generate";
const FLOW_BUILDER_RETRY_ATTEMPTS = 2;
const FLOW_BUILDER_RETRY_DELAY_MS = 250;
const DEFAULT_API_REQUEST_TIMEOUT_MS = 120_000;
const FLOW_BUILDER_REQUEST_TIMEOUT_MS = 480_000;

interface SseEventChunk {
  event: string;
  data: string;
}

export interface RunStreamEventEnvelope {
  event: string;
  data: unknown;
  rawData: string;
}

export interface SubscribeRunEventsOptions {
  cursor?: number;
  signal?: AbortSignal;
  onOpen?: () => void;
  onEvent: (event: RunStreamEventEnvelope) => void;
  onError?: (error: Error) => void;
}

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

function resolveRequestTimeoutMs(path: string): number {
  return path === FLOW_BUILDER_GENERATE_PATH ? FLOW_BUILDER_REQUEST_TIMEOUT_MS : DEFAULT_API_REQUEST_TIMEOUT_MS;
}

function resolveAbortReason(signal: AbortSignal | undefined): string | null {
  if (!signal?.aborted) {
    return null;
  }
  const reason = signal.reason;
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason.trim();
  }
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message.trim();
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (API_TOKEN.length > 0) {
    headers.set("Authorization", `Bearer ${API_TOKEN}`);
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const timeoutMs = resolveRequestTimeoutMs(path);
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(`Request timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  const cleanupSignalForwarding = (() => {
    if (!init?.signal) {
      return () => {};
    }

    const relayAbort = () => {
      const reason = resolveAbortReason(init.signal);
      timeoutController.abort(reason ?? "Request aborted");
    };
    if (init.signal.aborted) {
      relayAbort();
      return () => {};
    }

    init.signal.addEventListener("abort", relayAbort, { once: true });
    return () => {
      init.signal?.removeEventListener("abort", relayAbort);
    };
  })();

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: timeoutController.signal
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Network timeout (${method} ${path}): Request timed out after ${timeoutMs}ms`);
    }

    const abortReason = resolveAbortReason(init?.signal) ?? resolveAbortReason(timeoutController.signal);
    if (abortReason) {
      throw new Error(`Network error (${method} ${path}): ${abortReason}`);
    }

    const reason = error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : "Network request failed";
    throw new Error(`Network error (${method} ${path}): ${reason}`);
  } finally {
    clearTimeout(timeout);
    cleanupSignalForwarding();
  }

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

function waitForRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isNetworkRequestError(path: string, method: string, error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.startsWith(`Network error (${method.toUpperCase()} ${path}):`);
}

async function requestWithRetry<T>(
  path: string,
  init: RequestInit,
  options: {
    attempts: number;
    delayMs: number;
    shouldRetry: (error: unknown) => boolean;
  }
): Promise<T> {
  const attempts = Math.max(1, Math.trunc(options.attempts));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request<T>(path, init);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !options.shouldRetry(error)) {
        throw error;
      }
      await waitForRetry(options.delayMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Request failed after ${attempts} attempts`);
}

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (chunk: SseEventChunk) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flushBuffer = (chunk: string): void => {
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      if (rawEvent.trim().length === 0) {
        continue;
      }

      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim() || eventName;
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }

      if (dataLines.length === 0) {
        continue;
      }

      onEvent({
        event: eventName,
        data: dataLines.join("\n")
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    flushBuffer(decoder.decode(value, { stream: true }));
  }

  flushBuffer(decoder.decode());
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

function createFilesQueryString(query: StorageFileListQuery): string {
  const search = new URLSearchParams();
  search.set("pipelineId", query.pipelineId);
  search.set("scope", query.scope);
  if (query.runId && query.runId.trim().length > 0) {
    search.set("runId", query.runId.trim());
  }
  if (query.path && query.path.trim().length > 0) {
    search.set("path", query.path.trim());
  }
  return search.toString();
}

function normalizeStoragePath(pathValue: string): string {
  return pathValue
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
}

function buildStorageRawUrl(options: {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string | null;
  path: string;
  directory: boolean;
}): string {
  const pipelineId = options.pipelineId.trim();
  if (pipelineId.length === 0) {
    throw new Error("pipelineId is required");
  }

  const normalizedPath = normalizeStoragePath(options.path);
  const runId =
    options.scope === "runs"
      ? (options.runId ?? "").trim()
      : "-";
  if (options.scope === "runs" && runId.length === 0) {
    throw new Error("runId is required for runs scope");
  }

  const pathSegments = [
    "api",
    "files",
    "raw",
    options.scope,
    encodeURIComponent(pipelineId),
    encodeURIComponent(runId.length > 0 ? runId : "-")
  ];

  if (normalizedPath.length > 0) {
    pathSegments.push(...normalizedPath.split("/").map((segment) => encodeURIComponent(segment)));
  }

  const trailingSlash = options.directory ? "/" : "";
  const url = new URL(`/${pathSegments.join("/")}${trailingSlash}`, `${API_BASE.replace(/\/+$/, "")}/`);
  if (API_TOKEN.length > 0) {
    url.searchParams.set("api_token", API_TOKEN);
  }
  return url.toString();
}

export function buildStorageRawFileUrl(options: {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string | null;
  path: string;
}): string {
  return buildStorageRawUrl({
    ...options,
    directory: false
  });
}

export function buildStorageRawDirectoryUrl(options: {
  pipelineId: string;
  scope: StorageFilesScope;
  runId?: string | null;
  path: string;
}): string {
  return buildStorageRawUrl({
    ...options,
    directory: true
  });
}

export async function listStorageFiles(query: StorageFileListQuery) {
  const search = createFilesQueryString(query);
  return request<StorageFileListResponse>(`/api/files?${search}`);
}

export async function getStorageFileContent(query: StorageFileContentQuery) {
  const search = new URLSearchParams();
  search.set("pipelineId", query.pipelineId);
  search.set("scope", query.scope);
  search.set("path", query.path.trim());
  if (query.runId && query.runId.trim().length > 0) {
    search.set("runId", query.runId.trim());
  }
  if (typeof query.maxBytes === "number" && Number.isFinite(query.maxBytes)) {
    search.set("maxBytes", String(Math.trunc(query.maxBytes)));
  }

  return request<StorageFileContentResponse>(`/api/files/content?${search.toString()}`);
}

export async function deleteStorageFilePath(payload: StorageFileDeletePayload) {
  return request<{ deletedPath: string; type: "directory" | "file" }>("/api/files", {
    method: "DELETE",
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

export function subscribeRunEvents(runId: string, options: SubscribeRunEventsOptions): () => void {
  const controller = new AbortController();
  let settled = false;

  const cleanupSignalForwarding = (() => {
    if (!options.signal) {
      return () => {};
    }

    const relayAbort = () => controller.abort(options.signal?.reason);
    if (options.signal.aborted) {
      relayAbort();
      return () => {};
    }
    options.signal.addEventListener("abort", relayAbort, { once: true });
    return () => options.signal?.removeEventListener("abort", relayAbort);
  })();

  const cursor = Math.max(0, options.cursor ?? 0);
  const endpoint = `${API_BASE}/api/runs/${encodeURIComponent(runId)}/events?cursor=${cursor}`;
  const headers = new Headers();
  if (API_TOKEN.length > 0) {
    headers.set("Authorization", `Bearer ${API_TOKEN}`);
  }

  void fetch(endpoint, {
    method: "GET",
    headers,
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = (await response.text()).trim();
        throw new Error(text || `Failed to subscribe run events (${response.status})`);
      }
      if (!response.body) {
        throw new Error("Run events stream is unavailable: response body is empty.");
      }

      options.onOpen?.();
      await consumeSseStream(response.body, ({ event, data }) => {
        const payload = tryParseJsonObject(data);
        options.onEvent({
          event,
          data: payload ?? data,
          rawData: data
        });
      });
    })
    .catch((error) => {
      if (controller.signal.aborted || settled) {
        return;
      }
      const message = error instanceof Error ? error.message : "Run events stream failed";
      options.onError?.(new Error(message));
    })
    .finally(() => {
      settled = true;
      cleanupSignalForwarding();
    });

  return () => {
    if (settled) {
      return;
    }
    settled = true;
    cleanupSignalForwarding();
    controller.abort("Run events subscription closed");
  };
}

export async function generateFlowDraft(payload: FlowBuilderRequest) {
  const method = "POST";
  return requestWithRetry<FlowBuilderResponse>(FLOW_BUILDER_GENERATE_PATH, {
    method,
    body: JSON.stringify(payload)
  }, {
    attempts: FLOW_BUILDER_RETRY_ATTEMPTS,
    delayMs: FLOW_BUILDER_RETRY_DELAY_MS,
    shouldRetry: (error) => isNetworkRequestError(FLOW_BUILDER_GENERATE_PATH, method, error)
  });
}
