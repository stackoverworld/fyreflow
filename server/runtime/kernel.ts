import type { Server } from "node:http";

import { generateFlowDraft } from "../flowBuilder.js";
import { createApp } from "../http/appFactory.js";
import {
  getProviderOAuthStatus,
  startProviderOAuthLogin,
  submitProviderOAuthCode,
  syncProviderOAuthToken
} from "../oauth.js";
import { PairingService } from "../pairing/service.js";
import { normalizeRunInputs } from "../runInputs.js";
import {
  deletePipelineSecureInputs,
  getPipelineSecureInputs,
  mergeRunInputsWithSecure,
  upsertPipelineSecureInputs
} from "../secureInputs.js";
import { buildSmartRunPlan } from "../smartRun.js";
import { buildRunStartupCheck } from "../startupCheck.js";
import { LocalStore } from "../storage.js";
import { createRunRecoveryRuntime } from "./recovery.js";
import { createRunQueueRuntime, isRunPreflightError } from "./runQueue.js";
import { createSchedulerRuntime, schedulerPollIntervalMs } from "./scheduler.js";
import { initializeRuntimeBootstrap, type RuntimeBootstrapHandle } from "./bootstrap.js";
import { resolveRuntimeConfig, type RuntimeConfig } from "./config.js";
import { loadDesktopCompatibilityPolicy } from "./desktopCompatibility.js";
import { compareSemverLikeVersions, normalizeSemverLikeVersion } from "./versioning.js";
import { sanitizeDashboardState } from "./sanitization.js";
import { createRealtimeRuntime, type RealtimeRuntime } from "../realtime/websocketRuntime.js";
import { createUpdaterProxyClient } from "../updater/proxyClient.js";
import { evaluatePersistenceStatus } from "./persistence.js";

export interface ServerRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  config?: Partial<RuntimeConfig>;
  store?: LocalStore;
  activeRunControllers?: Map<string, AbortController>;
}

export interface ServerRuntime {
  app: ReturnType<typeof createApp>;
  config: RuntimeConfig;
  start: () => Server;
  stop: () => void;
}

export function createServerRuntime(options: ServerRuntimeOptions = {}): ServerRuntime {
  const resolvedConfig = resolveRuntimeConfig(options.env);
  const config: RuntimeConfig = {
    ...resolvedConfig,
    ...(options.config ?? {})
  };
  const appVersion =
    (options.env?.FYREFLOW_BUILD_VERSION ??
      process.env.FYREFLOW_BUILD_VERSION ??
      options.env?.npm_package_version ??
      process.env.npm_package_version ??
      "dev").trim() || "dev";

  const store = options.store ?? new LocalStore();
  const pairingService = new PairingService();
  const activeRunControllers = options.activeRunControllers ?? new Map<string, AbortController>();

  const { queuePipelineRun } = createRunQueueRuntime({
    store,
    activeRunControllers
  });

  const {
    attachWorkerToExistingRun,
    listActivePipelineIds,
    recoverInterruptedRuns
  } = createRunRecoveryRuntime({
    store,
    activeRunControllers
  });

  const {
    ensureSchedulerMarkersLoaded,
    tickPipelineSchedules
  } = createSchedulerRuntime({
    store,
    queuePipelineRun,
    listActivePipelineIds,
    isRunPreflightError
  });
  const updaterProxy = createUpdaterProxyClient({
    baseUrl: config.updaterBaseUrl,
    authToken: config.updaterAuthToken,
    timeoutMs: config.updaterProxyTimeoutMs
  });
  const desktopCompatibilityPolicy = loadDesktopCompatibilityPolicy(config.desktopCompatibilityPolicyPath);
  const minimumDesktopVersion = config.minDesktopVersion || desktopCompatibilityPolicy.minimumDesktopVersion;
  const desktopDownloadUrl = config.desktopDownloadUrl || desktopCompatibilityPolicy.downloadUrl;
  const persistenceStatus = evaluatePersistenceStatus({
    mode: config.mode,
    env: options.env ?? process.env
  });

  const app = createApp({
    apiAuthToken: config.apiAuthToken,
    isAdditionalApiTokenValid: (token) => pairingService.isDeviceTokenValid(token),
    allowedCorsOrigins: config.allowedCorsOrigins,
    allowAnyCorsOrigin: config.allowAnyCorsOrigin,
    system: {
      getState: () => store.getState(),
      sanitizeDashboardState,
      getVersion: () => appVersion,
      getRealtimeStatus: () => ({
        enabled: config.enableRealtimeSocket,
        path: config.realtimeSocketPath
      }),
      getUpdaterStatus: () => ({
        configured: updaterProxy.isConfigured()
      }),
      getPersistenceStatus: () => persistenceStatus,
      getClientCompatibility: (clientVersion) => {
        if (minimumDesktopVersion.length === 0) {
          return null;
        }

        const normalizedClientVersion = normalizeSemverLikeVersion(clientVersion);
        const compareResult = compareSemverLikeVersions(normalizedClientVersion, minimumDesktopVersion);
        const updateRequired = normalizedClientVersion.length === 0 || compareResult === null || compareResult < 0;
        const message =
          normalizedClientVersion.length === 0
            ? `Backend requires desktop version ${minimumDesktopVersion} or newer. Current desktop version is unavailable.`
            : updateRequired
              ? `Backend requires desktop version ${minimumDesktopVersion} or newer. Current desktop version: ${normalizedClientVersion}.`
              : `Desktop version ${normalizedClientVersion} is compatible with backend minimum ${minimumDesktopVersion}.`;

        return {
          minimumDesktopVersion,
          ...(normalizedClientVersion.length > 0
            ? {
                clientVersion: normalizedClientVersion
              }
            : {}),
          updateRequired,
          message,
          ...(desktopDownloadUrl.length > 0
            ? {
                downloadUrl: desktopDownloadUrl
              }
            : {})
        };
      }
    },
    updates: {
      updater: updaterProxy
    },
    pairing: {
      pairingService,
      realtimePath: config.realtimeSocketPath,
      apiAuthToken: config.apiAuthToken,
      runtimeMode: config.mode
    },
    pipelines: {
      store,
      queuePipelineRun,
      isRunPreflightError,
      getProviderOAuthStatus,
      startProviderOAuthLogin,
      submitProviderOAuthCode,
      syncProviderOAuthToken,
      buildSmartRunPlan,
      buildRunStartupCheck,
      getPipelineSecureInputs,
      mergeRunInputsWithSecure,
      normalizeRunInputs,
      upsertPipelineSecureInputs,
      deletePipelineSecureInputs,
      generateFlowDraft
    },
    runs: {
      store,
      activeRunControllers,
      attachWorkerToExistingRun
    }
  });

  const realtimeRuntime: RealtimeRuntime | null = config.enableRealtimeSocket
    ? createRealtimeRuntime({
        store,
        pairingService,
        apiAuthToken: config.apiAuthToken,
        isAdditionalTokenValid: (token) => pairingService.isDeviceTokenValid(token),
        path: config.realtimeSocketPath,
        runPollIntervalMs: config.realtimeRunPollIntervalMs,
        heartbeatIntervalMs: config.realtimeHeartbeatIntervalMs
      })
    : null;

  let server: Server | null = null;
  let bootstrapHandle: RuntimeBootstrapHandle | null = null;

  function stop(): void {
    if (bootstrapHandle) {
      bootstrapHandle.dispose();
      bootstrapHandle = null;
    }

    if (server) {
      server.close();
      server = null;
    }

    realtimeRuntime?.dispose();
  }

  function start(): Server {
    if (server) {
      return server;
    }

    server = app.listen(config.port, () => {
      console.log(`Agents dashboard API listening on http://localhost:${config.port} (mode=${config.mode})`);
      if (persistenceStatus.status === "warn") {
        console.warn(`[persistence-warning] ${persistenceStatus.issues.join(" ")}`);
      }
      if (realtimeRuntime) {
        console.log(`Realtime WS enabled at ${config.realtimeSocketPath}`);
      }

      void initializeRuntimeBootstrap({
        enableScheduler: config.enableScheduler,
        enableRecovery: config.enableRecovery,
        ensureSchedulerMarkersLoaded,
        tickPipelineSchedules,
        recoverInterruptedRuns,
        schedulerPollIntervalMs
      })
        .then((handle) => {
          bootstrapHandle = handle;
        })
        .catch((error) => {
          console.error("[runtime-startup-error]", error);
        });
    });

    if (realtimeRuntime) {
      realtimeRuntime.attachServer(server);
    }

    return server;
  }

  return {
    app,
    config,
    start,
    stop
  };
}
