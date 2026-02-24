export type RuntimeMode = "local" | "remote";

export interface RuntimeConfig {
  mode: RuntimeMode;
  port: number;
  apiAuthToken: string;
  allowedCorsOrigins: string[];
  allowAnyCorsOrigin: boolean;
  enableScheduler: boolean;
  enableRecovery: boolean;
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

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const mode = resolveRuntimeMode(env.FYREFLOW_RUNTIME_MODE);
  const { allowedCorsOrigins, allowAnyCorsOrigin } = resolveCorsOrigins(env.CORS_ORIGINS);

  return {
    mode,
    port: resolvePort(env.PORT),
    apiAuthToken: (env.DASHBOARD_API_TOKEN ?? "").trim(),
    allowedCorsOrigins,
    allowAnyCorsOrigin,
    enableScheduler: parseBooleanEnv(env.FYREFLOW_ENABLE_SCHEDULER, true),
    enableRecovery: parseBooleanEnv(env.FYREFLOW_ENABLE_RECOVERY, true)
  };
}
