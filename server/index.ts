import cors from "cors";
import express, { type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { MODEL_CATALOG } from "./modelCatalog.js";
import { LocalStore } from "./storage.js";
import { getProviderOAuthStatus, startProviderOAuthLogin, syncProviderOAuthToken } from "./oauth.js";
import { cancelRun, runPipeline } from "./runner.js";
import { generateFlowDraft } from "./flowBuilder.js";
import { buildSmartRunPlan } from "./smartRun.js";
import { buildRunStartupCheck } from "./startupCheck.js";
import { createAbortError } from "./abort.js";
import { normalizeRunInputs } from "./runInputs.js";
import {
  getPipelineSecureInputs,
  maskSensitiveInputs,
  mergeRunInputsWithSecure,
  pickSensitiveInputs,
  upsertPipelineSecureInputs
} from "./secureInputs.js";

const app = express();
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
  kind: z.enum(["regex_must_match", "regex_must_not_match", "json_field_exists", "artifact_exists"]),
  blocking: z.boolean().default(true),
  pattern: z.string().max(2000).default(""),
  flags: z.string().max(12).default(""),
  jsonPath: z.string().max(2000).default(""),
  artifactPath: z.string().max(4000).default(""),
  message: z.string().max(2000).default("")
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
      stageTimeoutMs: z.number().int().min(10000).max(1200000).default(240000)
    })
    .partial()
    .default({}),
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
      stageTimeoutMs: z.number().int().min(10000).max(1200000).default(240000)
    })
    .partial()
    .optional(),
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
  currentDraft: flowBuilderDraftSchema.optional()
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

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/state", (_request, response) => {
  response.json(store.getState());
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
    response.json({ provider });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.get("/api/providers/:providerId/oauth/status", async (request: Request, response: Response) => {
  try {
    const providerId = z.enum(["openai", "claude"]).parse(firstParam(request.params.providerId));
    const status = await getProviderOAuthStatus(providerId);
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
    response.json({ provider, result });
  } catch (error) {
    sendZodError(error, response);
  }
});

app.get("/api/mcp-servers", (_request: Request, response: Response) => {
  response.json({ mcpServers: store.listMcpServers() });
});

app.post("/api/mcp-servers", (request: Request, response: Response) => {
  try {
    const input = mcpServerSchema.parse(request.body);
    const mcpServer = store.createMcpServer(input);
    response.status(201).json({ mcpServer });
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

    response.json({ mcpServer });
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
    const normalizedRunInputs = normalizeRunInputs(input.inputs);
    const secureInputs = await getPipelineSecureInputs(pipeline.id);
    const sensitiveUpdates = pickSensitiveInputs(normalizedRunInputs);
    const hasSensitiveUpdates = Object.keys(sensitiveUpdates).length > 0;

    if (hasSensitiveUpdates) {
      await upsertPipelineSecureInputs(pipeline.id, sensitiveUpdates);
    }

    const runtimeSecureInputs = hasSensitiveUpdates
      ? {
          ...secureInputs,
          ...sensitiveUpdates
        }
      : secureInputs;
    const mergedRuntimeInputs = mergeRunInputsWithSecure(normalizedRunInputs, runtimeSecureInputs);
    const maskedRunInputs = maskSensitiveInputs(mergedRuntimeInputs, Object.keys(runtimeSecureInputs));
    const run = store.createRun(pipeline, task, maskedRunInputs);
    const abortController = new AbortController();
    activeRunControllers.set(run.id, abortController);

    void runPipeline({
      store,
      runId: run.id,
      pipeline,
      task,
      runInputs: mergedRuntimeInputs,
      abortSignal: abortController.signal
    }).catch((error) => {
      console.error("[run-pipeline-error]", error);
      cancelRun(store, run.id, "Unexpected run error");
    }).finally(() => {
      activeRunControllers.delete(run.id);
    });

    response.status(202).json({ run });
  } catch (error) {
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
});
