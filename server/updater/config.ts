import path from "node:path";
import { resolveDataRootPath } from "../runtime/dataPaths.js";

import type { UpdateChannel } from "./types.js";

export interface UpdaterRuntimeConfig {
  port: number;
  authToken: string;
  corsOrigins: string[];
  allowAnyCorsOrigin: boolean;
  dockerBinary: string;
  composeFilePath: string;
  composeEnvFilePath: string;
  coreServiceName: string;
  coreHealthUrl: string;
  githubOwner: string;
  githubRepo: string;
  githubToken: string;
  imageRepository: string;
  channel: UpdateChannel;
  statePath: string;
  healthTimeoutMs: number;
  releaseTimeoutMs: number;
  autoCheckIntervalMs: number;
}

const defaultPort = 8788;
const truthyEnvValues = new Set(["1", "true", "yes", "on"]);
const falsyEnvValues = new Set(["0", "false", "no", "off"]);

function parsePort(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return defaultPort;
  }
  return parsed;
}

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
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

function parseCorsOrigins(raw: string | undefined): {
  corsOrigins: string[];
  allowAnyCorsOrigin: boolean;
} {
  const configured = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const corsOrigins = configured.length > 0
    ? configured
    : ["http://localhost:5173", "http://127.0.0.1:5173", "null"];

  return {
    corsOrigins,
    allowAnyCorsOrigin: corsOrigins.includes("*")
  };
}

function normalizeChannel(raw: string | undefined): UpdateChannel {
  return raw?.trim().toLowerCase() === "prerelease" ? "prerelease" : "stable";
}

function normalizeOwner(raw: string | undefined): string {
  return (raw ?? "").trim();
}

function normalizeRepo(raw: string | undefined): string {
  return (raw ?? "").trim();
}

function resolveImageRepository(raw: string | undefined, owner: string): string {
  const explicit = (raw ?? "").trim();
  if (explicit.length > 0) {
    return explicit;
  }

  const ownerLower = owner.trim().toLowerCase();
  if (ownerLower.length > 0) {
    return `ghcr.io/${ownerLower}/fyreflow-core`;
  }

  return "ghcr.io/unknown/fyreflow-core";
}

export function resolveUpdaterRuntimeConfig(env: NodeJS.ProcessEnv = process.env): UpdaterRuntimeConfig {
  const { corsOrigins, allowAnyCorsOrigin } = parseCorsOrigins(env.UPDATER_CORS_ORIGINS);
  const dataRootPath = resolveDataRootPath(env);

  const githubOwner = normalizeOwner(env.UPDATER_GITHUB_OWNER ?? env.GITHUB_REPOSITORY_OWNER);
  const githubRepo = normalizeRepo(env.UPDATER_GITHUB_REPO ?? env.GITHUB_REPOSITORY?.split("/")[1]);

  const config: UpdaterRuntimeConfig = {
    port: parsePort(env.UPDATER_PORT),
    authToken: (env.UPDATER_AUTH_TOKEN ?? "").trim(),
    corsOrigins,
    allowAnyCorsOrigin,
    dockerBinary: (env.UPDATER_DOCKER_BINARY ?? "docker").trim() || "docker",
    composeFilePath: path.resolve(process.cwd(), (env.UPDATER_COMPOSE_FILE ?? "docker-compose.yml").trim()),
    composeEnvFilePath: path.resolve(process.cwd(), (env.UPDATER_ENV_FILE ?? ".env.selfhost").trim()),
    coreServiceName: (env.UPDATER_CORE_SERVICE_NAME ?? "core").trim() || "core",
    coreHealthUrl: (env.UPDATER_CORE_HEALTH_URL ?? "http://core:8787/api/health").trim(),
    githubOwner,
    githubRepo,
    githubToken: (env.GITHUB_TOKEN ?? env.UPDATER_GITHUB_TOKEN ?? "").trim(),
    imageRepository: resolveImageRepository(env.UPDATER_IMAGE_REPOSITORY, githubOwner),
    channel: normalizeChannel(env.UPDATER_CHANNEL),
    statePath:
      typeof env.UPDATER_STATE_PATH === "string" && env.UPDATER_STATE_PATH.trim().length > 0
        ? path.resolve(process.cwd(), env.UPDATER_STATE_PATH.trim())
        : path.join(dataRootPath, "updater-state.json"),
    healthTimeoutMs: parseIntEnv(env.UPDATER_HEALTH_TIMEOUT_MS, 10_000, 2_000, 120_000),
    releaseTimeoutMs: parseIntEnv(env.UPDATER_RELEASE_TIMEOUT_MS, 10_000, 2_000, 120_000),
    autoCheckIntervalMs: parseIntEnv(env.UPDATER_AUTO_CHECK_INTERVAL_MS, 300_000, 30_000, 86_400_000)
  };

  if (config.authToken.length === 0) {
    throw new Error("UPDATER_AUTH_TOKEN is required for updater service.");
  }

  return config;
}
