import type { ApplyUpdateRequest, UpdateStatus } from "./types.js";

const DEFAULT_PROXY_TIMEOUT_MS = 15_000;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return String(error);
}

function normalizeOptionalBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export class UpdaterProxyError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "UpdaterProxyError";
    this.statusCode = statusCode;
  }
}

export interface UpdaterProxyClient {
  isConfigured(): boolean;
  getStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  applyUpdate(input?: ApplyUpdateRequest): Promise<UpdateStatus>;
  rollbackUpdate(): Promise<UpdateStatus>;
}

export interface UpdaterProxyClientConfig {
  baseUrl: string;
  authToken: string;
  timeoutMs?: number;
}

class DisabledUpdaterProxyClient implements UpdaterProxyClient {
  isConfigured(): boolean {
    return false;
  }

  async getStatus(): Promise<UpdateStatus> {
    throw new UpdaterProxyError("Updater is not configured on this backend.", 503);
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    throw new UpdaterProxyError("Updater is not configured on this backend.", 503);
  }

  async applyUpdate(): Promise<UpdateStatus> {
    throw new UpdaterProxyError("Updater is not configured on this backend.", 503);
  }

  async rollbackUpdate(): Promise<UpdateStatus> {
    throw new UpdaterProxyError("Updater is not configured on this backend.", 503);
  }
}

class HttpUpdaterProxyClient implements UpdaterProxyClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;

  constructor(config: UpdaterProxyClientConfig) {
    this.baseUrl = normalizeOptionalBaseUrl(config.baseUrl);
    this.authToken = config.authToken.trim();
    this.timeoutMs =
      typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
        ? Math.trunc(config.timeoutMs)
        : DEFAULT_PROXY_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  async getStatus(): Promise<UpdateStatus> {
    return this.request<{
      status: UpdateStatus;
    }>("/api/updates/status").then((payload) => payload.status);
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return this.request<{
      status: UpdateStatus;
    }>("/api/updates/check", {
      method: "POST",
      body: JSON.stringify({})
    }).then((payload) => payload.status);
  }

  async applyUpdate(input: ApplyUpdateRequest = {}): Promise<UpdateStatus> {
    const body =
      typeof input.version === "string" && input.version.trim().length > 0
        ? {
            version: input.version.trim()
          }
        : {};

    return this.request<{
      status: UpdateStatus;
    }>("/api/updates/apply", {
      method: "POST",
      body: JSON.stringify(body)
    }).then((payload) => payload.status);
  }

  async rollbackUpdate(): Promise<UpdateStatus> {
    return this.request<{
      status: UpdateStatus;
    }>("/api/updates/rollback", {
      method: "POST",
      body: JSON.stringify({})
    }).then((payload) => payload.status);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.isConfigured()) {
      throw new UpdaterProxyError("Updater is not configured on this backend.", 503);
    }

    const headers = new Headers(init?.headers ?? {});
    headers.set("Content-Type", "application/json");
    if (this.authToken.length > 0) {
      headers.set("Authorization", `Bearer ${this.authToken}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(`Updater request timed out after ${this.timeoutMs}ms`);
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
    } catch (error) {
      const reason = toErrorMessage(error);
      if (controller.signal.aborted) {
        throw new UpdaterProxyError(`Updater request timed out: ${reason}`, 504);
      }
      throw new UpdaterProxyError(`Updater request failed: ${reason}`, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = (await response.text()).trim();
      const statusCode = response.status === 401 || response.status === 403 ? 502 : response.status;
      throw new UpdaterProxyError(text || `Updater responded with ${response.status}.`, statusCode);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

export function createUpdaterProxyClient(config: UpdaterProxyClientConfig): UpdaterProxyClient {
  if (normalizeOptionalBaseUrl(config.baseUrl).length === 0) {
    return new DisabledUpdaterProxyClient();
  }

  return new HttpUpdaterProxyClient(config);
}
