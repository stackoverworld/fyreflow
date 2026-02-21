import { LocalStore } from "./storage.js";
import { getProviderOAuthStatus, startProviderOAuthLogin, syncProviderOAuthToken } from "./oauth.js";
import { generateFlowDraft } from "./flowBuilder.js";
import { buildSmartRunPlan } from "./smartRun.js";
import { buildRunStartupCheck } from "./startupCheck.js";
import { normalizeRunInputs } from "./runInputs.js";
import {
  deletePipelineSecureInputs,
  getPipelineSecureInputs,
  MASK_VALUE,
  mergeRunInputsWithSecure,
  upsertPipelineSecureInputs
} from "./secureInputs.js";
import { createApp } from "./http/appFactory.js";
import { createRunRecoveryRuntime } from "./runtime/recovery.js";
import { createRunQueueRuntime, isRunPreflightError } from "./runtime/runQueue.js";
import { createSchedulerRuntime, schedulerPollIntervalMs } from "./runtime/scheduler.js";
import type {
  DashboardState,
  McpServerConfig,
  ProviderConfig,
  ProviderId
} from "./types.js";

const store = new LocalStore();
const activeRunControllers = new Map<string, AbortController>();

const defaultCorsOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  // Electron renderer loaded from file:// sends Origin: null.
  "null"
];
const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const allowedCorsOrigins = configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins;
const allowAnyCorsOrigin = allowedCorsOrigins.includes("*");
const apiAuthToken = (process.env.DASHBOARD_API_TOKEN ?? "").trim();

function maskIfPresent(value: string): string {
  return value.trim().length > 0 ? MASK_VALUE : "";
}

function sanitizeProviderConfig(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: maskIfPresent(provider.apiKey),
    oauthToken: maskIfPresent(provider.oauthToken)
  };
}

function sanitizeProviderMap(
  providers: DashboardState["providers"]
): Record<ProviderId, ProviderConfig> {
  return {
    openai: sanitizeProviderConfig(providers.openai),
    claude: sanitizeProviderConfig(providers.claude)
  };
}

function sanitizeMcpServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: maskIfPresent(server.env),
    headers: maskIfPresent(server.headers)
  };
}

function sanitizeDashboardState(state: DashboardState): DashboardState {
  return {
    ...state,
    providers: sanitizeProviderMap(state.providers),
    mcpServers: state.mcpServers.map((server) => sanitizeMcpServer(server))
  };
}

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

const app = createApp({
  apiAuthToken,
  allowedCorsOrigins,
  allowAnyCorsOrigin,
  system: {
    getState: () => store.getState(),
    sanitizeDashboardState
  },
  pipelines: {
    store,
    queuePipelineRun,
    isRunPreflightError,
    getProviderOAuthStatus,
    startProviderOAuthLogin,
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

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
app.listen(port, () => {
  console.log(`Agents dashboard API listening on http://localhost:${port}`);

  void (async () => {
    await ensureSchedulerMarkersLoaded();
    await recoverInterruptedRuns();
    await tickPipelineSchedules();

    const schedulerHandle = setInterval(() => {
      void tickPipelineSchedules();
    }, schedulerPollIntervalMs);
    if (typeof schedulerHandle.unref === "function") {
      schedulerHandle.unref();
    }
  })();
});
