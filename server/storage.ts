import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { resolveDefaultContextWindow, resolveDefaultModel, resolveReasoning } from "./modelCatalog.js";
import { createLinearLinks, normalizePipelineLinks, orderPipelineSteps } from "./pipelineGraph.js";
import { normalizeRunInputs, type RunInputs } from "./runInputs.js";
import { MASK_VALUE } from "./secureInputs.js";
import { decryptSecret, encryptSecret } from "./secretsCrypto.js";
import type {
  DashboardState,
  Pipeline,
  PipelineInput,
  PipelineQualityGate,
  PipelineRuntimeConfig,
  PipelineScheduleConfig,
  PipelineRun,
  PipelineStep,
  ScheduleRunMode,
  ProviderId,
  ProviderUpdateInput,
  McpServerInput,
  StorageUpdateInput,
  AgentRole,
  McpServerConfig,
  StorageConfig,
  ProviderConfig,
  RunStatus,
  RunApproval,
  StepRun,
  StepQualityGateResult
} from "./types.js";

const DB_PATH = path.resolve(process.cwd(), "data", "local-db.json");
const DEFAULT_STEP_X = 80;
const DEFAULT_STEP_Y = 130;
const DEFAULT_STEP_GAP_X = 280;
const DEFAULT_MAX_LOOPS = 2;
const DEFAULT_MAX_STEP_EXECUTIONS = 18;
const DEFAULT_STAGE_TIMEOUT_MS = 420000;
const DEFAULT_SCHEDULE_TIMEZONE = "UTC";
const DEFAULT_STORAGE_ROOT_PATH = path.resolve(process.cwd(), "data", "agent-storage");
const DEFAULT_SHARED_FOLDER = "shared";
const DEFAULT_ISOLATED_FOLDER = "isolated";
const DEFAULT_RUNS_FOLDER = "runs";
const MAX_CONTRACT_ITEMS = 40;
const MAX_QUALITY_GATES = 80;

const rolePromptDefaults: Record<AgentRole, string> = {
  analysis: "Analyze requirements, constraints, unknowns, and acceptance criteria. Produce a risk-aware technical brief.",
  planner: "Convert analysis into a concrete plan with milestones, dependencies, and expected outputs per milestone.",
  orchestrator:
    "Coordinate connected agents as a workflow manager. Route tasks, decide retries via pass/fail outcomes, and produce concise gate decisions.",
  executor:
    "Implement the plan in small validated increments. If delegation is enabled, partition work for subagents and consolidate outputs.",
  tester: "Validate the solution with test strategy, edge cases, regressions, and release confidence scoring.",
  review: "Review final output for quality, risks, and production readiness. Provide concise approval feedback."
};

function nowIso(): string {
  return new Date().toISOString();
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function defaultStepPosition(index: number): PipelineStep["position"] {
  return {
    x: DEFAULT_STEP_X + index * DEFAULT_STEP_GAP_X,
    y: DEFAULT_STEP_Y + (index % 2 === 0 ? 0 : 24)
  };
}

function defaultRuntimeConfig(): PipelineRuntimeConfig {
  return {
    maxLoops: DEFAULT_MAX_LOOPS,
    maxStepExecutions: DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs: DEFAULT_STAGE_TIMEOUT_MS
  };
}

function defaultScheduleConfig(): PipelineScheduleConfig {
  return {
    enabled: false,
    cron: "",
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    task: "",
    runMode: "smart",
    inputs: {}
  };
}

function normalizeRuntimeConfig(raw: Partial<PipelineRuntimeConfig> | undefined): PipelineRuntimeConfig {
  return {
    maxLoops:
      typeof raw?.maxLoops === "number" && Number.isFinite(raw.maxLoops)
        ? Math.max(0, Math.min(12, Math.floor(raw.maxLoops)))
        : DEFAULT_MAX_LOOPS,
    maxStepExecutions:
      typeof raw?.maxStepExecutions === "number" && Number.isFinite(raw.maxStepExecutions)
        ? Math.max(4, Math.min(120, Math.floor(raw.maxStepExecutions)))
        : DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs:
      typeof raw?.stageTimeoutMs === "number" && Number.isFinite(raw.stageTimeoutMs)
        ? Math.max(10_000, Math.min(1_200_000, Math.floor(raw.stageTimeoutMs)))
        : DEFAULT_STAGE_TIMEOUT_MS
  };
}

function normalizeScheduleConfig(raw: Partial<PipelineScheduleConfig> | undefined): PipelineScheduleConfig {
  const cron = typeof raw?.cron === "string" ? raw.cron.trim() : "";
  const requestedTimezone =
    typeof raw?.timezone === "string" && raw.timezone.trim().length > 0 ? raw.timezone.trim() : DEFAULT_SCHEDULE_TIMEZONE;
  const timezone = isValidTimeZone(requestedTimezone) ? requestedTimezone : DEFAULT_SCHEDULE_TIMEZONE;
  const task = typeof raw?.task === "string" ? raw.task.trim() : "";
  const runMode: ScheduleRunMode = raw?.runMode === "quick" ? "quick" : "smart";
  const inputs = normalizeRunInputs(raw?.inputs);

  return {
    enabled: raw?.enabled === true && cron.length > 0,
    cron,
    timezone,
    task,
    runMode,
    inputs
  };
}

function normalizeStringList(raw: unknown, maxItems = MAX_CONTRACT_ITEMS): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, maxItems);
}

function normalizeQualityGateKind(raw: unknown): PipelineQualityGate["kind"] {
  if (
    raw === "regex_must_match" ||
    raw === "regex_must_not_match" ||
    raw === "json_field_exists" ||
    raw === "artifact_exists" ||
    raw === "manual_approval"
  ) {
    return raw;
  }

  return "regex_must_match";
}

function normalizeQualityGates(
  rawGates: PipelineInput["qualityGates"],
  steps: PipelineStep[]
): PipelineQualityGate[] {
  if (!Array.isArray(rawGates) || rawGates.length === 0) {
    return [];
  }

  const validStepIds = new Set(steps.map((step) => step.id));
  const seen = new Set<string>();
  const gates: PipelineQualityGate[] = [];

  for (const rawGate of rawGates) {
    if (!rawGate || typeof rawGate !== "object") {
      continue;
    }

    const name =
      typeof rawGate.name === "string" && rawGate.name.trim().length > 0 ? rawGate.name.trim() : "Quality gate";
    const kind = normalizeQualityGateKind(rawGate.kind);
    const targetStepId =
      rawGate.targetStepId === "any_step"
        ? "any_step"
        : typeof rawGate.targetStepId === "string" && validStepIds.has(rawGate.targetStepId)
          ? rawGate.targetStepId
          : "any_step";

    const normalized: PipelineQualityGate = {
      id: typeof rawGate.id === "string" && rawGate.id.trim().length > 0 ? rawGate.id.trim() : nanoid(),
      name,
      targetStepId,
      kind,
      blocking: rawGate.blocking !== false,
      pattern: typeof rawGate.pattern === "string" ? rawGate.pattern : "",
      flags: typeof rawGate.flags === "string" ? rawGate.flags : "",
      jsonPath: typeof rawGate.jsonPath === "string" ? rawGate.jsonPath : "",
      artifactPath: typeof rawGate.artifactPath === "string" ? rawGate.artifactPath : "",
      message: typeof rawGate.message === "string" ? rawGate.message : ""
    };

    const dedupeKey = `${normalized.name.toLowerCase()}|${normalized.kind}|${normalized.targetStepId}|${normalized.pattern}|${normalized.jsonPath}|${normalized.artifactPath}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    gates.push(normalized);

    if (gates.length >= MAX_QUALITY_GATES) {
      break;
    }
  }

  return gates;
}

function normalizeStepQualityGateResults(raw: unknown): StepQualityGateResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const item = entry as Partial<StepQualityGateResult>;
      const kind =
        item.kind === "step_contract" ||
        item.kind === "regex_must_match" ||
        item.kind === "regex_must_not_match" ||
        item.kind === "json_field_exists" ||
        item.kind === "artifact_exists" ||
        item.kind === "manual_approval"
          ? item.kind
          : "step_contract";

      const status = item.status === "pass" || item.status === "fail" ? item.status : "fail";

      return {
        gateId: typeof item.gateId === "string" && item.gateId.trim().length > 0 ? item.gateId : nanoid(),
        gateName: typeof item.gateName === "string" && item.gateName.trim().length > 0 ? item.gateName : "Quality gate",
        kind,
        status,
        blocking: item.blocking !== false,
        message: typeof item.message === "string" ? item.message : "",
        details: typeof item.details === "string" ? item.details : ""
      } satisfies StepQualityGateResult;
    })
    .filter((entry): entry is StepQualityGateResult => entry !== null)
    .slice(0, 200);
}

function normalizeRunStatus(status: unknown): RunStatus {
  return status === "queued" ||
    status === "running" ||
    status === "paused" ||
    status === "awaiting_approval" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
    ? status
    : "failed";
}

function normalizeRunApprovals(raw: unknown): RunApproval[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const item = entry as Partial<RunApproval>;
      const status =
        item.status === "pending" || item.status === "approved" || item.status === "rejected"
          ? item.status
          : "pending";
      const gateId = typeof item.gateId === "string" ? item.gateId.trim() : "";
      const stepId = typeof item.stepId === "string" ? item.stepId.trim() : "";

      if (gateId.length === 0 || stepId.length === 0) {
        return null;
      }

      const normalized: RunApproval = {
        id: typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : `${gateId}:${stepId}`,
        gateId,
        gateName: typeof item.gateName === "string" && item.gateName.trim().length > 0 ? item.gateName.trim() : "Manual approval",
        stepId,
        stepName: typeof item.stepName === "string" ? item.stepName : stepId,
        status,
        blocking: item.blocking !== false,
        message: typeof item.message === "string" ? item.message : "",
        requestedAt: typeof item.requestedAt === "string" && item.requestedAt.length > 0 ? item.requestedAt : nowIso()
      };

      if (typeof item.resolvedAt === "string" && item.resolvedAt.length > 0) {
        normalized.resolvedAt = item.resolvedAt;
      }

      if (typeof item.note === "string" && item.note.trim().length > 0) {
        normalized.note = item.note.trim();
      }

      return normalized;
    })
    .filter((entry): entry is RunApproval => entry !== null)
    .slice(0, 300);
}

function createDefaultStep(role: AgentRole, name: string, providerId: ProviderId, index: number): PipelineStep {
  const model = resolveDefaultModel(providerId);
  return {
    id: nanoid(),
    name,
    role,
    prompt: rolePromptDefaults[role],
    providerId,
    model,
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: resolveDefaultContextWindow(providerId, model),
    position: defaultStepPosition(index),
    contextTemplate:
      "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}\n\nDeliverable for this step:\n- Keep concise\n- Make assumptions explicit",
    enableDelegation: role === "executor" || role === "orchestrator",
    delegationCount: role === "executor" || role === "orchestrator" ? 2 : 1,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: []
  };
}

function createDefaultProviders(now: string): Record<ProviderId, ProviderConfig> {
  return {
    openai: {
      id: "openai",
      label: "OpenAI / Codex",
      authMode: "api_key",
      apiKey: "",
      oauthToken: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: resolveDefaultModel("openai"),
      updatedAt: now
    },
    claude: {
      id: "claude",
      label: "Anthropic",
      authMode: "api_key",
      apiKey: "",
      oauthToken: "",
      baseUrl: "https://api.anthropic.com/v1",
      defaultModel: resolveDefaultModel("claude"),
      updatedAt: now
    }
  };
}

function createDefaultStorageConfig(now: string): StorageConfig {
  return {
    enabled: true,
    rootPath: DEFAULT_STORAGE_ROOT_PATH,
    sharedFolder: DEFAULT_SHARED_FOLDER,
    isolatedFolder: DEFAULT_ISOLATED_FOLDER,
    runsFolder: DEFAULT_RUNS_FOLDER,
    updatedAt: now
  };
}

function createDefaultState(): DashboardState {
  const now = nowIso();
  const starterSteps: PipelineStep[] = [
    createDefaultStep("analysis", "1. Analysis Bot", "openai", 0),
    createDefaultStep("planner", "2. Planner Bot", "openai", 1),
    createDefaultStep("executor", "3. Executor / Orchestrator", "claude", 2),
    createDefaultStep("tester", "4. Tester Bot", "claude", 3),
    createDefaultStep("review", "5. Review Gate (You)", "openai", 4)
  ];
  const starterPipeline: Pipeline = {
    id: nanoid(),
    name: "Default Multi-Agent Delivery",
    description: "Analysis -> Planner -> Executor (orchestrator) -> Tester -> Human review",
    createdAt: now,
    updatedAt: now,
    steps: starterSteps,
    links: createLinearLinks(starterSteps),
    runtime: defaultRuntimeConfig(),
    schedule: defaultScheduleConfig(),
    qualityGates: []
  };

  return {
    providers: createDefaultProviders(now),
    pipelines: [starterPipeline],
    runs: [],
    mcpServers: [],
    storage: createDefaultStorageConfig(now)
  };
}

function normalizeStep(
  step: Partial<PipelineStep> & Pick<PipelineStep, "name" | "role" | "prompt">,
  fallbackIndex: number
): PipelineStep {
  const providerId: ProviderId = step.providerId === "claude" ? "claude" : "openai";
  const model = step.model && step.model.length > 0 ? step.model : resolveDefaultModel(providerId);
  const use1MContext = step.use1MContext === true;
  const fallbackPosition = defaultStepPosition(fallbackIndex);
  const defaultContextWindow = resolveDefaultContextWindow(providerId, model);
  let contextWindowTokens =
    typeof step.contextWindowTokens === "number" && step.contextWindowTokens > 0
      ? Math.floor(step.contextWindowTokens)
      : defaultContextWindow;

  if (!use1MContext && providerId === "claude" && contextWindowTokens >= 1_000_000) {
    contextWindowTokens = defaultContextWindow;
  }

  return {
    id: step.id && step.id.length > 0 ? step.id : nanoid(),
    name: step.name,
    role: step.role,
    prompt: step.prompt,
    providerId,
    model,
    reasoningEffort: resolveReasoning(providerId, step.reasoningEffort, model, "medium"),
    fastMode: step.fastMode === true,
    use1MContext,
    contextWindowTokens: use1MContext ? Math.max(contextWindowTokens, 1_000_000) : contextWindowTokens,
    position: {
      x:
        typeof step.position?.x === "number" && Number.isFinite(step.position.x)
          ? Math.round(step.position.x)
          : fallbackPosition.x,
      y:
        typeof step.position?.y === "number" && Number.isFinite(step.position.y)
          ? Math.round(step.position.y)
          : fallbackPosition.y
    },
    contextTemplate:
      step.contextTemplate && step.contextTemplate.length > 0
        ? step.contextTemplate
        : "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}",
    enableDelegation: step.enableDelegation === true,
    delegationCount: typeof step.delegationCount === "number" && step.delegationCount > 0 ? step.delegationCount : 2,
    enableIsolatedStorage: step.enableIsolatedStorage === true,
    enableSharedStorage: step.enableSharedStorage === true,
    enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
      ? step.enabledMcpServerIds
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, 16)
      : [],
    outputFormat: step.outputFormat === "json" ? "json" : "markdown",
    requiredOutputFields: normalizeStringList(step.requiredOutputFields),
    requiredOutputFiles: normalizeStringList(step.requiredOutputFiles)
  };
}

function ensureDbFile(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(createDefaultState(), null, 2), "utf8");
  }
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function isMaskedSecretValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() === MASK_VALUE;
}

function decryptProviderSecrets(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: decryptSecret(provider.apiKey),
    oauthToken: decryptSecret(provider.oauthToken)
  };
}

function encryptProviderSecrets(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: encryptSecret(provider.apiKey),
    oauthToken: encryptSecret(provider.oauthToken)
  };
}

function decryptMcpSecrets(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: decryptSecret(server.env),
    headers: decryptSecret(server.headers)
  };
}

function encryptMcpSecrets(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: encryptSecret(server.env),
    headers: encryptSecret(server.headers)
  };
}

function normalizeRuns(runs: DashboardState["runs"]): DashboardState["runs"] {
  if (!Array.isArray(runs)) {
    return [];
  }

  return runs
    .map((run) => ({
      ...run,
      status: normalizeRunStatus(run.status),
      inputs: typeof run.inputs === "object" && run.inputs !== null ? normalizeRunInputs(run.inputs) : {},
      logs: Array.isArray(run.logs) ? run.logs : [],
      approvals: normalizeRunApprovals((run as { approvals?: unknown }).approvals),
      steps: Array.isArray(run.steps)
        ? run.steps.map((step) => ({
            ...step,
            attempts: typeof step.attempts === "number" ? step.attempts : 0,
            workflowOutcome:
              step.workflowOutcome === "pass" || step.workflowOutcome === "fail" || step.workflowOutcome === "neutral"
                ? step.workflowOutcome
                : "neutral",
            subagentNotes: Array.isArray(step.subagentNotes) ? step.subagentNotes : [],
            qualityGateResults: normalizeStepQualityGateResults(step.qualityGateResults)
          }))
        : []
    }))
    .slice(0, 80);
}

function normalizeMcpServers(servers: DashboardState["mcpServers"]): DashboardState["mcpServers"] {
  if (!Array.isArray(servers)) {
    return [];
  }

  const now = nowIso();
  return servers
    .map((server) => {
      const transport: McpServerConfig["transport"] =
        server.transport === "stdio" || server.transport === "sse" || server.transport === "http" ? server.transport : "http";
      const health: McpServerConfig["health"] =
        server.health === "healthy" || server.health === "degraded" || server.health === "down" || server.health === "unknown"
          ? server.health
          : "unknown";

      return {
        id: typeof server.id === "string" && server.id.trim().length > 0 ? server.id : nanoid(),
        name: typeof server.name === "string" && server.name.trim().length > 0 ? server.name.trim() : "Untitled MCP",
        enabled: server.enabled === true,
        transport,
        command: typeof server.command === "string" ? server.command : "",
        args: typeof server.args === "string" ? server.args : "",
        url: typeof server.url === "string" ? server.url : "",
        env: typeof server.env === "string" ? server.env : "",
        headers: typeof server.headers === "string" ? server.headers : "",
        toolAllowlist: typeof server.toolAllowlist === "string" ? server.toolAllowlist : "",
        health,
        updatedAt: typeof server.updatedAt === "string" && server.updatedAt.length > 0 ? server.updatedAt : now
      };
    })
    .slice(0, 40);
}

function normalizeStorageConfig(raw: DashboardState["storage"] | undefined): StorageConfig {
  const now = nowIso();
  const defaults = createDefaultStorageConfig(now);
  const rootPath =
    raw && typeof raw.rootPath === "string" && raw.rootPath.trim().length > 0 ? raw.rootPath.trim() : defaults.rootPath;
  const sharedFolder =
    raw && typeof raw.sharedFolder === "string" && raw.sharedFolder.trim().length > 0
      ? raw.sharedFolder.trim()
      : defaults.sharedFolder;
  const isolatedFolder =
    raw && typeof raw.isolatedFolder === "string" && raw.isolatedFolder.trim().length > 0
      ? raw.isolatedFolder.trim()
      : defaults.isolatedFolder;
  const runsFolder =
    raw && typeof raw.runsFolder === "string" && raw.runsFolder.trim().length > 0 ? raw.runsFolder.trim() : defaults.runsFolder;

  return {
    enabled: raw?.enabled !== false,
    rootPath,
    sharedFolder,
    isolatedFolder,
    runsFolder,
    updatedAt: typeof raw?.updatedAt === "string" && raw.updatedAt.length > 0 ? raw.updatedAt : now
  };
}

function sanitizeState(raw: DashboardState): DashboardState {
  const now = nowIso();
  const defaults = createDefaultState();
  const providers = createDefaultProviders(now);

  const safeProviders = {
    openai: {
      ...providers.openai,
      ...(raw.providers?.openai ?? defaults.providers.openai)
    },
    claude: {
      ...providers.claude,
      ...(raw.providers?.claude ?? defaults.providers.claude)
    }
  };

  const decryptedProviders = {
    openai: decryptProviderSecrets(safeProviders.openai),
    claude: decryptProviderSecrets(safeProviders.claude)
  };

  const safePipelines =
    Array.isArray(raw.pipelines) && raw.pipelines.length > 0
      ? raw.pipelines.map((pipeline) => {
          const normalizedSteps =
            Array.isArray(pipeline.steps) && pipeline.steps.length > 0
              ? pipeline.steps.map((step, index) => normalizeStep(step, index))
              : [createDefaultStep("analysis", "1. Analysis Bot", "openai", 0)];

          return {
            id: pipeline.id && pipeline.id.length > 0 ? pipeline.id : nanoid(),
            name: pipeline.name || "Untitled Pipeline",
            description: pipeline.description || "",
            createdAt: pipeline.createdAt || now,
            updatedAt: pipeline.updatedAt || now,
            steps: normalizedSteps,
            links: normalizePipelineLinks(pipeline.links, normalizedSteps),
            runtime: normalizeRuntimeConfig(pipeline.runtime),
            schedule: normalizeScheduleConfig(pipeline.schedule),
            qualityGates: normalizeQualityGates(pipeline.qualityGates, normalizedSteps)
          };
        })
      : defaults.pipelines;

  return {
    providers: decryptedProviders,
    pipelines: safePipelines,
    runs: normalizeRuns(raw.runs),
    mcpServers: normalizeMcpServers(raw.mcpServers).map((server) => decryptMcpSecrets(server)),
    storage: normalizeStorageConfig(raw.storage)
  };
}

function serializeStateForDisk(state: DashboardState): DashboardState {
  return {
    ...state,
    providers: {
      openai: encryptProviderSecrets(state.providers.openai),
      claude: encryptProviderSecrets(state.providers.claude)
    },
    mcpServers: state.mcpServers.map((server) => encryptMcpSecrets(server))
  };
}

export class LocalStore {
  private state: DashboardState;

  constructor(private readonly dbPath: string = DB_PATH) {
    ensureDbFile();
    this.state = this.load();
  }

  private load(): DashboardState {
    const raw = fs.readFileSync(this.dbPath, "utf8");
    const parsed = JSON.parse(raw) as DashboardState;
    return sanitizeState(parsed);
  }

  private persist(): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(serializeStateForDisk(this.state), null, 2), "utf8");
  }

  getState(): DashboardState {
    return deepClone(this.state);
  }

  getProviders(): Record<ProviderId, ProviderConfig> {
    return deepClone(this.state.providers);
  }

  listPipelines(): Pipeline[] {
    return deepClone(this.state.pipelines);
  }

  getPipeline(id: string): Pipeline | undefined {
    const pipeline = this.state.pipelines.find((entry) => entry.id === id);
    return pipeline ? deepClone(pipeline) : undefined;
  }

  createPipeline(input: PipelineInput): Pipeline {
    const now = nowIso();
    const steps = input.steps.map((step, index) => normalizeStep(step, index));
    const pipeline: Pipeline = {
      id: nanoid(),
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      steps,
      links: normalizePipelineLinks(input.links, steps),
      runtime: normalizeRuntimeConfig(input.runtime),
      schedule: normalizeScheduleConfig(input.schedule),
      qualityGates: normalizeQualityGates(input.qualityGates, steps)
    };

    this.state.pipelines.unshift(pipeline);
    this.persist();
    return deepClone(pipeline);
  }

  updatePipeline(id: string, input: PipelineInput): Pipeline | undefined {
    const index = this.state.pipelines.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return undefined;
    }

    const existing = this.state.pipelines[index];
    const steps = input.steps.map((step, stepIndex) => normalizeStep(step, stepIndex));
    const updated: Pipeline = {
      ...existing,
      name: input.name,
      description: input.description,
      updatedAt: nowIso(),
      steps,
      links: normalizePipelineLinks(input.links, steps),
      runtime: normalizeRuntimeConfig(input.runtime),
      schedule: normalizeScheduleConfig(input.schedule),
      qualityGates: normalizeQualityGates(input.qualityGates, steps)
    };

    this.state.pipelines[index] = updated;
    this.persist();
    return deepClone(updated);
  }

  deletePipeline(id: string): boolean {
    const previousCount = this.state.pipelines.length;
    this.state.pipelines = this.state.pipelines.filter((entry) => entry.id !== id);

    if (this.state.pipelines.length === previousCount) {
      return false;
    }

    this.persist();
    return true;
  }

  upsertProvider(providerId: ProviderId, input: ProviderUpdateInput): ProviderConfig {
    const current = this.state.providers[providerId];
    const updated: ProviderConfig = {
      ...current,
      authMode: input.authMode ?? current.authMode,
      apiKey: input.apiKey === undefined || isMaskedSecretValue(input.apiKey) ? current.apiKey : input.apiKey,
      oauthToken:
        input.oauthToken === undefined || isMaskedSecretValue(input.oauthToken) ? current.oauthToken : input.oauthToken,
      baseUrl: input.baseUrl ?? current.baseUrl,
      defaultModel: input.defaultModel ?? current.defaultModel,
      updatedAt: nowIso()
    };

    this.state.providers[providerId] = updated;
    this.persist();
    return deepClone(updated);
  }

  listMcpServers(): McpServerConfig[] {
    return deepClone(this.state.mcpServers);
  }

  createMcpServer(input: McpServerInput): McpServerConfig {
    const now = nowIso();
    const server: McpServerConfig = {
      id: nanoid(),
      name: input.name.trim(),
      enabled: input.enabled === true,
      transport: input.transport ?? "http",
      command: input.command ?? "",
      args: input.args ?? "",
      url: input.url ?? "",
      env: input.env ?? "",
      headers: input.headers ?? "",
      toolAllowlist: input.toolAllowlist ?? "",
      health: input.health ?? "unknown",
      updatedAt: now
    };

    this.state.mcpServers.unshift(server);
    this.state.mcpServers = this.state.mcpServers.slice(0, 40);
    this.persist();
    return deepClone(server);
  }

  updateMcpServer(id: string, input: Partial<McpServerInput>): McpServerConfig | undefined {
    const index = this.state.mcpServers.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return undefined;
    }

    const current = this.state.mcpServers[index];
    const updated: McpServerConfig = {
      ...current,
      name: typeof input.name === "string" && input.name.trim().length > 0 ? input.name.trim() : current.name,
      enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
      transport: input.transport ?? current.transport,
      command: typeof input.command === "string" ? input.command : current.command,
      args: typeof input.args === "string" ? input.args : current.args,
      url: typeof input.url === "string" ? input.url : current.url,
      env: typeof input.env === "string" ? (isMaskedSecretValue(input.env) ? current.env : input.env) : current.env,
      headers:
        typeof input.headers === "string"
          ? isMaskedSecretValue(input.headers)
            ? current.headers
            : input.headers
          : current.headers,
      toolAllowlist: typeof input.toolAllowlist === "string" ? input.toolAllowlist : current.toolAllowlist,
      health: input.health ?? current.health,
      updatedAt: nowIso()
    };

    this.state.mcpServers[index] = updated;
    this.persist();
    return deepClone(updated);
  }

  deleteMcpServer(id: string): boolean {
    const previousCount = this.state.mcpServers.length;
    this.state.mcpServers = this.state.mcpServers.filter((entry) => entry.id !== id);
    if (this.state.mcpServers.length === previousCount) {
      return false;
    }

    this.persist();
    return true;
  }

  updateStorageConfig(input: StorageUpdateInput): StorageConfig {
    const current = this.state.storage;
    const updated: StorageConfig = {
      ...current,
      enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
      rootPath: typeof input.rootPath === "string" && input.rootPath.trim().length > 0 ? input.rootPath.trim() : current.rootPath,
      sharedFolder:
        typeof input.sharedFolder === "string" && input.sharedFolder.trim().length > 0
          ? input.sharedFolder.trim()
          : current.sharedFolder,
      isolatedFolder:
        typeof input.isolatedFolder === "string" && input.isolatedFolder.trim().length > 0
          ? input.isolatedFolder.trim()
          : current.isolatedFolder,
      runsFolder:
        typeof input.runsFolder === "string" && input.runsFolder.trim().length > 0 ? input.runsFolder.trim() : current.runsFolder,
      updatedAt: nowIso()
    };

    this.state.storage = updated;
    this.persist();
    return deepClone(updated);
  }

  createRun(pipeline: Pipeline, task: string, rawInputs?: RunInputs): PipelineRun {
    const orderedSteps = orderPipelineSteps(pipeline.steps, pipeline.links);
    const inputs = normalizeRunInputs(rawInputs);
    const run: PipelineRun = {
      id: nanoid(),
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      task,
      inputs,
      status: "queued",
      startedAt: nowIso(),
      logs: ["Run queued"],
      approvals: [],
      steps: orderedSteps.map<StepRun>((step) => ({
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
      }))
    };

    this.state.runs.unshift(run);
    this.state.runs = this.state.runs.slice(0, 80);
    this.persist();
    return deepClone(run);
  }

  getRun(runId: string): PipelineRun | undefined {
    const run = this.state.runs.find((entry) => entry.id === runId);
    return run ? deepClone(run) : undefined;
  }

  updateRun(runId: string, updater: (run: PipelineRun) => PipelineRun): PipelineRun | undefined {
    const index = this.state.runs.findIndex((entry) => entry.id === runId);
    if (index === -1) {
      return undefined;
    }

    this.state.runs[index] = updater(this.state.runs[index]);
    this.persist();
    return deepClone(this.state.runs[index]);
  }

  listRuns(limit = 30): PipelineRun[] {
    return deepClone(this.state.runs.slice(0, limit));
  }
}
