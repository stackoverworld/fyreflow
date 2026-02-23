import type { Page, Route } from "@playwright/test";
import type {
  DashboardState,
  Pipeline,
  PipelinePayload,
  PipelineRun,
  ProviderId,
  ProviderOAuthStatus,
  SmartRunPlan
} from "../../../src/lib/types";

interface MockDashboardApiOptions {
  aiGeneratedFlowName?: string;
  defaultStepIsolatedStorage?: boolean;
  defaultStepSharedStorage?: boolean;
}

interface MockDashboardApiContext {
  state: DashboardState;
}

const BASE_TIME = Date.parse("2026-02-21T12:00:00.000Z");

function isoAt(offsetMs: number): string {
  return new Date(BASE_TIME + offsetMs).toISOString();
}

function createDefaultStep(
  stepId = "step-1",
  name = "1. Analysis Bot",
  options: Pick<MockDashboardApiOptions, "defaultStepIsolatedStorage" | "defaultStepSharedStorage"> = {}
): Pipeline["steps"][number] {
  const enableIsolatedStorage = options.defaultStepIsolatedStorage === true;
  const enableSharedStorage = options.defaultStepSharedStorage === true;
  return {
    id: stepId,
    name,
    role: "analysis",
    prompt: "Analyze the request and define constraints before planning.",
    providerId: "openai",
    model: "gpt-5.3-codex",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 272000,
    position: { x: 80, y: 130 },
    contextTemplate: "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}",
    enableDelegation: false,
    delegationCount: 2,
    enableIsolatedStorage,
    enableSharedStorage,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: []
  };
}

function createDefaultPipeline(
  options: Pick<MockDashboardApiOptions, "defaultStepIsolatedStorage" | "defaultStepSharedStorage"> = {}
): Pipeline {
  const step = createDefaultStep("step-1", "1. Analysis Bot", options);
  return {
    id: "pipeline-default",
    name: "Default Multi-Agent Delivery",
    description: "Baseline flow for e2e regression checks.",
    createdAt: isoAt(0),
    updatedAt: isoAt(0),
    steps: [step],
    links: [],
    runtime: {
      maxLoops: 2,
      maxStepExecutions: 18,
      stageTimeoutMs: 420000
    },
    schedule: {
      enabled: false,
      cron: "",
      timezone: "UTC",
      task: "",
      runMode: "smart",
      inputs: {}
    },
    qualityGates: []
  };
}

function createInitialState(
  options: Pick<MockDashboardApiOptions, "defaultStepIsolatedStorage" | "defaultStepSharedStorage"> = {}
): DashboardState {
  return {
    providers: {
      openai: {
        id: "openai",
        label: "OpenAI / Codex",
        authMode: "api_key",
        apiKey: "",
        oauthToken: "",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-5.3-codex",
        updatedAt: isoAt(0)
      },
      claude: {
        id: "claude",
        label: "Anthropic",
        authMode: "api_key",
        apiKey: "",
        oauthToken: "",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: "claude-opus-4-6",
        updatedAt: isoAt(0)
      }
    },
    pipelines: [createDefaultPipeline(options)],
    runs: [],
    mcpServers: [],
    storage: {
      enabled: true,
      rootPath: "/tmp/fyreflow-e2e",
      sharedFolder: "shared",
      isolatedFolder: "isolated",
      runsFolder: "runs",
      updatedAt: isoAt(0)
    }
  };
}

function createInitialOAuthStatus(providerId: ProviderId): ProviderOAuthStatus {
  return {
    providerId,
    loginSource: "mock",
    cliCommand: providerId === "openai" ? "codex login --device-auth" : "claude auth login",
    cliAvailable: true,
    loggedIn: false,
    tokenAvailable: false,
    canUseApi: false,
    canUseCli: true,
    message: "Mock status: not connected.",
    checkedAt: isoAt(0),
    runtimeProbe: {
      status: "fail",
      message: "Mock runtime probe: connect provider first.",
      checkedAt: isoAt(0),
      latencyMs: 0
    }
  };
}

function toPipelinePayload(pipeline: Pipeline): PipelinePayload {
  return {
    name: pipeline.name,
    description: pipeline.description,
    steps: pipeline.steps.map((step) => ({
      ...step
    })),
    links: pipeline.links.map((link) => ({
      id: link.id,
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition
    })),
    qualityGates: pipeline.qualityGates.map((gate) => ({
      ...gate
    })),
    runtime: {
      ...pipeline.runtime
    },
    schedule: {
      ...pipeline.schedule
    }
  };
}

function buildPipelineFromPayload(
  payload: PipelinePayload,
  id: string,
  createdAt: string,
  updatedAt: string
): Pipeline {
  return {
    id,
    name: payload.name,
    description: payload.description,
    createdAt,
    updatedAt,
    steps: payload.steps.map((step, index) => ({
      ...step,
      id: step.id && step.id.length > 0 ? step.id : `step-${id}-${index + 1}`
    })),
    links: payload.links.map((link, index) => ({
      id: link.id && link.id.length > 0 ? link.id : `link-${id}-${index + 1}`,
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition ?? "always"
    })),
    runtime: {
      maxLoops: payload.runtime?.maxLoops ?? 2,
      maxStepExecutions: payload.runtime?.maxStepExecutions ?? 18,
      stageTimeoutMs: payload.runtime?.stageTimeoutMs ?? 420000
    },
    schedule: {
      enabled: payload.schedule?.enabled === true,
      cron: payload.schedule?.cron ?? "",
      timezone: payload.schedule?.timezone ?? "UTC",
      task: payload.schedule?.task ?? "",
      runMode: payload.schedule?.runMode ?? "smart",
      inputs: payload.schedule?.inputs ?? {}
    },
    qualityGates: payload.qualityGates.map((gate, index) => ({
      id: gate.id && gate.id.length > 0 ? gate.id : `gate-${id}-${index + 1}`,
      name: gate.name,
      targetStepId: gate.targetStepId,
      kind: gate.kind,
      blocking: gate.blocking,
      pattern: gate.pattern ?? "",
      flags: gate.flags ?? "",
      jsonPath: gate.jsonPath ?? "",
      artifactPath: gate.artifactPath ?? "",
      message: gate.message ?? ""
    }))
  };
}

function createStepRuns(pipeline: Pipeline): PipelineRun["steps"] {
  return pipeline.steps.map((step) => ({
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

async function fulfillJson(route: Route, status: number, payload: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

function parseRequestBody(route: Route): Record<string, unknown> {
  const raw = route.request().postData();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function mockDashboardApi(
  page: Page,
  options: MockDashboardApiOptions = {}
): Promise<MockDashboardApiContext> {
  const state = createInitialState(options);
  let pipelineCounter = 1;
  let runCounter = 0;
  const oauthByProvider: Record<ProviderId, ProviderOAuthStatus> = {
    openai: createInitialOAuthStatus("openai"),
    claude: createInitialOAuthStatus("claude")
  };

  const smartRunPlan: SmartRunPlan = {
    fields: [],
    checks: [
      {
        id: "provider-openai",
        title: "OpenAI provider configured",
        status: "pass",
        message: "Provider credentials are available."
      },
      {
        id: "storage-root",
        title: "Storage configured",
        status: "pass",
        message: "Run storage root path is writable."
      }
    ],
    canRun: true
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method().toUpperCase();
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/health") {
      await fulfillJson(route, 200, { ok: true, now: isoAt(5) });
      return;
    }

    if (method === "GET" && pathname === "/api/state") {
      await fulfillJson(route, 200, state);
      return;
    }

    if (method === "GET" && pathname === "/api/model-catalog") {
      await fulfillJson(route, 200, {
        modelCatalog: {
          openai: [{ id: "gpt-5.3-codex", label: "GPT-5.3 Codex" }],
          claude: [{ id: "claude-opus-4-6", label: "Claude Opus 4.6" }]
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/api/runs") {
      const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "30", 10);
      const limit = Number.isNaN(limitRaw) ? 30 : Math.max(1, limitRaw);
      await fulfillJson(route, 200, { runs: state.runs.slice(0, limit) });
      return;
    }

    if (method === "POST" && pathname === "/api/pipelines") {
      const body = parseRequestBody(route);
      const payload = body as unknown as PipelinePayload;
      pipelineCounter += 1;
      const id = `pipeline-${pipelineCounter}`;
      const now = isoAt(1000 * pipelineCounter);
      const pipeline = buildPipelineFromPayload(payload, id, now, now);
      state.pipelines.unshift(pipeline);
      await fulfillJson(route, 201, { pipeline });
      return;
    }

    if (method === "GET" && pathname === "/api/pipelines") {
      await fulfillJson(route, 200, { pipelines: state.pipelines });
      return;
    }

    const pipelineMatch = pathname.match(/^\/api\/pipelines\/([^/]+)$/);
    if (pipelineMatch) {
      const pipelineId = decodeURIComponent(pipelineMatch[1]);
      const index = state.pipelines.findIndex((entry) => entry.id === pipelineId);

      if (method === "PUT") {
        if (index === -1) {
          await fulfillJson(route, 404, { error: "Pipeline not found" });
          return;
        }

        const body = parseRequestBody(route);
        const payload = body as unknown as PipelinePayload;
        const existing = state.pipelines[index];
        const updated = buildPipelineFromPayload(payload, existing.id, existing.createdAt, isoAt(Date.now() - BASE_TIME));
        state.pipelines[index] = updated;
        await fulfillJson(route, 200, { pipeline: updated });
        return;
      }

      if (method === "DELETE") {
        if (index === -1) {
          await fulfillJson(route, 404, { error: "Pipeline not found" });
          return;
        }

        state.pipelines.splice(index, 1);
        state.runs = state.runs.filter((run) => run.pipelineId !== pipelineId);
        await route.fulfill({ status: 204, body: "" });
        return;
      }
    }

    const pipelineSmartPlanMatch = pathname.match(/^\/api\/pipelines\/([^/]+)\/smart-run-plan$/);
    if (pipelineSmartPlanMatch && method === "POST") {
      await fulfillJson(route, 200, { plan: smartRunPlan });
      return;
    }

    const pipelineStartupMatch = pathname.match(/^\/api\/pipelines\/([^/]+)\/startup-check$/);
    if (pipelineStartupMatch && method === "POST") {
      await fulfillJson(route, 200, {
        check: {
          status: "pass",
          summary: "Mock startup check passed.",
          requests: [],
          blockers: [],
          source: "deterministic",
          notes: []
        }
      });
      return;
    }

    const pipelineRunMatch = pathname.match(/^\/api\/pipelines\/([^/]+)\/runs$/);
    if (pipelineRunMatch && method === "POST") {
      const pipelineId = decodeURIComponent(pipelineRunMatch[1]);
      const pipeline = state.pipelines.find((entry) => entry.id === pipelineId);
      if (!pipeline) {
        await fulfillJson(route, 404, { error: "Pipeline not found" });
        return;
      }

      const body = parseRequestBody(route);
      const taskRaw = typeof body.task === "string" ? body.task : "";
      const task = taskRaw.trim().length > 0 ? taskRaw.trim() : `Run flow "${pipeline.name}"`;
      const inputs =
        typeof body.inputs === "object" && body.inputs !== null ? (body.inputs as Record<string, string>) : {};

      runCounter += 1;
      const runId = `run-${runCounter}`;
      const run: PipelineRun = {
        id: runId,
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        task,
        inputs,
        status: "queued",
        startedAt: isoAt(5000 + runCounter * 1000),
        logs: ["Run queued"],
        approvals: [],
        steps: createStepRuns(pipeline)
      };
      state.runs.unshift(run);
      state.runs = state.runs.slice(0, 40);
      await fulfillJson(route, 202, { run });
      return;
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch && method === "GET") {
      const runId = decodeURIComponent(runMatch[1]);
      const run = state.runs.find((entry) => entry.id === runId);
      if (!run) {
        await fulfillJson(route, 404, { error: "Run not found" });
        return;
      }
      await fulfillJson(route, 200, { run });
      return;
    }

    const runStopMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
    if (runStopMatch && method === "POST") {
      const runId = decodeURIComponent(runStopMatch[1]);
      const run = state.runs.find((entry) => entry.id === runId);
      if (!run) {
        await fulfillJson(route, 404, { error: "Run not found" });
        return;
      }
      run.status = "cancelled";
      run.finishedAt = isoAt(9000 + runCounter * 1000);
      run.logs.push("Run cancelled from mock API.");
      await fulfillJson(route, 200, { run });
      return;
    }

    const runPauseMatch = pathname.match(/^\/api\/runs\/([^/]+)\/pause$/);
    if (runPauseMatch && method === "POST") {
      const runId = decodeURIComponent(runPauseMatch[1]);
      const run = state.runs.find((entry) => entry.id === runId);
      if (!run) {
        await fulfillJson(route, 404, { error: "Run not found" });
        return;
      }
      run.status = "paused";
      run.logs.push("Run paused from mock API.");
      await fulfillJson(route, 200, { run });
      return;
    }

    const runResumeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
    if (runResumeMatch && method === "POST") {
      const runId = decodeURIComponent(runResumeMatch[1]);
      const run = state.runs.find((entry) => entry.id === runId);
      if (!run) {
        await fulfillJson(route, 404, { error: "Run not found" });
        return;
      }
      run.status = "running";
      run.logs.push("Run resumed from mock API.");
      await fulfillJson(route, 200, { run });
      return;
    }

    const providerMatch = pathname.match(/^\/api\/providers\/(openai|claude)$/);
    if (providerMatch && method === "PUT") {
      const providerId = providerMatch[1] as ProviderId;
      const patch = parseRequestBody(route);
      const nextProvider = {
        ...state.providers[providerId],
        ...patch,
        updatedAt: isoAt(Date.now() - BASE_TIME)
      };
      state.providers[providerId] = nextProvider;
      await fulfillJson(route, 200, { provider: nextProvider });
      return;
    }

    const providerStatusMatch = pathname.match(/^\/api\/providers\/(openai|claude)\/oauth\/status$/);
    if (providerStatusMatch && method === "GET") {
      const providerId = providerStatusMatch[1] as ProviderId;
      await fulfillJson(route, 200, { status: oauthByProvider[providerId] });
      return;
    }

    const providerStartMatch = pathname.match(/^\/api\/providers\/(openai|claude)\/oauth\/start$/);
    if (providerStartMatch && method === "POST") {
      const providerId = providerStartMatch[1] as ProviderId;
      oauthByProvider[providerId] = {
        ...oauthByProvider[providerId],
        loggedIn: true,
        canUseApi: providerId === "openai",
        canUseCli: true,
        message: "Mock OAuth connected.",
        checkedAt: isoAt(Date.now() - BASE_TIME)
      };
      await fulfillJson(route, 202, {
        result: { message: "Mock OAuth browser flow started.", command: oauthByProvider[providerId].cliCommand },
        status: oauthByProvider[providerId]
      });
      return;
    }

    const providerSyncMatch = pathname.match(/^\/api\/providers\/(openai|claude)\/oauth\/sync-token$/);
    if (providerSyncMatch && method === "POST") {
      const providerId = providerSyncMatch[1] as ProviderId;
      oauthByProvider[providerId] = {
        ...oauthByProvider[providerId],
        loggedIn: true,
        tokenAvailable: true,
        canUseApi: true,
        message: "Mock OAuth token synced.",
        checkedAt: isoAt(Date.now() - BASE_TIME),
        runtimeProbe: {
          status: "pass",
          message: "Mock runtime probe passed.",
          checkedAt: isoAt(Date.now() - BASE_TIME),
          latencyMs: 42
        }
      };
      const provider = {
        ...state.providers[providerId],
        authMode: "oauth",
        oauthToken: "[secure]",
        updatedAt: isoAt(Date.now() - BASE_TIME)
      };
      state.providers[providerId] = provider;
      await fulfillJson(route, 200, {
        provider,
        result: {
          message: "Mock OAuth token imported.",
          oauthToken: "[secure]",
          status: oauthByProvider[providerId]
        }
      });
      return;
    }

    if (method === "POST" && pathname === "/api/flow-builder/generate") {
      const body = parseRequestBody(route);
      const currentDraft = body.currentDraft as PipelinePayload | undefined;
      const baseDraft = currentDraft ?? toPipelinePayload(state.pipelines[0]);
      const nextDraft: PipelinePayload = {
        ...baseDraft,
        name: options.aiGeneratedFlowName ?? "AI Generated Regression Flow"
      };
      await fulfillJson(route, 200, {
        action: "update_current_flow",
        message: "Updated the flow with deterministic AI regression coverage.",
        draft: nextDraft,
        source: "fallback",
        notes: ["mock-flow-builder-response"]
      });
      return;
    }

    await fulfillJson(route, 404, { error: `Unhandled mock route: ${method} ${pathname}` });
  });

  return { state };
}
