import type {
  DashboardState,
  FlowBuilderRequest,
  FlowBuilderResponse,
  McpServerConfig,
  McpServerPayload,
  PairingSessionCreated,
  PairingSessionStatus,
  PairingSessionSummary,
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
  StorageFilesScope,
  UpdateServiceStatus
} from "./types";
import { getActiveConnectionSettings } from "./connectionSettingsStorage";
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

export interface PairingStatusEventEnvelope {
  event: "subscribed" | "status" | "not_found" | "error";
  data: unknown;
  rawData: string;
}

export interface SubscribePairingStatusOptions {
  signal?: AbortSignal;
  onOpen?: () => void;
  onEvent: (event: PairingStatusEventEnvelope) => void;
  onError?: (error: Error) => void;
}

interface RealtimeWsEventPayload {
  type?: string;
  runId?: string;
  cursor?: number;
  message?: string;
  status?: string;
  code?: string;
  now?: string;
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
  const connection = getActiveConnectionSettings();
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (connection.apiToken.length > 0) {
    headers.set("Authorization", `Bearer ${connection.apiToken}`);
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
    response = await fetch(`${connection.apiBaseUrl}${path}`, {
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

function isTerminalRunStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function resolveRealtimeWsUrl(): string {
  const connection = getActiveConnectionSettings();
  const httpBase = new URL(connection.apiBaseUrl);
  httpBase.protocol = httpBase.protocol === "https:" ? "wss:" : "ws:";
  const basePath = httpBase.pathname.replace(/\/+$/, "");
  const normalizedRealtimePath = (connection.realtimePath.startsWith("/")
    ? connection.realtimePath
    : `/${connection.realtimePath}`
  ).replace(/^\/+/, "");

  httpBase.pathname =
    normalizedRealtimePath.length > 0
      ? `${basePath}/${normalizedRealtimePath}`.replace(/\/{2,}/g, "/")
      : basePath.length > 0
        ? basePath
        : "/";

  const endpoint = httpBase;
  if (connection.apiToken.length > 0) {
    endpoint.searchParams.set("api_token", connection.apiToken);
  }
  return endpoint.toString();
}

function parseRealtimePayload(raw: unknown): RealtimeWsEventPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = raw as Record<string, unknown>;
  return {
    type: typeof payload.type === "string" ? payload.type : undefined,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    cursor: typeof payload.cursor === "number" ? payload.cursor : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    status: typeof payload.status === "string" ? payload.status : undefined,
    code: typeof payload.code === "string" ? payload.code : undefined,
    now: typeof payload.now === "string" ? payload.now : undefined
  };
}

const PAIRING_SESSION_STATUSES: PairingSessionStatus[] = [
  "pending",
  "approved",
  "claimed",
  "cancelled",
  "expired"
];

function isPairingSessionStatus(value: unknown): value is PairingSessionStatus {
  return typeof value === "string" && PAIRING_SESSION_STATUSES.includes(value as PairingSessionStatus);
}

function parsePairingSessionSummary(value: unknown): PairingSessionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (
    typeof payload.id !== "string" ||
    !isPairingSessionStatus(payload.status) ||
    typeof payload.clientName !== "string" ||
    typeof payload.platform !== "string" ||
    typeof payload.label !== "string" ||
    typeof payload.createdAt !== "string" ||
    typeof payload.updatedAt !== "string" ||
    typeof payload.expiresAt !== "string"
  ) {
    return null;
  }

  return {
    id: payload.id,
    status: payload.status,
    clientName: payload.clientName,
    platform: payload.platform,
    label: payload.label,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    expiresAt: payload.expiresAt,
    ...(typeof payload.approvedAt === "string" ? { approvedAt: payload.approvedAt } : {}),
    ...(typeof payload.claimedAt === "string" ? { claimedAt: payload.claimedAt } : {})
  };
}

function parsePairingStatusPayload(raw: unknown): {
  type?: string;
  sessionId?: string;
  session?: PairingSessionSummary;
  message?: string;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const payload = raw as Record<string, unknown>;
  return {
    type: typeof payload.type === "string" ? payload.type : undefined,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    session: parsePairingSessionSummary(payload.session),
    message: typeof payload.message === "string" ? payload.message : undefined
  };
}

export async function getState(): Promise<DashboardState> {
  return request<DashboardState>("/api/state");
}

export interface UpdaterClientConfig {
  baseUrl: string;
  authToken?: string;
}

export async function getManagedUpdateStatus() {
  return request<{ status: UpdateServiceStatus }>("/api/updates/status");
}

export async function checkManagedUpdateStatus() {
  return request<{ status: UpdateServiceStatus }>("/api/updates/check", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function applyManagedUpdate(version?: string) {
  return request<{ status: UpdateServiceStatus }>("/api/updates/apply", {
    method: "POST",
    body: JSON.stringify(
      version && version.trim().length > 0
        ? { version: version.trim() }
        : {}
    )
  });
}

export async function rollbackManagedUpdate() {
  return request<{ status: UpdateServiceStatus }>("/api/updates/rollback", {
    method: "POST",
    body: JSON.stringify({})
  });
}

function normalizeExternalBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Updater base URL is required.");
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    throw new Error("Updater base URL must be a valid URL.");
  }
}

async function requestUpdater<T>(
  config: UpdaterClientConfig,
  path: string,
  init?: RequestInit
): Promise<T> {
  const baseUrl = normalizeExternalBaseUrl(config.baseUrl);
  const authToken = (config.authToken ?? "").trim();
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (authToken.length > 0) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const timeoutMs = DEFAULT_API_REQUEST_TIMEOUT_MS;
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(`Request timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: timeoutController.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (timedOut) {
      throw new Error(`Updater timeout (${method} ${path}): Request timed out after ${timeoutMs}ms`);
    }
    const reason = error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : "Network request failed";
    throw new Error(`Updater network error (${method} ${path}): ${reason}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = (await response.text()).trim();
    const payload = tryParseJsonObject(text);
    const message = payload ? extractApiErrorMessage(payload) ?? text : text;
    throw new Error(message || `Updater request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getUpdaterStatus(config: UpdaterClientConfig) {
  return requestUpdater<{ status: UpdateServiceStatus }>(config, "/api/updates/status");
}

export async function checkUpdaterStatus(config: UpdaterClientConfig) {
  return requestUpdater<{ status: UpdateServiceStatus }>(config, "/api/updates/check", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function applyUpdaterUpdate(config: UpdaterClientConfig, version?: string) {
  return requestUpdater<{ status: UpdateServiceStatus }>(config, "/api/updates/apply", {
    method: "POST",
    body: JSON.stringify(
      version && version.trim().length > 0
        ? { version: version.trim() }
        : {}
    )
  });
}

export async function rollbackUpdaterUpdate(config: UpdaterClientConfig) {
  return requestUpdater<{ status: UpdateServiceStatus }>(config, "/api/updates/rollback", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export interface CreatePairingSessionInput {
  clientName?: string;
  platform?: string;
  ttlSeconds?: number;
}

export interface PairingSessionSnapshot extends PairingSessionSummary {
  realtimePath: string;
}

export async function createPairingSession(input: CreatePairingSessionInput = {}) {
  return request<{ session: PairingSessionCreated }>("/api/pairing/sessions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getPairingSession(sessionId: string) {
  return request<{ session: PairingSessionSnapshot }>(`/api/pairing/sessions/${encodeURIComponent(sessionId)}`);
}

export async function approvePairingSession(sessionId: string, code: string, label?: string) {
  return request<{ session: PairingSessionSummary }>(`/api/pairing/sessions/${encodeURIComponent(sessionId)}/approve`, {
    method: "POST",
    body: JSON.stringify({
      code,
      ...(label && label.trim().length > 0 ? { label: label.trim() } : {})
    })
  });
}

export async function claimPairingSession(sessionId: string, code: string) {
  return request<{ session: PairingSessionSummary; deviceToken: string }>(
    `/api/pairing/sessions/${encodeURIComponent(sessionId)}/claim`,
    {
      method: "POST",
      body: JSON.stringify({ code })
    }
  );
}

export async function cancelPairingSession(sessionId: string) {
  return request<{ session: PairingSessionSummary }>(`/api/pairing/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
  });
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
  const connection = getActiveConnectionSettings();
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
  const url = new URL(`/${pathSegments.join("/")}${trailingSlash}`, `${connection.apiBaseUrl.replace(/\/+$/, "")}/`);
  if (connection.apiToken.length > 0) {
    url.searchParams.set("api_token", connection.apiToken);
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
  let wsOpened = false;
  let fallbackStarted = false;
  let lastCursor = Math.max(0, options.cursor ?? 0);
  let websocket: WebSocket | null = null;

  const cleanupSignalForwarding = (() => {
    if (!options.signal) {
      return () => {};
    }

    const relayAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      controller.abort(options.signal?.reason ?? "Run events subscription aborted");
      websocket?.close();
    };
    if (options.signal.aborted) {
      relayAbort();
      return () => {};
    }
    options.signal.addEventListener("abort", relayAbort, { once: true });
    return () => options.signal?.removeEventListener("abort", relayAbort);
  })();

  if (controller.signal.aborted || settled) {
    cleanupSignalForwarding();
    return () => {};
  }

  const startSseFallback = (): void => {
    if (settled || fallbackStarted || controller.signal.aborted) {
      return;
    }

    fallbackStarted = true;
    const connection = getActiveConnectionSettings();
    const endpoint = `${connection.apiBaseUrl}/api/runs/${encodeURIComponent(runId)}/events?cursor=${lastCursor}`;
    const headers = new Headers();
    if (connection.apiToken.length > 0) {
      headers.set("Authorization", `Bearer ${connection.apiToken}`);
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
          if (event === "log" && payload && typeof payload.logIndex === "number") {
            lastCursor = Math.max(lastCursor, payload.logIndex + 1);
          }

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
  };

  if (typeof WebSocket !== "function") {
    startSseFallback();
  } else {
    try {
      websocket = new WebSocket(resolveRealtimeWsUrl());

      websocket.addEventListener("open", () => {
        if (controller.signal.aborted || settled) {
          websocket?.close();
          return;
        }

        wsOpened = true;
        options.onOpen?.();
        websocket?.send(
          JSON.stringify({
            type: "subscribe_run",
            runId,
            cursor: lastCursor
          })
        );
      });

      websocket.addEventListener("message", (messageEvent) => {
        if (settled) {
          return;
        }

        const rawData = typeof messageEvent.data === "string" ? messageEvent.data : "";
        const payloadRaw = tryParseJsonObject(rawData);
        const payload = parseRealtimePayload(payloadRaw);
        const now = payload?.now ?? new Date().toISOString();
        const eventType = payload?.type;

        if (!eventType) {
          return;
        }

        if (eventType === "run_log") {
          const cursor = typeof payload.cursor === "number" ? Math.max(0, payload.cursor) : undefined;
          if (typeof cursor === "number") {
            lastCursor = Math.max(lastCursor, cursor);
          }

          const logIndex =
            typeof cursor === "number" && cursor > 0
              ? cursor - 1
              : Math.max(0, lastCursor - 1);

          options.onEvent({
            event: "log",
            data: {
              runId: payload.runId ?? runId,
              logIndex,
              message: payload.message ?? "",
              status: payload.status ?? "running",
              at: now
            },
            rawData
          });
          return;
        }

        if (eventType === "run_status") {
          const status = payload.status ?? "running";
          options.onEvent({
            event: "status",
            data: {
              runId: payload.runId ?? runId,
              status,
              at: now
            },
            rawData
          });

          if (isTerminalRunStatus(status)) {
            options.onEvent({
              event: "complete",
              data: {
                runId: payload.runId ?? runId,
                status,
                at: now
              },
              rawData
            });
          }
          return;
        }

        if (eventType === "heartbeat") {
          options.onEvent({
            event: "heartbeat",
            data: {
              runId,
              cursor: lastCursor,
              at: now
            },
            rawData
          });
          return;
        }

        if (eventType === "subscribed") {
          const cursor = typeof payload.cursor === "number" ? Math.max(0, payload.cursor) : lastCursor;
          lastCursor = Math.max(lastCursor, cursor);
          options.onEvent({
            event: "ready",
            data: {
              runId: payload.runId ?? runId,
              cursor,
              status: payload.status ?? "queued",
              at: now
            },
            rawData
          });
          return;
        }

        if (eventType === "run_not_found" || eventType === "error") {
          const message =
            payload.message ?? (eventType === "run_not_found" ? `Run ${payload.runId ?? runId} not found.` : "Realtime stream failed.");
          const errorPayload = {
            runId: payload.runId ?? runId,
            message,
            code: payload.code,
            at: now
          };
          options.onEvent({
            event: "error",
            data: errorPayload,
            rawData
          });
          options.onError?.(new Error(message));
        }
      });

      websocket.addEventListener("error", () => {
        if (settled || controller.signal.aborted) {
          return;
        }

        if (!wsOpened) {
          startSseFallback();
        }
      });

      websocket.addEventListener("close", () => {
        if (settled || controller.signal.aborted) {
          return;
        }

        startSseFallback();
      });
    } catch {
      startSseFallback();
    }
  }

  return () => {
    if (settled) {
      return;
    }
    settled = true;
    cleanupSignalForwarding();
    websocket?.close();
    controller.abort("Run events subscription closed");
  };
}

export function subscribePairingSessionStatus(
  sessionId: string,
  options: SubscribePairingStatusOptions
): () => void {
  const normalizedSessionId = sessionId.trim();
  if (normalizedSessionId.length === 0) {
    options.onError?.(new Error("sessionId is required"));
    return () => {};
  }

  if (typeof WebSocket !== "function") {
    options.onError?.(new Error("WebSocket transport is unavailable in this environment."));
    return () => {};
  }

  const controller = new AbortController();
  let settled = false;
  let wsOpened = false;
  let websocket: WebSocket | null = null;

  const cleanupSignalForwarding = (() => {
    if (!options.signal) {
      return () => {};
    }

    const relayAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      controller.abort(options.signal?.reason ?? "Pairing subscription aborted");
      websocket?.close();
    };
    if (options.signal.aborted) {
      relayAbort();
      return () => {};
    }

    options.signal.addEventListener("abort", relayAbort, { once: true });
    return () => options.signal?.removeEventListener("abort", relayAbort);
  })();

  if (controller.signal.aborted || settled) {
    cleanupSignalForwarding();
    return () => {};
  }

  try {
    websocket = new WebSocket(resolveRealtimeWsUrl());
  } catch (error) {
    cleanupSignalForwarding();
    const message = error instanceof Error ? error.message : "Failed to open websocket connection.";
    options.onError?.(new Error(message));
    return () => {};
  }

  websocket.addEventListener("open", () => {
    if (controller.signal.aborted || settled) {
      websocket?.close();
      return;
    }

    wsOpened = true;
    options.onOpen?.();
    websocket?.send(
      JSON.stringify({
        type: "subscribe_pairing",
        sessionId: normalizedSessionId
      })
    );
  });

  websocket.addEventListener("message", (messageEvent) => {
    if (settled) {
      return;
    }

    const rawData = typeof messageEvent.data === "string" ? messageEvent.data : "";
    const payloadRaw = tryParseJsonObject(rawData);
    const payload = parsePairingStatusPayload(payloadRaw);
    if (!payload?.type) {
      return;
    }

    if (payload.type === "pairing_subscribed") {
      options.onEvent({
        event: "subscribed",
        data: {
          sessionId: payload.sessionId ?? normalizedSessionId
        },
        rawData
      });
      return;
    }

    if (payload.type === "pairing_status" && payload.session) {
      options.onEvent({
        event: "status",
        data: {
          session: payload.session
        },
        rawData
      });
      return;
    }

    if (payload.type === "pairing_not_found") {
      const message = `Pairing session ${payload.sessionId ?? normalizedSessionId} not found.`;
      options.onEvent({
        event: "not_found",
        data: {
          sessionId: payload.sessionId ?? normalizedSessionId,
          message
        },
        rawData
      });
      options.onError?.(new Error(message));
      return;
    }

    if (payload.type === "error") {
      const message = payload.message ?? "Pairing realtime stream failed.";
      options.onEvent({
        event: "error",
        data: {
          sessionId: normalizedSessionId,
          message
        },
        rawData
      });
      options.onError?.(new Error(message));
    }
  });

  websocket.addEventListener("error", () => {
    if (settled || controller.signal.aborted) {
      return;
    }

    const message = wsOpened
      ? "Pairing realtime stream failed."
      : "Failed to open pairing realtime stream.";
    options.onError?.(new Error(message));
  });

  websocket.addEventListener("close", () => {
    if (settled || controller.signal.aborted) {
      return;
    }

    if (!wsOpened) {
      options.onError?.(new Error("Pairing realtime stream closed before subscription was established."));
    }
  });

  return () => {
    if (settled) {
      return;
    }

    settled = true;
    cleanupSignalForwarding();
    websocket?.close();
    controller.abort("Pairing subscription closed");
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
