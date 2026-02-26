import { z } from "zod";
import { isValidTimeZone, parseCronExpression } from "../../../cron.js";

const schedulerDefaultTimezone = "UTC";

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
  requiredOutputFiles: z.array(z.string().min(1)).max(40).default([]),
  scenarios: z.array(z.string().min(1).max(80)).max(20).default([]),
  skipIfArtifacts: z.array(z.string().min(1).max(4000)).max(40).default([]),
  policyProfileIds: z.array(z.string().min(1).max(120)).max(20).default([]),
  cacheBypassInputKeys: z.array(z.string().min(1).max(160)).max(20).default([]),
  cacheBypassOrchestratorPromptPatterns: z.array(z.string().min(1).max(800)).max(20).default([])
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

export const pipelineSchema = z.object({
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
      stageTimeoutMs: z.number().int().min(10000).max(18000000).default(420000)
    })
    .partial()
    .default({}),
  schedule: scheduleSchema,
  qualityGates: z.array(qualityGateSchema).max(80).default([])
});

export const providerUpdateSchema = z.object({
  authMode: z.enum(["api_key", "oauth"]).optional(),
  apiKey: z.string().optional(),
  oauthToken: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional()
});

export const providerIdSchema = z.enum(["openai", "claude"]);
export const providerOAuthCodeSubmitSchema = z.object({
  code: z.string().min(1).max(4096)
});

export const mcpServerSchema = z.object({
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

export const mcpServerPatchSchema = mcpServerSchema.partial();

export const storageUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  rootPath: z.string().min(1).max(4000).optional(),
  sharedFolder: z.string().min(1).max(240).optional(),
  isolatedFolder: z.string().min(1).max(240).optional(),
  runsFolder: z.string().min(1).max(240).optional()
});

export const filesScopeSchema = z.enum(["shared", "isolated", "runs"]);

const baseFilesSchema = z.object({
  pipelineId: z.string().min(1).max(240),
  scope: filesScopeSchema,
  runId: z.string().min(1).max(240).optional()
});

export const filesListQuerySchema = baseFilesSchema
  .extend({
    path: z.string().max(4000).optional().default("")
  })
  .superRefine((value, context) => {
    if (value.scope === "runs" && (!value.runId || value.runId.trim().length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runId"],
        message: "runId is required when scope is runs."
      });
    }
  });

export const filesContentQuerySchema = baseFilesSchema
  .extend({
    path: z.string().min(1).max(4000),
    maxBytes: z.coerce.number().int().min(1).max(1024 * 1024).optional().default(256 * 1024)
  })
  .superRefine((value, context) => {
    if (value.scope === "runs" && (!value.runId || value.runId.trim().length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runId"],
        message: "runId is required when scope is runs."
      });
    }
  });

export const filesDeleteSchema = baseFilesSchema
  .extend({
    path: z.string().min(1).max(4000),
    recursive: z.boolean().optional().default(false)
  })
  .superRefine((value, context) => {
    if (value.scope === "runs" && (!value.runId || value.runId.trim().length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runId"],
        message: "runId is required when scope is runs."
      });
    }
  });

export const filesUploadChunkSchema = baseFilesSchema
  .extend({
    destinationPath: z.string().min(1).max(4000),
    uploadId: z.string().min(1).max(160),
    chunkIndex: z.number().int().min(0).max(10000),
    totalChunks: z.number().int().min(1).max(10000),
    totalSizeBytes: z.number().int().min(0).max(40 * 1024 * 1024),
    chunkBase64: z.string().max(1024 * 1024),
    overwrite: z.boolean().optional().default(false)
  })
  .superRefine((value, context) => {
    if (value.scope === "runs" && (!value.runId || value.runId.trim().length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runId"],
        message: "runId is required when scope is runs."
      });
    }
    if (value.chunkIndex >= value.totalChunks) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chunkIndex"],
        message: "chunkIndex must be less than totalChunks."
      });
    }
  });

export const filesImportUrlSchema = baseFilesSchema
  .extend({
    sourceUrl: z.string().url().max(4000),
    destinationPath: z.string().min(1).max(4000).optional(),
    overwrite: z.boolean().optional().default(false)
  })
  .superRefine((value, context) => {
    if (value.scope === "runs" && (!value.runId || value.runId.trim().length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runId"],
        message: "runId is required when scope is runs."
      });
    }
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

export const runRequestSchema = z.object({
  task: z.string().max(16000).optional().default(""),
  inputs: runInputsSchema,
  scenario: z.string().min(1).max(80).optional()
});

export const smartRunPlanRequestSchema = z.object({
  inputs: runInputsSchema
});

export const startupCheckRequestSchema = z.object({
  task: z.string().max(16000).optional().default(""),
  inputs: runInputsSchema
});

export const secureInputsUpdateSchema = z.object({
  inputs: runInputsRecordSchema
});

export const secureInputsDeleteSchema = z.object({
  keys: z.array(z.string().min(1).max(160)).max(120).optional()
});

const FLOW_BUILDER_PROMPT_MAX_CHARS = 64_000;
const FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS = 64_000;

const flowBuilderMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS)
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
      stageTimeoutMs: z.number().int().min(10000).max(18000000).default(420000)
    })
    .partial()
    .optional(),
  schedule: scheduleSchema.optional(),
  qualityGates: z.array(qualityGateSchema).max(80).default([])
});

export const flowBuilderRequestSchema = z.object({
  requestId: z.string().min(1).max(120).optional(),
  prompt: z.string().min(2).max(FLOW_BUILDER_PROMPT_MAX_CHARS),
  providerId: z.enum(["openai", "claude"]),
  model: z.string().min(1),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  fastMode: z.boolean().optional(),
  use1MContext: z.boolean().optional(),
  history: z.array(flowBuilderMessageSchema).max(240).optional(),
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
