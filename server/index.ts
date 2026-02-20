import cors from "cors";
import express, { type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { MODEL_CATALOG } from "./modelCatalog.js";
import { LocalStore } from "./storage.js";
import { getProviderOAuthStatus, startProviderOAuthLogin, syncProviderOAuthToken } from "./oauth.js";
import { orderPipelineSteps } from "./pipelineGraph.js";
import { cancelRun, pauseRun, resolveRunApproval, resumeRun, runPipeline } from "./runner.js";
import { generateFlowDraft } from "./flowBuilder.js";
import { buildSmartRunPlan } from "./smartRun.js";
import { buildRunStartupCheck } from "./startupCheck.js";
import { createAbortError } from "./abort.js";
import { normalizeRunInputs } from "./runInputs.js";
import { getZonedMinuteKey, isValidTimeZone, matchesCronExpression, parseCronExpression } from "./cron.js";
import { loadSchedulerMarkers, saveSchedulerMarkers } from "./schedulerState.js";
import {
  deletePipelineSecureInputs,
  getPipelineSecureInputs,
  MASK_VALUE,
  maskSensitiveInputs,
  mergeRunInputsWithSecure,
  pickSensitiveInputs,
  upsertPipelineSecureInputs
} from "./secureInputs.js";
import type {
  DashboardState,
  McpServerConfig,
  Pipeline,
  PipelineRun,
  ProviderConfig,
  ProviderId,
  SmartRunCheck,
  RunStatus
} from "./types.js";

const app = express();
const store = new LocalStore();
const activeRunControllers = new Map<string, AbortController>();
const scheduledRunMarkerByPipeline = new Map<string, string>();
const schedulerPollIntervalMs = 15_000;
const schedulerDefaultTimezone = "UTC";
const schedulerDefaultTaskPrefix = "Scheduled run for";
const schedulerCatchUpWindowMinutes = (() => {
  const raw = Number.parseInt(process.env.SCHEDULER_CATCHUP_WINDOW_MINUTES ?? "15", 10);
  if (!Number.isFinite(raw)) {
    return 15;
  }

  return Math.max(0, Math.min(720, raw));
})();
let schedulerTickActive = false;
let schedulerMarkersLoaded = false;

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

app.disable("x-powered-by");
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowAnyCorsOrigin || allowedCorsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 600
  })
);
app.use(express.json({ limit: "1mb" }));

function extractBearerToken(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const match = trimmed.match(/^bearer\s+(.+)$/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  return trimmed;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

app.use((request, response, next) => {
  if (!request.path.startsWith("/api/")) {
    next();
    return;
  }

  if (request.method === "OPTIONS" || request.path === "/api/health") {
    next();
    return;
  }

  if (apiAuthToken.length === 0) {
    next();
    return;
  }

  const bearerToken = extractBearerToken(
    typeof request.headers.authorization === "string" ? request.headers.authorization : undefined
  );
  const headerToken =
    typeof request.headers["x-api-token"] === "string" ? request.headers["x-api-token"].trim() : "";
  const candidate = bearerToken || headerToken;

  if (candidate.length === 0 || !constantTimeEquals(candidate, apiAuthToken)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
});

const stepSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  role: z.enum(["analysis", "planner", "orchestrator", "executor", "tester", "review"]),
  prompt: z.string().min(1),
  providerId: z.enum(["openai", "claude"]).default("openai"),
  model: z.string().min(1).default("gpt-5.3-codex"),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).default("medium"),
  fastMode: z.boolean().default(false),
  use1MContext: z.boolean().default(false),
  contextWindowTokens: z.number().int().min(64000).max(1000000).default(272000),
  position: z
    .object({
      x: z.number().finite(),
      y: z.number().finite()
    })
    .default({ x: 80, y: 130 }),
  contextTemplate: z.string().default("Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}"),
  enableDelegation: z.boolean().default(false),
  delegationCount: z.number().int().min(1).max(8).default(2),
  enableIsolatedStorage: z.boolean().default(false),
  enableSharedStorage: z.boolean().default(false),
  enabledMcpServerIds: z.array(z.string().min(1)).max(16).default([]),
  outputFormat: z.enum(["markdown", "json"]).default("markdown"),
  requiredOutputFields: z.array(z.string().min(1)).max(40).default([]),
  requiredOutputFiles: z.array(z.string().min(1)).max(40).default([])
});

const qualityGateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(160),
  targetStepId: z.union([z.literal("any_step"), z.string().min(1)]).default("any_step"),
  kind: z.enum(["regex_must_match", "regex_must_not_match", "json_field_exists", "artifact_exists", "manual_approval"]),
  blocking: z.boolean().default(true),
  pattern: z.string().max(2000).default(""),
  flags: z.string().max(12).default(""),
  jsonPath: z.string().max(2000).default(""),
  artifactPath: z.string().max(4000).default(""),
  message: z.string().max(2000).default("")
});

const scheduleInputsSchema = z
  .record(z.string())
  .refine((value) => Object.keys(value).length <= 120, {
    message: "Too many schedule inputs (max 120)."
  })
  .refine(
    (value) =>
      Object.values(value).every((entry) => typeof entry === "string" && entry.length <= 4000),
    {
      message: "Schedule input values must be strings up to 4000 chars."
    }
  )
  .default({});

const scheduleSchema = z
  .object({
    enabled: z.boolean().default(false),
    cron: z.string().max(120).default(""),
    timezone: z.string().max(120).default(schedulerDefaultTimezone),
    task: z.string().max(16000).default(""),
    runMode: z.enum(["smart", "quick"]).default("smart"),
    inputs: scheduleInputsSchema
  })
  .partial()
  .default({})
  .superRefine((raw, context) => {
    const cron = typeof raw.cron === "string" ? raw.cron.trim() : "";
    const timezone =
      typeof raw.timezone === "string" && raw.timezone.trim().length > 0 ? raw.timezone.trim() : schedulerDefaultTimezone;
    const enabled = raw.enabled === true;

    if (enabled) {
      if (cron.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cron"],
          message: "Cron expression is required when scheduling is enabled."
        });
        return;
      }

      const parseResult = parseCronExpression(cron);
      if (!parseResult.ok) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cron"],
          message: parseResult.error
        });
      }

      if (!isValidTimeZone(timezone)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timezone"],
          message: `Invalid time zone "${timezone}".`
        });
      }
    }
  });

const pipelineSchema = z.object({
  name: z.string().min(2),
  description: z.string().default(""),
  steps: z.array(stepSchema).min(1),
  links: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        sourceStepId: z.string().min(1),
        targetStepId: z.string().min(1),
        condition: z.enum(["always", "on_pass", "on_fail"]).optional()
      })
    )
    .default([]),
  runtime: z
    .object({
      maxLoops: z.number().int().min(0).max(12).default(2),
      maxStepExecutions: z.number().int().min(4).max(120).default(18),
      stageTimeoutMs: z.number().int().min(10000).max(1200000).default(420000)
    })
    .partial()
    .default({}),
  schedule: scheduleSchema,
  qualityGates: z.array(qualityGateSchema).max(80).default([])
});

const providerUpdateSchema = z.object({
  authMode: z.enum(["api_key", "oauth"]).optional(),
  apiKey: z.string().optional(),
  oauthToken: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional()
});

const mcpServerSchema = z.object({
  name: z.string().min(2).max(120),
  enabled: z.boolean().optional(),
  transport: z.enum(["stdio", "http", "sse"]).optional(),
  command: z.string().max(4000).optional(),
  args: z.string().max(4000).optional(),
  url: z.string().max(4000).optional(),
  env: z.string().max(8000).optional(),
  headers: z.string().max(8000).optional(),
  toolAllowlist: z.string().max(8000).optional(),
  health: z.enum(["unknown", "healthy", "degraded", "down"]).optional()
});

const mcpServerPatchSchema = mcpServerSchema.partial();

const storageUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  rootPath: z.string().min(1).max(4000).optional(),
  sharedFolder: z.string().min(1).max(240).optional(),
  isolatedFolder: z.string().min(1).max(240).optional(),
  runsFolder: z.string().min(1).max(240).optional()
});

const runInputsRecordSchema = z
  .record(z.string())
  .refine((value) => !value || Object.keys(value).length <= 120, {
    message: "Too many inputs (max 120)."
  })
  .refine(
    (value) =>
      !value ||
      Object.values(value).every((entry) => typeof entry === "string" && entry.length <= 4000),
    {
      message: "Input values must be strings up to 4000 chars."
    }
  );

const runInputsSchema = runInputsRecordSchema.optional();

const runRequestSchema = z.object({
  task: z.string().max(16000).optional().default(""),
  inputs: runInputsSchema
});

const runApprovalResolveSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional()
});

const smartRunPlanRequestSchema = z.object({
  inputs: runInputsSchema
});

const startupCheckRequestSchema = z.object({
  task: z.string().max(16000).optional().default(""),
  inputs: runInputsSchema
});

const secureInputsUpdateSchema = z.object({
  inputs: runInputsRecordSchema
});

const secureInputsDeleteSchema = z.object({
  keys: z.array(z.string().min(1).max(160)).max(120).optional()
});

const flowBuilderMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000)
});

const flowBuilderDraftSchema = z.object({
  name: z.string().max(120).default(""),
  description: z.string().max(2000).default(""),
  steps: z.array(stepSchema).min(1).max(18),
  links: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        sourceStepId: z.string().min(1),
        targetStepId: z.string().min(1),
        condition: z.enum(["always", "on_pass", "on_fail"]).optional()
      })
    )
    .default([]),
  runtime: z
    .object({
      maxLoops: z.number().int().min(0).max(12).default(2),
      maxStepExecutions: z.number().int().min(4).max(120).default(18),
      stageTimeoutMs: z.number().int().min(10000).max(1200000).default(420000)
    })
    .partial()
    .optional(),
  schedule: scheduleSchema.optional(),
  qualityGates: z.array(qualityGateSchema).max(80).default([])
});

const flowBuilderRequestSchema = z.object({
  prompt: z.string().min(2).max(16000),
  providerId: z.enum(["openai", "claude"]),
  model: z.string().min(1),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  fastMode: z.boolean().optional(),
  use1MContext: z.boolean().optional(),
  history: z.array(flowBuilderMessageSchema).max(40).optional(),
  currentDraft: flowBuilderDraftSchema.optional(),
  availableMcpServers: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().min(1).max(160),
        enabled: z.boolean().optional(),
        transport: z.enum(["stdio", "http", "sse"]).optional(),
        summary: z.string().max(320).optional()
      })
    )
    .max(40)
    .optional()
});


function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function sendZodError(error: unknown, response: Response): void {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }

  console.error("[api-error]", error);
  response.status(500).json({ error: "Internal server error" });
}

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

interface QueuePipelineRunOptions {
  pipeline: Pipeline;
  task: string;
  rawInputs?: Record<string, string>;
  persistSensitiveInputs: boolean;
}

class RunPreflightError extends Error {
  readonly failedChecks: SmartRunCheck[];

  constructor(failedChecks: SmartRunCheck[]) {
    const firstFailure = failedChecks[0];
    const message = firstFailure
      ? `Run blocked by preflight: ${firstFailure.title}: ${firstFailure.message}`
      : "Run blocked by preflight checks.";
    super(message);
    this.name = "RunPreflightError";
    this.failedChecks = failedChecks;
  }
}

function formatFailedPreflightCheck(check: SmartRunCheck | undefined): string {
  if (!check) {
    return "Unknown preflight failure.";
  }
  return `${check.title}: ${check.message}`;
}

async function queuePipelineRun(options: QueuePipelineRunOptions) {
  const normalizedRunInputs = normalizeRunInputs(options.rawInputs);
  const rawSensitiveInputs = pickSensitiveInputs(normalizedRunInputs);
  const secureInputs = await getPipelineSecureInputs(options.pipeline.id);
  const sensitiveUpdates = options.persistSensitiveInputs ? rawSensitiveInputs : {};
  const hasSensitiveUpdates = Object.keys(sensitiveUpdates).length > 0;

  if (hasSensitiveUpdates) {
    await upsertPipelineSecureInputs(options.pipeline.id, sensitiveUpdates);
  }

  const runtimeSecureInputs = hasSensitiveUpdates
    ? {
        ...secureInputs,
        ...sensitiveUpdates
      }
    : secureInputs;
  const mergedRuntimeInputs = mergeRunInputsWithSecure(normalizedRunInputs, runtimeSecureInputs);
  const preflightPlan = await buildSmartRunPlan(options.pipeline, store.getState(), mergedRuntimeInputs);
  const failedChecks = preflightPlan.checks.filter((check) => check.status === "fail");
  if (failedChecks.length > 0) {
    throw new RunPreflightError(failedChecks);
  }

  const keysToMask = [...new Set([...Object.keys(runtimeSecureInputs), ...Object.keys(rawSensitiveInputs)])];
  const maskedRunInputs = maskSensitiveInputs(mergedRuntimeInputs, keysToMask);
  const run = store.createRun(options.pipeline, options.task, maskedRunInputs);
  const abortController = new AbortController();
  activeRunControllers.set(run.id, abortController);

  void runPipeline({
    store,
    runId: run.id,
    pipeline: options.pipeline,
    task: options.task,
    runInputs: mergedRuntimeInputs,
    abortSignal: abortController.signal
  })
    .catch((error) => {
      console.error("[run-pipeline-error]", error);
      cancelRun(store, run.id, "Unexpected run error");
    })
    .finally(() => {
      activeRunControllers.delete(run.id);
    });

  return run;
}

async function attachWorkerToExistingRun(
  run: PipelineRun,
  pipeline: Pipeline,
  reason: string
): Promise<void> {
  if (activeRunControllers.has(run.id)) {
    return;
  }

  const secureInputs = await getPipelineSecureInputs(pipeline.id);
  const mergedRuntimeInputs = mergeRunInputsWithSecure(run.inputs ?? {}, secureInputs);
  const maskedRunInputs = maskSensitiveInputs(mergedRuntimeInputs, Object.keys(secureInputs));

  store.updateRun(run.id, (current) => ({
    ...current,
    pipelineName: pipeline.name,
    inputs: maskedRunInputs,
    logs: [...current.logs, reason]
  }));

  const abortController = new AbortController();
  activeRunControllers.set(run.id, abortController);

  void runPipeline({
    store,
    runId: run.id,
    pipeline,
    task: run.task,
    runInputs: mergedRuntimeInputs,
    abortSignal: abortController.signal
  })
    .catch((error) => {
      console.error("[recovered-run-error]", error);
      cancelRun(store, run.id, "Recovered run failed unexpectedly");
    })
    .finally(() => {
      activeRunControllers.delete(run.id);
    });
}

function listActivePipelineIds(): Set<string> {
  const activeStatuses = new Set<RunStatus>(["queued", "running", "paused", "awaiting_approval"]);
  const active = new Set<string>();

  for (const run of store.getState().runs) {
    if (activeStatuses.has(run.status)) {
      active.add(run.pipelineId);
    }
  }

  return active;
}

function buildPendingRunSteps(pipeline: Pipeline): PipelineRun["steps"] {
  const orderedSteps = orderPipelineSteps(pipeline.steps, pipeline.links);
  return orderedSteps.map((step) => ({
    stepId: step.id,
    stepName: step.name,
    role: step.role,
    status: "pending",
    attempts: 0,
    workflowOutcome: "neutral",
    inputContext: "",
    output: "",
    subagentNotes: [],
    qualityGateResults: []
  }));
}

async function resumeRunAfterRestart(run: PipelineRun, pipeline: Pipeline): Promise<void> {
  const secureInputs = await getPipelineSecureInputs(pipeline.id);
  const mergedRuntimeInputs = mergeRunInputsWithSecure(run.inputs ?? {}, secureInputs);
  const maskedRunInputs = maskSensitiveInputs(mergedRuntimeInputs, Object.keys(secureInputs));

  store.updateRun(run.id, (current) => ({
    ...current,
    pipelineName: pipeline.name,
    inputs: maskedRunInputs,
    status: "queued",
    finishedAt: undefined,
    logs: [...current.logs, `Recovery: re-queued after restart at ${new Date().toISOString()}`],
    steps: buildPendingRunSteps(pipeline),
    approvals: []
  }));

  const abortController = new AbortController();
  activeRunControllers.set(run.id, abortController);

  void runPipeline({
    store,
    runId: run.id,
    pipeline,
    task: run.task,
    runInputs: mergedRuntimeInputs,
    abortSignal: abortController.signal
  })
    .catch((error) => {
      console.error("[recovered-run-error]", error);
      cancelRun(store, run.id, "Recovered run failed unexpectedly");
    })
    .finally(() => {
      activeRunControllers.delete(run.id);
    });
}

async function recoverInterruptedRuns(): Promise<void> {
  const resumableStatuses = new Set<RunStatus>(["queued", "running"]);
  const suspendedStatuses = new Set<RunStatus>(["paused", "awaiting_approval"]);
  const allCandidates = store
    .getState()
    .runs.filter((run) => resumableStatuses.has(run.status) || suspendedStatuses.has(run.status));

  if (allCandidates.length === 0) {
    return;
  }

  for (const run of allCandidates) {
    const pipeline = store.getPipeline(run.pipelineId);
    if (!pipeline) {
      cancelRun(store, run.id, "Recovery failed: pipeline no longer exists");
      continue;
    }

    if (suspendedStatuses.has(run.status)) {
      const recoveryLog = `Recovery: run remains ${run.status}. Resume/approval action is required to continue.`;
      store.updateRun(run.id, (current) => ({
        ...current,
        logs:
          current.logs[current.logs.length - 1] === recoveryLog
            ? current.logs
            : [...current.logs, recoveryLog]
      }));
      console.info(`[recovery] Left run ${run.id} in ${run.status} state for pipeline "${pipeline.name}".`);
      continue;
    }

    console.info(`[recovery] Resuming run ${run.id} for pipeline "${pipeline.name}".`);
    await resumeRunAfterRestart(run, pipeline);
  }
}

async function ensureSchedulerMarkersLoaded(): Promise<void> {
  if (schedulerMarkersLoaded) {
    return;
  }

  try {
    const loaded = await loadSchedulerMarkers();
    scheduledRunMarkerByPipeline.clear();
    for (const [pipelineId, marker] of loaded.entries()) {
      scheduledRunMarkerByPipeline.set(pipelineId, marker);
    }
  } catch (error) {
    console.error("[scheduler-state-load-error]", error);
  } finally {
    schedulerMarkersLoaded = true;
  }
}

function buildSchedulerSlots(now: Date): Date[] {
  const slots: Date[] = [];
  for (let offset = schedulerCatchUpWindowMinutes; offset >= 0; offset -= 1) {
    const slot = new Date(now.getTime() - offset * 60_000);
    slot.setSeconds(0, 0);
    slots.push(slot);
  }
  return slots;
}

async function tickPipelineSchedules(): Promise<void> {
  if (schedulerTickActive) {
    return;
  }

  schedulerTickActive = true;

  try {
    await ensureSchedulerMarkersLoaded();

    const now = new Date();
    const slots = buildSchedulerSlots(now);
    const pipelines = store.listPipelines();
    const stateSnapshot = store.getState();
    const knownIds = new Set(pipelines.map((pipeline) => pipeline.id));
    let markersDirty = false;

    for (const pipelineId of [...scheduledRunMarkerByPipeline.keys()]) {
      if (!knownIds.has(pipelineId)) {
        scheduledRunMarkerByPipeline.delete(pipelineId);
        markersDirty = true;
      }
    }

    const activePipelineIds = listActivePipelineIds();

    for (const pipeline of pipelines) {
      const schedule = pipeline.schedule;
      const cron = schedule?.cron?.trim() ?? "";

      if (!schedule?.enabled || cron.length === 0) {
        if (scheduledRunMarkerByPipeline.delete(pipeline.id)) {
          markersDirty = true;
        }
        continue;
      }

      const parseResult = parseCronExpression(cron);
      if (!parseResult.ok) {
        const invalidMarker = `invalid-cron:${cron}`;
        if (scheduledRunMarkerByPipeline.get(pipeline.id) !== invalidMarker) {
          scheduledRunMarkerByPipeline.set(pipeline.id, invalidMarker);
          markersDirty = true;
          console.warn(`[scheduler] Skipping ${pipeline.name}: invalid cron "${cron}" (${parseResult.error}).`);
        }
        continue;
      }

      const timezone =
        typeof schedule.timezone === "string" && schedule.timezone.trim().length > 0
          ? schedule.timezone.trim()
          : schedulerDefaultTimezone;
      if (!getZonedMinuteKey(now, timezone)) {
        const invalidMarker = `invalid-timezone:${timezone}`;
        if (scheduledRunMarkerByPipeline.get(pipeline.id) !== invalidMarker) {
          scheduledRunMarkerByPipeline.set(pipeline.id, invalidMarker);
          markersDirty = true;
          console.warn(`[scheduler] Skipping ${pipeline.name}: invalid timezone "${timezone}".`);
        }
        continue;
      }

      for (const slot of slots) {
        const slotMinuteKey = getZonedMinuteKey(slot, timezone);
        if (!slotMinuteKey) {
          continue;
        }

        const matches = matchesCronExpression(parseResult.expression, slot, timezone);
        if (!matches) {
          continue;
        }

        const marker = `${slotMinuteKey}|${cron}|${timezone}`;
        if (scheduledRunMarkerByPipeline.get(pipeline.id) === marker) {
          continue;
        }

        scheduledRunMarkerByPipeline.set(pipeline.id, marker);
        markersDirty = true;

        if (activePipelineIds.has(pipeline.id)) {
          console.info(
            `[scheduler] Skipping scheduled run for "${pipeline.name}" at ${slotMinuteKey} (${timezone}) because a run is already active.`
          );
          continue;
        }

        const task =
          typeof schedule.task === "string" && schedule.task.trim().length > 0
            ? schedule.task.trim()
            : `${schedulerDefaultTaskPrefix} "${pipeline.name}"`;
        const runMode = schedule.runMode === "quick" ? "quick" : "smart";
        const scheduleInputs = runMode === "smart" ? normalizeRunInputs(schedule.inputs ?? {}) : {};

        try {
          const secureInputs = await getPipelineSecureInputs(pipeline.id);
          const preflightInputs = mergeRunInputsWithSecure(scheduleInputs, secureInputs);
          const preflightPlan = await buildSmartRunPlan(pipeline, stateSnapshot, preflightInputs);
          const failedChecks = preflightPlan.checks.filter((check) => check.status === "fail");

          if (failedChecks.length > 0) {
            const failureMessage = formatFailedPreflightCheck(failedChecks[0]);
            console.warn(
              `[scheduler] Skipping scheduled run for "${pipeline.name}" (${runMode}) at ${slotMinuteKey} (${timezone}) because preflight failed: ${failureMessage}`
            );
            continue;
          }

          const run = await queuePipelineRun({
            pipeline,
            task,
            rawInputs: scheduleInputs,
            persistSensitiveInputs: false
          });
          activePipelineIds.add(pipeline.id);
          console.info(`[scheduler] Triggered "${pipeline.name}" at ${slotMinuteKey} (${timezone}) as run ${run.id}.`);
        } catch (error) {
          if (error instanceof RunPreflightError) {
            const failureMessage = formatFailedPreflightCheck(error.failedChecks[0]);
            console.warn(
              `[scheduler] Skipping scheduled run for "${pipeline.name}" (${runMode}) at ${slotMinuteKey} (${timezone}) because queue preflight failed: ${failureMessage}`
            );
            continue;
          }

          scheduledRunMarkerByPipeline.delete(pipeline.id);
          markersDirty = true;
          console.error(`[scheduler] Failed to trigger scheduled run for "${pipeline.name}".`, error);
        }
      }
    }

    if (markersDirty) {
      await saveSchedulerMarkers(scheduledRunMarkerByPipeline);
    }
  } catch (error) {
    console.error("[scheduler-error]", error);
  } finally {
    schedulerTickActive = false;
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/state", (_request, response) => {
  response.json(sanitizeDashboardState(store.getState()));
});

app.get("/api/model-catalog", (_request, response) => {
  response.json({ modelCatalog: MODEL_CATALOG });
});

app.get("/api/pipelines", (_request, response) => {
  response.json({ pipelines: store.listPipelines() });
});

app.post("/api/pipelines", (request: Request, response: Response) => {
  try {
    const input = pipelineSchema.parse(request.body);
    const pipeline = store.createPipeline(input);
    response.status(201).json({ pipeline });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.put("/api/pipelines/:pipelineId", (request: Request, response: Response) => {
  try {
    const input = pipelineSchema.parse(request.body);
    const pipeline = store.updatePipeline(firstParam(request.params.pipelineId), input);

    if (!pipeline) {
      response.status(404).json({ error: "Pipeline not found" });
      return;
    }

    response.json({ pipeline });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.delete("/api/pipelines/:pipelineId", (request: Request, response: Response) => {
  const removed = store.deletePipeline(firstParam(request.params.pipelineId));
  if (!removed) {
    response.status(404).json({ error: "Pipeline not found" });
    return;
  }

  response.status(204).send();
});

app.put("/api/providers/:providerId", (request: Request, response: Response) => {
  try {
    const providerId = z.enum(["openai", "claude"]).parse(firstParam(request.params.providerId));
    const input = providerUpdateSchema.parse(request.body);
    const provider = store.upsertProvider(providerId, input);
    response.json({ provider: sanitizeProviderConfig(provider) });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.get("/api/providers/:providerId/oauth/status", async (request: Request, response: Response) => {
  try {
    const providerId = z.enum(["openai", "claude"]).parse(firstParam(request.params.providerId));
    const deepRaw = request.query.deep;
    const deep = (Array.isArray(deepRaw) ? deepRaw[0] : deepRaw) === "1";
    const status = await getProviderOAuthStatus(providerId, { includeRuntimeProbe: deep });
    response.json({ status });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.post("/api/providers/:providerId/oauth/start", async (request: Request, response: Response) => {
  try {
    const providerId = z.enum(["openai", "claude"]).parse(firstParam(request.params.providerId));
    const result = await startProviderOAuthLogin(providerId);
    const status = await getProviderOAuthStatus(providerId);
    response.status(202).json({ result, status });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.post("/api/providers/:providerId/oauth/sync-token", async (request: Request, response: Response) => {
  try {
    const providerId = z.enum(["openai", "claude"]).parse(firstParam(request.params.providerId));
    const result = await syncProviderOAuthToken(providerId);

    if (result.oauthToken) {
      store.upsertProvider(providerId, {
        authMode: "oauth",
        oauthToken: result.oauthToken
      });
    }

    const provider = store.getProviders()[providerId];
    response.json({
      provider: sanitizeProviderConfig(provider),
      result: result.oauthToken
        ? {
            ...result,
            oauthToken: MASK_VALUE
          }
        : result
    });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.get("/api/mcp-servers", (_request: Request, response: Response) => {
  response.json({ mcpServers: store.listMcpServers().map((server) => sanitizeMcpServer(server)) });
});

app.post("/api/mcp-servers", (request: Request, response: Response) => {
  try {
    const input = mcpServerSchema.parse(request.body);
    const mcpServer = store.createMcpServer(input);
    response.status(201).json({ mcpServer: sanitizeMcpServer(mcpServer) });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.put("/api/mcp-servers/:serverId", (request: Request, response: Response) => {
  try {
    const input = mcpServerPatchSchema.parse(request.body);
    const mcpServer = store.updateMcpServer(firstParam(request.params.serverId), input);

    if (!mcpServer) {
      response.status(404).json({ error: "MCP server not found" });
      return;
    }

    response.json({ mcpServer: sanitizeMcpServer(mcpServer) });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.delete("/api/mcp-servers/:serverId", (request: Request, response: Response) => {
  const removed = store.deleteMcpServer(firstParam(request.params.serverId));
  if (!removed) {
    response.status(404).json({ error: "MCP server not found" });
    return;
  }

  response.status(204).send();
});

app.put("/api/storage", (request: Request, response: Response) => {
  try {
    const input = storageUpdateSchema.parse(request.body);
    const storage = store.updateStorageConfig(input);
    response.json({ storage });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.get("/api/runs", (request: Request, response: Response) => {
  const limitRaw = request.query.limit;
  const limit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 30;
  response.json({ runs: store.listRuns(Number.isNaN(limit) ? 30 : limit) });
});

app.get("/api/runs/:runId", (request: Request, response: Response) => {
  const run = store.getRun(firstParam(request.params.runId));
  if (!run) {
    response.status(404).json({ error: "Run not found" });
    return;
  }

  response.json({ run });
});

app.post("/api/pipelines/:pipelineId/smart-run-plan", async (request: Request, response: Response) => {
  try {
    const pipeline = store.getPipeline(firstParam(request.params.pipelineId));
    if (!pipeline) {
      response.status(404).json({ error: "Pipeline not found" });
      return;
    }

    const input = smartRunPlanRequestSchema.parse(request.body ?? {});
    const secureInputs = await getPipelineSecureInputs(pipeline.id);
    const mergedInputs = mergeRunInputsWithSecure(input.inputs ?? {}, secureInputs);
    const plan = await buildSmartRunPlan(pipeline, store.getState(), mergedInputs);
    response.json({ plan });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.post("/api/pipelines/:pipelineId/startup-check", async (request: Request, response: Response) => {
  try {
    const pipeline = store.getPipeline(firstParam(request.params.pipelineId));
    if (!pipeline) {
      response.status(404).json({ error: "Pipeline not found" });
      return;
    }

    const input = startupCheckRequestSchema.parse(request.body ?? {});
    const secureInputs = await getPipelineSecureInputs(pipeline.id);
    const mergedInputs = mergeRunInputsWithSecure(input.inputs ?? {}, secureInputs);
    const check = await buildRunStartupCheck(pipeline, store.getState(), {
      task: input.task,
      inputs: mergedInputs
    });
    response.json({ check });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.post("/api/pipelines/:pipelineId/secure-inputs", async (request: Request, response: Response) => {
  try {
    const pipeline = store.getPipeline(firstParam(request.params.pipelineId));
    if (!pipeline) {
      response.status(404).json({ error: "Pipeline not found" });
      return;
    }

    const input = secureInputsUpdateSchema.parse(request.body ?? {});
    const normalized = normalizeRunInputs(input.inputs);
    if (Object.keys(normalized).length === 0) {
      response.json({ savedKeys: [] });
      return;
    }

    await upsertPipelineSecureInputs(pipeline.id, normalized);
    response.json({ savedKeys: Object.keys(normalized).sort() });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.delete("/api/pipelines/:pipelineId/secure-inputs", async (request: Request, response: Response) => {
  try {
    const pipeline = store.getPipeline(firstParam(request.params.pipelineId));
    if (!pipeline) {
      response.status(404).json({ error: "Pipeline not found" });
      return;
    }

    const input = secureInputsDeleteSchema.parse(request.body ?? {});
    const result = await deletePipelineSecureInputs(pipeline.id, input.keys);
    response.json(result);
  } catch (error) {
    sendZodError(error, response);
  }
});

app.post("/api/flow-builder/generate", async (request: Request, response: Response) => {
  try {
    const input = flowBuilderRequestSchema.parse(request.body);
    const result = await generateFlowDraft(input, store.getProviders());
    response.json(result);
  } catch (error) {
    sendZodError(error, response);
  }
});

app.post("/api/pipelines/:pipelineId/runs", async (request: Request, response: Response) => {
  try {
    const pipeline = store.getPipeline(firstParam(request.params.pipelineId));
    if (!pipeline) {
      response.status(404).json({ error: "Pipeline not found" });
      return;
    }

    const input = runRequestSchema.parse(request.body);
    const task = input.task.trim().length > 0 ? input.task.trim() : `Run flow "${pipeline.name}"`;
    const run = await queuePipelineRun({
      pipeline,
      task,
      rawInputs: input.inputs ?? {},
      persistSensitiveInputs: true
    });

    response.status(202).json({ run });
  } catch (error) {
    if (error instanceof RunPreflightError) {
      response.status(409).json({
        error: error.message,
        reason: "preflight_failed",
        failedChecks: error.failedChecks
      });
      return;
    }

    sendZodError(error, response);
  }
});

app.post("/api/runs/:runId/stop", (request: Request, response: Response) => {
  const runId = firstParam(request.params.runId);
  const run = store.getRun(runId);
  if (!run) {
    response.status(404).json({ error: "Run not found" });
    return;
  }

  const controller = activeRunControllers.get(runId);
  if (controller) {
    controller.abort(createAbortError("Stopped by user"));
  }

  cancelRun(store, runId, "Stopped by user");
  const updated = store.getRun(runId) ?? run;

  response.json({
    run: updated
  });
});

app.post("/api/runs/:runId/pause", (request: Request, response: Response) => {
  const runId = firstParam(request.params.runId);
  const run = store.getRun(runId);
  if (!run) {
    response.status(404).json({ error: "Run not found" });
    return;
  }

  const paused = pauseRun(store, runId);
  if (!paused) {
    response.status(409).json({ error: "Run cannot be paused in its current state." });
    return;
  }

  const updated = store.getRun(runId) ?? run;
  response.json({ run: updated });
});

app.post("/api/runs/:runId/resume", async (request: Request, response: Response) => {
  const runId = firstParam(request.params.runId);
  const run = store.getRun(runId);
  if (!run) {
    response.status(404).json({ error: "Run not found" });
    return;
  }

  const resumed = resumeRun(store, runId);
  if (!resumed) {
    response.status(409).json({ error: "Run is not paused." });
    return;
  }

  const updated = store.getRun(runId) ?? run;
  const shouldAttachWorker =
    (updated.status === "running" || updated.status === "awaiting_approval") &&
    !activeRunControllers.has(runId);

  if (shouldAttachWorker) {
    const pipeline = store.getPipeline(updated.pipelineId);
    if (!pipeline) {
      cancelRun(store, runId, "Resume failed: pipeline no longer exists");
      response.status(409).json({ error: "Pipeline not found for resumed run", run: store.getRun(runId) ?? updated });
      return;
    }

    await attachWorkerToExistingRun(
      updated,
      pipeline,
      `Recovery: execution worker attached after resume at ${new Date().toISOString()}.`
    );
  }

  response.json({ run: store.getRun(runId) ?? updated });
});

app.post("/api/runs/:runId/approvals/:approvalId", async (request: Request, response: Response) => {
  const runId = firstParam(request.params.runId);
  const approvalId = firstParam(request.params.approvalId);

  try {
    const input = runApprovalResolveSchema.parse(request.body ?? {});
    const result = resolveRunApproval(store, runId, approvalId, input.decision, input.note);

    if (result.status === "run_not_found") {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    if (result.status === "approval_not_found") {
      response.status(404).json({ error: "Approval not found" });
      return;
    }

    if (result.status === "already_resolved") {
      response.status(409).json({ error: "Approval is already resolved", run: result.run });
      return;
    }

    const shouldAttachWorker =
      (result.run.status === "running" || result.run.status === "awaiting_approval") &&
      !activeRunControllers.has(runId);

    if (shouldAttachWorker) {
      const pipeline = store.getPipeline(result.run.pipelineId);
      if (!pipeline) {
        cancelRun(store, runId, "Approval resolved but pipeline is missing");
        response.status(409).json({ error: "Pipeline not found for approval run", run: store.getRun(runId) ?? result.run });
        return;
      }

      await attachWorkerToExistingRun(
        result.run,
        pipeline,
        `Recovery: execution worker attached after approval at ${new Date().toISOString()}.`
      );
    }

    response.json({ run: store.getRun(runId) ?? result.run });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _request: Request, response: Response) => {
  console.error("[unhandled-api-error]", error);
  response.status(500).json({ error: "Internal server error" });
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
