export type RuntimeMode = "local" | "remote";

export interface RuntimeConfig {
  mode: RuntimeMode;
  port: number;
  apiAuthToken: string;
  allowedCorsOrigins: string[];
  allowAnyCorsOrigin: boolean;
  enableScheduler: boolean;
  enableRecovery: boolean;
  enableRealtimeSocket: boolean;
  realtimeSocketPath: string;
  realtimeRunPollIntervalMs: number;
  realtimeHeartbeatIntervalMs: number;
  updaterBaseUrl: string;
  updaterAuthToken: string;
  updaterProxyTimeoutMs: number;
}

const defaultPort = 8787;
const defaultCorsOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  // Electron renderer loaded from file:// sends Origin: null.
  "null"
];

const truthyEnvValues = new Set(["1", "true", "yes", "on"]);
const falsyEnvValues = new Set(["0", "false", "no", "off"]);
const defaultRealtimeSocketPath = "/api/ws";
const defaultRealtimeRunPollIntervalMs = 400;
const defaultRealtimeHeartbeatIntervalMs = 15_000;
const defaultUpdaterProxyTimeoutMs = 15_000;

export function resolveRuntimeMode(raw: string | undefined): RuntimeMode {
  if (raw?.trim().toLowerCase() === "remote") {
    return "remote";
  }

  return "local";
}

export function resolvePort(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return defaultPort;
  }
  return parsed;
}

export function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (truthyEnvValues.has(normalized)) {
    return true;
  }
  if (falsyEnvValues.has(normalized)) {
    return false;
  }

  return fallback;
}

export function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

export function resolveCorsOrigins(raw: string | undefined): {
  allowedCorsOrigins: string[];
  allowAnyCorsOrigin: boolean;
} {
  const configured = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const allowedCorsOrigins = configured.length > 0 ? configured : defaultCorsOrigins;

  return {
    allowedCorsOrigins,
    allowAnyCorsOrigin: allowedCorsOrigins.includes("*")
  };
}

export function normalizeOptionalUrl(raw: string | undefined): string {
  if (!raw) {
    return "";
  }

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

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const mode = resolveRuntimeMode(env.FYREFLOW_RUNTIME_MODE);
  const { allowedCorsOrigins, allowAnyCorsOrigin } = resolveCorsOrigins(env.CORS_ORIGINS);
  const realtimeSocketPath =
    typeof env.FYREFLOW_WS_PATH === "string" && env.FYREFLOW_WS_PATH.trim().startsWith("/")
      ? env.FYREFLOW_WS_PATH.trim()
      : defaultRealtimeSocketPath;

  const config: RuntimeConfig = {
    mode,
    port: resolvePort(env.PORT),
    apiAuthToken: (env.DASHBOARD_API_TOKEN ?? "").trim(),
    allowedCorsOrigins,
    allowAnyCorsOrigin,
    enableScheduler: parseBooleanEnv(env.FYREFLOW_ENABLE_SCHEDULER, true),
    enableRecovery: parseBooleanEnv(env.FYREFLOW_ENABLE_RECOVERY, true),
    enableRealtimeSocket: parseBooleanEnv(env.FYREFLOW_ENABLE_REALTIME_WS, true),
    realtimeSocketPath,
    realtimeRunPollIntervalMs: parseIntEnv(
      env.FYREFLOW_WS_RUN_POLL_INTERVAL_MS,
      defaultRealtimeRunPollIntervalMs,
      100,
      10_000
    ),
    realtimeHeartbeatIntervalMs: parseIntEnv(
      env.FYREFLOW_WS_HEARTBEAT_INTERVAL_MS,
      defaultRealtimeHeartbeatIntervalMs,
      1_000,
      120_000
    ),
    updaterBaseUrl: normalizeOptionalUrl(env.FYREFLOW_UPDATER_BASE_URL),
    updaterAuthToken: (env.FYREFLOW_UPDATER_AUTH_TOKEN ?? env.UPDATER_AUTH_TOKEN ?? "").trim(),
    updaterProxyTimeoutMs: parseIntEnv(
      env.FYREFLOW_UPDATER_TIMEOUT_MS,
      defaultUpdaterProxyTimeoutMs,
      2_000,
      120_000
    )
  };

  if (config.mode === "remote" && config.apiAuthToken.length === 0) {
    throw new Error("DASHBOARD_API_TOKEN is required when FYREFLOW_RUNTIME_MODE=remote.");
  }

  return config;
}
