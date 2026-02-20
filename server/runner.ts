import fs from "node:fs/promises";
import path from "node:path";
import type { LocalStore } from "./storage.js";
import type {
  PipelineQualityGate,
  McpServerConfig,
  Pipeline,
  PipelineLink,
  PipelineStep,
  PipelineRun,
  ProviderConfig,
  ProviderId,
  StepQualityGateResult,
  StorageConfig,
  StepRun,
  WorkflowOutcome
} from "./types.js";
import { orderPipelineSteps } from "./pipelineGraph.js";
import { executeProviderStep } from "./providers.js";
import { executeMcpToolCall, type McpToolCall, type McpToolResult } from "./mcp.js";
import { formatRunInputsSummary, normalizeRunInputs, replaceInputTokens, type RunInputs } from "./runInputs.js";
import { createAbortError, isAbortError, mergeAbortSignals } from "./abort.js";

interface RunPipelineInput {
  store: LocalStore;
  runId: string;
  pipeline: Pipeline;
  task: string;
  runInputs?: RunInputs;
  abortSignal?: AbortSignal;
}

interface RuntimeConfig {
  maxLoops: number;
  maxStepExecutions: number;
  stageTimeoutMs: number;
}

interface TimelineEntry {
  stepId: string;
  stepName: string;
  output: string;
}

interface StepStoragePaths {
  sharedStoragePath: string;
  isolatedStoragePath: string;
  runStoragePath: string;
}

const DEFAULT_MAX_LOOPS = 2;
const DEFAULT_MAX_STEP_EXECUTIONS = 18;
const DEFAULT_STAGE_TIMEOUT_MS = 240000;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRuntime(pipeline: Pipeline): RuntimeConfig {
  return {
    maxLoops:
      typeof pipeline.runtime?.maxLoops === "number"
        ? Math.max(0, Math.min(12, Math.floor(pipeline.runtime.maxLoops)))
        : DEFAULT_MAX_LOOPS,
    maxStepExecutions:
      typeof pipeline.runtime?.maxStepExecutions === "number"
        ? Math.max(4, Math.min(120, Math.floor(pipeline.runtime.maxStepExecutions)))
        : DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs:
      typeof pipeline.runtime?.stageTimeoutMs === "number"
        ? Math.max(10_000, Math.min(1_200_000, Math.floor(pipeline.runtime.stageTimeoutMs)))
        : DEFAULT_STAGE_TIMEOUT_MS
  };
}

function clampContextToWindow(context: string, contextWindowTokens: number): string {
  const safeTokens = Math.max(16_000, Math.min(1_000_000, Math.floor(contextWindowTokens || 272_000)));
  const characterBudget = safeTokens * 4;

  if (context.length <= characterBudget) {
    return context;
  }

  const lead = Math.floor(characterBudget * 0.55);
  const trail = Math.floor(characterBudget * 0.4);
  const head = context.slice(0, lead);
  const tail = context.slice(context.length - trail);

  return `${head}\n\n[Context trimmed for configured window: ${safeTokens.toLocaleString()} tokens]\n\n${tail}`;
}

function inferWorkflowOutcome(output: string): WorkflowOutcome {
  const explicit = output.match(/WORKFLOW_STATUS\s*:\s*(PASS|FAIL|NEUTRAL)/i)?.[1]?.toLowerCase();
  if (explicit === "pass" || explicit === "fail" || explicit === "neutral") {
    return explicit;
  }

  const jsonBlocks = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of jsonBlocks) {
    const payload = block[1]?.trim();
    if (!payload) {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as { status?: unknown };
      if (typeof parsed.status === "string") {
        const status = parsed.status.toLowerCase();
        if (status === "pass" || status === "fail" || status === "neutral") {
          return status;
        }
      }
    } catch {
      // Ignore malformed JSON blocks.
    }
  }

  const failPattern = /\b(fail|failed|rejected|needs?\s+remediation|issues?\s+found|does not pass)\b/i;
  if (failPattern.test(output)) {
    return "fail";
  }

  const passPattern = /\b(pass|passed|approved|looks good|ready to ship|no blocking issues)\b/i;
  if (passPattern.test(output)) {
    return "pass";
  }

  return "neutral";
}

function routeMatchesCondition(condition: PipelineLink["condition"], outcome: WorkflowOutcome): boolean {
  if (condition === "on_pass") {
    return outcome === "pass";
  }

  if (condition === "on_fail") {
    return outcome === "fail";
  }

  return true;
}

function safeStorageSegment(value: string): string {
  const trimmed = value.trim();
  const fallback = trimmed.length > 0 ? trimmed : "default";
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function resolveStepStoragePaths(
  step: PipelineStep,
  pipelineId: string,
  runId: string,
  storage: StorageConfig
): StepStoragePaths {
  const storageRoot = storage.rootPath;
  const sharedRoot = path.join(storageRoot, storage.sharedFolder, safeStorageSegment(pipelineId));
  const isolatedRoot = path.join(
    storageRoot,
    storage.isolatedFolder,
    safeStorageSegment(pipelineId),
    safeStorageSegment(step.id)
  );
  const runRoot = path.join(
    storageRoot,
    storage.runsFolder,
    safeStorageSegment(runId),
    safeStorageSegment(step.id)
  );

  return {
    sharedStoragePath: step.enableSharedStorage && storage.enabled ? sharedRoot : "DISABLED",
    isolatedStoragePath: step.enableIsolatedStorage && storage.enabled ? isolatedRoot : "DISABLED",
    runStoragePath: runRoot
  };
}

async function ensureStepStorage(paths: StepStoragePaths): Promise<void> {
  await fs.mkdir(paths.runStoragePath, { recursive: true });

  if (paths.sharedStoragePath !== "DISABLED") {
    await fs.mkdir(paths.sharedStoragePath, { recursive: true });
  }

  if (paths.isolatedStoragePath !== "DISABLED") {
    await fs.mkdir(paths.isolatedStoragePath, { recursive: true });
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseMcpCallsFromOutput(output: string): McpToolCall[] {
  const candidates = new Set<string>();
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fenced = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of fenced) {
    const content = block[1]?.trim();
    if (content) {
      candidates.add(content);
    }
  }

  const object = extractFirstJsonObject(output);
  if (object) {
    candidates.add(object);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        continue;
      }

      const payload = parsed as {
        mcp_calls?: unknown;
        mcpCalls?: unknown;
        tool_calls?: unknown;
      };
      const calls = Array.isArray(payload.mcp_calls)
        ? payload.mcp_calls
        : Array.isArray(payload.mcpCalls)
          ? payload.mcpCalls
          : Array.isArray(payload.tool_calls)
            ? payload.tool_calls
            : null;

      if (!calls) {
        continue;
      }

      const normalized: McpToolCall[] = [];
      for (const call of calls) {
        if (typeof call !== "object" || call === null) {
          continue;
        }

        const record = call as {
          server_id?: unknown;
          serverId?: unknown;
          server?: unknown;
          tool?: unknown;
          name?: unknown;
          arguments?: unknown;
          args?: unknown;
        };

        const serverIdRaw = record.server_id ?? record.serverId ?? record.server;
        const toolRaw = record.tool ?? record.name;
        const argsRaw = record.arguments ?? record.args;

        if (typeof serverIdRaw !== "string" || typeof toolRaw !== "string") {
          continue;
        }

        normalized.push({
          serverId: serverIdRaw.trim(),
          tool: toolRaw.trim(),
          arguments:
            typeof argsRaw === "object" && argsRaw !== null && !Array.isArray(argsRaw)
              ? (argsRaw as Record<string, unknown>)
              : {}
        });
      }

      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      // Continue trying other candidates.
    }
  }

  return [];
}

function formatMcpToolResults(results: McpToolResult[]): string {
  return JSON.stringify(
    {
      mcp_results: results.map((result) => ({
        server_id: result.serverId,
        tool: result.tool,
        ok: result.ok,
        output: result.output,
        error: result.error
      }))
    },
    null,
    2
  );
}

function parseJsonOutput(output: string): Record<string, unknown> | null {
  const candidates = new Set<string>();
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fenced = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of fenced) {
    const content = block[1]?.trim();
    if (content) {
      candidates.add(content);
    }
  }

  const firstObject = extractFirstJsonObject(output);
  if (firstObject) {
    candidates.add(firstObject);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Keep trying.
    }
  }

  return null;
}

function resolvePathValue(payload: unknown, rawPath: string): { found: boolean; value: unknown } {
  if (!rawPath || rawPath.trim().length === 0) {
    return { found: false, value: undefined };
  }

  const normalizedPath = rawPath.trim().replace(/^\$?\./, "");
  if (normalizedPath.length === 0) {
    return { found: true, value: payload };
  }

  const segments = normalizedPath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let current: unknown = payload;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return { found: false, value: undefined };
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }

    if (!(segment in current)) {
      return { found: false, value: undefined };
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return { found: true, value: current };
}

function applyStoragePathTokens(template: string, storagePaths: StepStoragePaths, runInputs: RunInputs): string {
  const rendered = replaceInputTokens(template, runInputs)
    .replace(/\{\{shared_storage_path\}\}/g, storagePaths.sharedStoragePath)
    .replace(/\{\{isolated_storage_path\}\}/g, storagePaths.isolatedStoragePath)
    .replace(/\{\{run_storage_path\}\}/g, storagePaths.runStoragePath)
    .trim();

  if (rendered.length === 0) {
    return rendered;
  }

  if (path.isAbsolute(rendered)) {
    return rendered;
  }

  return path.resolve(storagePaths.runStoragePath, rendered);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRegexFlags(rawFlags: string): string {
  const allowed = new Set(["g", "i", "m", "s", "u", "y"]);
  const deduped: string[] = [];
  for (const flag of rawFlags) {
    if (!allowed.has(flag) || deduped.includes(flag)) {
      continue;
    }
    deduped.push(flag);
  }
  return deduped.join("");
}

interface StepContractEvaluationResult {
  parsedJson: Record<string, unknown> | null;
  gateResults: StepQualityGateResult[];
}

async function evaluateStepContracts(
  step: PipelineStep,
  output: string,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepContractEvaluationResult> {
  const gateResults: StepQualityGateResult[] = [];
  let parsedJson: Record<string, unknown> | null = null;

  if (step.outputFormat === "json") {
    parsedJson = parseJsonOutput(output);
    const jsonValid = parsedJson !== null;

    gateResults.push({
      gateId: `contract-json-format-${step.id}`,
      gateName: "Step output must be valid JSON",
      kind: "step_contract",
      status: jsonValid ? "pass" : "fail",
      blocking: true,
      message: jsonValid
        ? "Step produced valid JSON output."
        : "Step is configured for JSON output but the output is not valid JSON.",
      details: jsonValid ? "JSON parser check passed." : output.slice(0, 400)
    });
  }

  if (step.requiredOutputFields.length > 0) {
    const payload = parsedJson ?? parseJsonOutput(output);
    parsedJson = payload;

    if (!payload) {
      for (const fieldPath of step.requiredOutputFields) {
        gateResults.push({
          gateId: `contract-json-field-${step.id}-${fieldPath}`,
          gateName: `Required field: ${fieldPath}`,
          kind: "step_contract",
          status: "fail",
          blocking: true,
          message: `Cannot verify required field "${fieldPath}" because output is not valid JSON.`,
          details: "Step output JSON parse failed."
        });
      }
    } else {
      for (const fieldPath of step.requiredOutputFields) {
        const value = resolvePathValue(payload, fieldPath);
        gateResults.push({
          gateId: `contract-json-field-${step.id}-${fieldPath}`,
          gateName: `Required field: ${fieldPath}`,
          kind: "step_contract",
          status: value.found ? "pass" : "fail",
          blocking: true,
          message: value.found
            ? `Required field "${fieldPath}" is present.`
            : `Required field "${fieldPath}" is missing from output JSON.`,
          details: value.found ? `Value: ${JSON.stringify(value.value).slice(0, 260)}` : "Path lookup failed."
        });
      }
    }
  }

  for (const fileTemplate of step.requiredOutputFiles) {
    const resolvedPath = applyStoragePathTokens(fileTemplate, storagePaths, runInputs);
    const disabledStorage =
      resolvedPath.includes("DISABLED") ||
      (fileTemplate.includes("{{shared_storage_path}}") && storagePaths.sharedStoragePath === "DISABLED") ||
      (fileTemplate.includes("{{isolated_storage_path}}") && storagePaths.isolatedStoragePath === "DISABLED");

    let exists = false;
    if (!disabledStorage && resolvedPath.length > 0) {
      exists = await pathExists(resolvedPath);
    }

    gateResults.push({
      gateId: `contract-artifact-${step.id}-${fileTemplate}`,
      gateName: `Required artifact: ${fileTemplate}`,
      kind: "step_contract",
      status: exists ? "pass" : "fail",
      blocking: true,
      message: exists
        ? `Required artifact exists: ${resolvedPath}`
        : `Required artifact is missing: ${fileTemplate}`,
      details: disabledStorage
        ? "Storage mode required by this artifact path is disabled for this step."
        : resolvedPath
    });
  }

  return { parsedJson, gateResults };
}

async function evaluatePipelineQualityGates(
  step: PipelineStep,
  output: string,
  parsedJson: Record<string, unknown> | null,
  qualityGates: PipelineQualityGate[],
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult[]> {
  const relevant = qualityGates.filter(
    (gate) => gate.targetStepId === "any_step" || gate.targetStepId === step.id
  );

  if (relevant.length === 0) {
    return [];
  }

  let cachedJson = parsedJson;
  const results: StepQualityGateResult[] = [];

  for (const gate of relevant) {
    if (gate.kind === "regex_must_match" || gate.kind === "regex_must_not_match") {
      if (!gate.pattern || gate.pattern.trim().length === 0) {
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `Regex gate "${gate.name}" has empty pattern.`,
          details: "Define a regex pattern for this gate."
        });
        continue;
      }

      try {
        const regex = new RegExp(gate.pattern, normalizeRegexFlags(gate.flags));
        const matched = regex.test(output);
        const passed = gate.kind === "regex_must_match" ? matched : !matched;

        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: passed ? "pass" : "fail",
          blocking: gate.blocking,
          message:
            gate.message ||
            (passed
              ? `Gate "${gate.name}" passed.`
              : gate.kind === "regex_must_match"
                ? `Output did not match required regex for gate "${gate.name}".`
                : `Output matched blocked regex for gate "${gate.name}".`),
          details: `pattern=${gate.pattern} flags=${gate.flags || "(none)"}`
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Invalid regex";
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `Invalid regex in gate "${gate.name}".`,
          details: reason
        });
      }

      continue;
    }

    if (gate.kind === "json_field_exists") {
      if (!cachedJson) {
        cachedJson = parseJsonOutput(output);
      }

      if (!gate.jsonPath || gate.jsonPath.trim().length === 0) {
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `JSON path is empty for gate "${gate.name}".`,
          details: "Set jsonPath in gate configuration."
        });
        continue;
      }

      const found = cachedJson ? resolvePathValue(cachedJson, gate.jsonPath).found : false;
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: found ? "pass" : "fail",
        blocking: gate.blocking,
        message:
          gate.message ||
          (found
            ? `JSON path "${gate.jsonPath}" exists.`
            : `JSON path "${gate.jsonPath}" is missing.`),
        details: cachedJson ? `path=${gate.jsonPath}` : "Output is not valid JSON."
      });
      continue;
    }

    if (!gate.artifactPath || gate.artifactPath.trim().length === 0) {
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: "fail",
        blocking: gate.blocking,
        message: gate.message || `Artifact path is empty for gate "${gate.name}".`,
        details: "Set artifactPath in gate configuration."
      });
      continue;
    }

    const resolvedPath = applyStoragePathTokens(gate.artifactPath, storagePaths, runInputs);
    const disabledStorage =
      resolvedPath.includes("DISABLED") ||
      (gate.artifactPath.includes("{{shared_storage_path}}") && storagePaths.sharedStoragePath === "DISABLED") ||
      (gate.artifactPath.includes("{{isolated_storage_path}}") && storagePaths.isolatedStoragePath === "DISABLED");
    const exists = !disabledStorage && (await pathExists(resolvedPath));

    results.push({
      gateId: gate.id,
      gateName: gate.name,
      kind: gate.kind,
      status: exists ? "pass" : "fail",
      blocking: gate.blocking,
      message:
        gate.message ||
        (exists ? `Artifact found: ${resolvedPath}` : `Artifact missing: ${gate.artifactPath}`),
      details: disabledStorage ? "Storage policy disabled the required artifact path." : resolvedPath
    });
  }

  return results;
}

function formatBlockingGateFailures(results: StepQualityGateResult[]): string {
  const failures = results.filter((result) => result.status === "fail" && result.blocking);
  if (failures.length === 0) {
    return "";
  }

  const lines = failures.map(
    (result, index) => `${index + 1}. ${result.gateName}: ${result.message}${result.details ? ` (${result.details})` : ""}`
  );
  return `QUALITY_GATES_BLOCKED:\n${lines.join("\n")}`;
}

function composeContext(
  step: PipelineStep,
  task: string,
  timeline: TimelineEntry[],
  latestOutputByStepId: Map<string, string>,
  incomingLinks: PipelineLink[],
  stepById: Map<string, PipelineStep>,
  attempt: number,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): string {
  const renderedTask = replaceInputTokens(task, runInputs);
  const previousOutput = timeline[timeline.length - 1]?.output ?? "No previous output";
  const allOutputs = timeline
    .map((entry, index) => `Step ${index + 1} (${entry.stepName}):\n${entry.output}`)
    .join("\n\n");
  const incomingOutputs = incomingLinks
    .map((link) => {
      const sourceStep = stepById.get(link.sourceStepId);
      const output = latestOutputByStepId.get(link.sourceStepId);
      if (!sourceStep || !output) {
        return "";
      }
      return `${sourceStep.name}:\n${output}`;
    })
    .filter((entry) => entry.length > 0)
    .join("\n\n");
  const storagePolicy = [
    `storage_enabled: ${storagePaths.sharedStoragePath !== "DISABLED" || storagePaths.isolatedStoragePath !== "DISABLED" ? "true" : "false"}`,
    `shared_storage: ${storagePaths.sharedStoragePath !== "DISABLED" ? "rw" : "disabled"}`,
    `isolated_storage: ${storagePaths.isolatedStoragePath !== "DISABLED" ? "rw" : "disabled"}`
  ].join("\n");
  const runInputsSummary = formatRunInputsSummary(runInputs);
  const outputContract = [
    `output_format: ${step.outputFormat}`,
    `required_output_fields: ${step.requiredOutputFields.length > 0 ? step.requiredOutputFields.join(", ") : "none"}`,
    `required_output_files: ${step.requiredOutputFiles.length > 0 ? step.requiredOutputFiles.join(", ") : "none"}`
  ].join("\n");
  const storageInfo = [
    "Storage paths:",
    `- shared_storage_path: ${storagePaths.sharedStoragePath}`,
    `- isolated_storage_path: ${storagePaths.isolatedStoragePath}`,
    `- run_storage_path: ${storagePaths.runStoragePath}`,
    "",
    "Run inputs:",
    runInputsSummary,
    "",
    `MCP servers enabled for this step: ${step.enabledMcpServerIds.length > 0 ? step.enabledMcpServerIds.join(", ") : "None"}`,
    "",
    "Storage policy:",
    storagePolicy,
    "",
    "Output contract:",
    outputContract
  ].join("\n");

  if (step.contextTemplate.trim().length === 0) {
    const fallback = [
      `Task:\n${renderedTask}`,
      "",
      `Run inputs:\n${runInputsSummary}`,
      "",
      `Attempt:\n${attempt}`,
      "",
      `Previous output:\n${previousOutput}`,
      "",
      `Incoming outputs:\n${incomingOutputs || "None"}`,
      "",
      `All completed outputs:\n${allOutputs || "None"}`,
      "",
      storageInfo
    ].join("\n");
    return clampContextToWindow(fallback, step.contextWindowTokens);
  }

  const renderedTemplate = replaceInputTokens(
    step.contextTemplate
      .replace(/\{\{task\}\}/g, renderedTask)
      .replace(/\{\{attempt\}\}/g, String(attempt))
      .replace(/\{\{previous_output\}\}/g, previousOutput)
      .replace(/\{\{incoming_outputs\}\}/g, incomingOutputs || "None")
      .replace(/\{\{upstream_outputs\}\}/g, incomingOutputs || "None")
      .replace(/\{\{all_outputs\}\}/g, allOutputs || "None")
      .replace(/\{\{run_inputs\}\}/g, runInputsSummary)
      .replace(/\{\{shared_storage_path\}\}/g, storagePaths.sharedStoragePath)
      .replace(/\{\{isolated_storage_path\}\}/g, storagePaths.isolatedStoragePath)
      .replace(/\{\{run_storage_path\}\}/g, storagePaths.runStoragePath)
      .replace(/\{\{storage_policy\}\}/g, storagePolicy)
      .replace(/\{\{mcp_servers\}\}/g, step.enabledMcpServerIds.length > 0 ? step.enabledMcpServerIds.join(", ") : "None"),
    runInputs
  );

  const rendered = `${renderedTemplate}\n\n${storageInfo}`;
  return clampContextToWindow(rendered, step.contextWindowTokens);
}

function createRunStep(step: PipelineStep): StepRun {
  return {
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
  };
}

function updateRunStep(run: PipelineRun, step: PipelineStep, updater: (current: StepRun) => StepRun): PipelineRun {
  const index = run.steps.findIndex((entry) => entry.stepId === step.id);
  const current = index >= 0 ? run.steps[index] : createRunStep(step);
  const nextEntry = updater(current);
  const steps = [...run.steps];

  if (index >= 0) {
    steps[index] = nextEntry;
  } else {
    steps.push(nextEntry);
  }

  return {
    ...run,
    steps
  };
}

function appendRunLog(store: LocalStore, runId: string, message: string): void {
  store.updateRun(runId, (run) => ({
    ...run,
    logs: [...run.logs, message]
  }));
}

function markRunStart(store: LocalStore, runId: string): void {
  const startedAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") {
      return run;
    }

    return {
      ...run,
      status: "running",
      logs: [...run.logs, `Run started at ${startedAt}`]
    };
  });
}

function markRunCompleted(store: LocalStore, runId: string): void {
  const finishedAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled") {
      return run;
    }

    return {
      ...run,
      status: "completed",
      finishedAt,
      logs: [...run.logs, `Run completed at ${finishedAt}`]
    };
  });
}

function markRunFailed(store: LocalStore, runId: string, reason: string): void {
  const failedAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled") {
      return run;
    }

    return {
      ...run,
      status: "failed",
      finishedAt: failedAt,
      logs: [...run.logs, `Run failed: ${reason}`]
    };
  });
}

function markRunCancelled(store: LocalStore, runId: string, reason: string): void {
  const cancelledAt = nowIso();
  store.updateRun(runId, (run) => {
    if (run.status === "cancelled") {
      return run;
    }

    if (run.status !== "queued" && run.status !== "running") {
      return run;
    }

    return {
      ...run,
      status: "cancelled",
      finishedAt: run.finishedAt ?? cancelledAt,
      logs: [...run.logs, `Run stopped: ${reason}`],
      steps: run.steps.map((step) =>
        step.status === "running"
          ? {
              ...step,
              status: "failed",
              workflowOutcome: "fail",
              error: step.error ?? reason,
              finishedAt: step.finishedAt ?? cancelledAt
            }
          : step
      )
    };
  });
}

export function cancelRun(store: LocalStore, runId: string, reason = "Stopped by user"): boolean {
  const run = store.getRun(runId);
  if (!run) {
    return false;
  }

  if (run.status !== "queued" && run.status !== "running") {
    return false;
  }

  markRunCancelled(store, runId, reason);
  return true;
}

function markStepRunning(store: LocalStore, runId: string, step: PipelineStep, context: string, attempt: number): void {
  store.updateRun(runId, (run) => {
    const nextRun = updateRunStep(run, step, (current) => ({
      ...current,
      status: "running",
      attempts: attempt,
      inputContext: context,
      error: undefined,
      qualityGateResults: [],
      startedAt: nowIso()
    }));

    return {
      ...nextRun,
      logs: [...nextRun.logs, `${step.name} started (attempt ${attempt})`]
    };
  });
}

function markStepCompleted(
  store: LocalStore,
  runId: string,
  step: PipelineStep,
  output: string,
  subagentNotes: string[],
  qualityGateResults: StepQualityGateResult[],
  workflowOutcome: WorkflowOutcome,
  attempt: number
): void {
  store.updateRun(runId, (run) => {
    const nextRun = updateRunStep(run, step, (current) => ({
      ...current,
      status: "completed",
      attempts: attempt,
      workflowOutcome,
      output,
      subagentNotes,
      qualityGateResults,
      finishedAt: nowIso()
    }));

    return {
      ...nextRun,
      logs: [...nextRun.logs, `${step.name} completed (${workflowOutcome})`]
    };
  });
}

function markStepFailed(store: LocalStore, runId: string, step: PipelineStep, error: string, attempt: number): void {
  store.updateRun(runId, (run) => {
    const nextRun = updateRunStep(run, step, (current) => ({
      ...current,
      status: "failed",
      attempts: attempt,
      error,
      qualityGateResults: [],
      finishedAt: nowIso()
    }));

    return {
      ...nextRun,
      status: "failed",
      finishedAt: nowIso(),
      logs: [...nextRun.logs, `${step.name} failed: ${error}`]
    };
  });
}

function resolveRunRootPath(storage: StorageConfig, runId: string): string {
  return path.join(storage.rootPath, storage.runsFolder, safeStorageSegment(runId));
}

async function persistRunStateSnapshot(store: LocalStore, runId: string, runRootPath: string): Promise<void> {
  const run = store.getRun(runId);
  if (!run) {
    return;
  }

  await fs.mkdir(runRootPath, { recursive: true });
  const snapshot = {
    runId: run.id,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    task: run.task,
    inputs: run.inputs,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    generatedAt: nowIso(),
    logs: run.logs,
    steps: run.steps.map((step) => ({
      stepId: step.stepId,
      stepName: step.stepName,
      status: step.status,
      attempts: step.attempts,
      workflowOutcome: step.workflowOutcome,
      qualityGateResults: step.qualityGateResults,
      error: step.error
    }))
  };

  await fs.writeFile(path.join(runRootPath, "state.json"), JSON.stringify(snapshot, null, 2), "utf8");
}

function buildDelegationNotes(
  step: PipelineStep,
  routedLinks: PipelineLink[],
  allOutgoingCount: number,
  stepById: Map<string, PipelineStep>
): string[] {
  if (!step.enableDelegation) {
    return [];
  }

  if (allOutgoingCount === 0) {
    return ["Delegation enabled, but this agent has no connected downstream steps."];
  }

  if (routedLinks.length === 0) {
    return ["Delegation enabled, but no downstream step was routed for this outcome."];
  }

  const maxDelegates = Math.max(1, Math.min(8, step.delegationCount));
  const targets = routedLinks
    .slice(0, maxDelegates)
    .map((link) => stepById.get(link.targetStepId)?.name ?? link.targetStepId);
  return targets.map((name, index) => `Subagent-${index + 1} dispatched to ${name}.`);
}

async function executeStep(
  step: PipelineStep,
  provider: ProviderConfig | undefined,
  context: string,
  task: string,
  stageTimeoutMs: number,
  mcpServersById: Map<string, McpServerConfig>,
  runInputs: RunInputs,
  abortSignal?: AbortSignal
): Promise<string> {
  if (!provider) {
    return `Provider ${step.providerId} is not configured. Configure credentials in Provider Settings.`;
  }

  const executableStep: PipelineStep = {
    ...step,
    prompt: replaceInputTokens(step.prompt, runInputs)
  };

  const allowedServerIds = new Set(
    Array.isArray(step.enabledMcpServerIds)
      ? step.enabledMcpServerIds
          .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
      : []
  );

  const availableServers = [...allowedServerIds]
    .map((id) => mcpServersById.get(id))
    .filter((server): server is McpServerConfig => Boolean(server));

  const mcpGuidance =
    availableServers.length > 0
      ? [
          "MCP tools are available for this step.",
          `Allowed MCP server ids: ${availableServers.map((server) => server.id).join(", ")}`,
          "To request MCP tool execution, return STRICT JSON:",
          '{ "mcp_calls": [ { "server_id": "server-id", "tool": "tool_name", "arguments": { } } ] }',
          "If you can finish without MCP calls, return the final step output directly."
        ].join("\n")
      : "No MCP servers are enabled for this step.";

  const inputRequestGuidance = [
    "If execution is blocked by missing user-provided values, do NOT guess.",
    "Return STRICT JSON so UI can request those values:",
    "{",
    '  "status": "needs_input",',
    '  "summary": "short reason",',
    '  "input_requests": [',
    "    {",
    '      "key": "input_key",',
    '      "label": "Human label",',
    '      "type": "text|multiline|secret|path|url|select",',
    '      "required": true,',
    '      "reason": "why needed",',
    '      "options": [ { "value": "x", "label": "X" } ],',
    '      "allowCustom": true',
    "    }",
    "  ]",
    "}",
    "Secret requests (type=secret) are persisted in secure per-pipeline storage for future runs.",
    "Use input_requests only when blocked and additional user data is required."
  ].join("\n");

  let workingContext = `${context}\n\n${mcpGuidance}\n\n${inputRequestGuidance}`;
  let lastOutput = "";
  const maxToolRounds = 2;
  const maxCallsPerRound = 4;

  for (let round = 0; round <= maxToolRounds; round += 1) {
    if (abortSignal?.aborted) {
      throw createAbortError("Run stopped by user");
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(createAbortError(`${step.name} (${step.role}) timed out after ${stageTimeoutMs}ms`));
    }, stageTimeoutMs);
    const stepSignal = mergeAbortSignals([abortSignal, timeoutController.signal]);

    let output: string;
    try {
      output = await executeProviderStep({
        provider,
        step: executableStep,
        context: workingContext,
        task,
        signal: stepSignal
      });
    } finally {
      clearTimeout(timer);
    }

    lastOutput = output;
    const calls = parseMcpCallsFromOutput(output);

    if (calls.length === 0) {
      return output;
    }

    const limitedCalls = calls.slice(0, maxCallsPerRound);
    const results: McpToolResult[] = [];

    for (const call of limitedCalls) {
      if (abortSignal?.aborted) {
        throw createAbortError("Run stopped by user");
      }

      if (!allowedServerIds.has(call.serverId)) {
        results.push({
          serverId: call.serverId,
          tool: call.tool,
          ok: false,
          error: `MCP server "${call.serverId}" is not enabled for this step`
        });
        continue;
      }

      const result = await executeMcpToolCall(mcpServersById.get(call.serverId), call, stageTimeoutMs, abortSignal);
      results.push(result);
    }

    workingContext = [
      context,
      "",
      mcpGuidance,
      "",
      inputRequestGuidance,
      "",
      `MCP round ${round + 1} results:`,
      formatMcpToolResults(results),
      "",
      "Use these MCP results to continue. If more MCP calls are required, return updated mcp_calls JSON.",
      "Otherwise return final output for this step."
    ].join("\n");
  }

  return lastOutput;
}

function buildGraph(
  steps: PipelineStep[],
  links: PipelineLink[]
): {
  outgoingById: Map<string, PipelineLink[]>;
  incomingById: Map<string, PipelineLink[]>;
} {
  const stepIds = new Set(steps.map((step) => step.id));
  const outgoingById = new Map<string, PipelineLink[]>();
  const incomingById = new Map<string, PipelineLink[]>();

  for (const link of links) {
    if (
      !stepIds.has(link.sourceStepId) ||
      !stepIds.has(link.targetStepId) ||
      link.sourceStepId === link.targetStepId
    ) {
      continue;
    }

    const normalized: PipelineLink = {
      ...link,
      condition: link.condition ?? "always"
    };
    const outgoing = outgoingById.get(link.sourceStepId) ?? [];
    outgoing.push(normalized);
    outgoingById.set(link.sourceStepId, outgoing);

    const incoming = incomingById.get(link.targetStepId) ?? [];
    incoming.push(normalized);
    incomingById.set(link.targetStepId, incoming);
  }

  return { outgoingById, incomingById };
}

export async function runPipeline(input: RunPipelineInput): Promise<void> {
  const { store, runId, pipeline, task, abortSignal } = input;
  const runtime = normalizeRuntime(pipeline);
  const providers = store.getProviders() as Record<ProviderId, ProviderConfig>;
  const state = store.getState();
  const storageConfig = state.storage;
  const runRootPath = resolveRunRootPath(storageConfig, runId);
  const runInputs = normalizeRunInputs(input.runInputs ?? store.getRun(runId)?.inputs);
  const mcpServersById = new Map(state.mcpServers.map((server) => [server.id, server]));
  const orderedSteps = orderPipelineSteps(pipeline.steps, pipeline.links);

  if (orderedSteps.length === 0) {
    markRunFailed(store, runId, "Pipeline has no steps");
    await persistRunStateSnapshot(store, runId, runRootPath);
    return;
  }

  const stepById = new Map(orderedSteps.map((step) => [step.id, step]));
  const { outgoingById, incomingById } = buildGraph(orderedSteps, pipeline.links);
  const maxAttemptsPerStep = runtime.maxLoops + 1;
  const attemptsByStep = new Map<string, number>();
  const latestOutputByStepId = new Map<string, string>();
  const timeline: TimelineEntry[] = [];
  const queue: string[] = [];
  const queued = new Set<string>();

  const stopIfAborted = async (reason = "Stopped by user") => {
    if (!abortSignal?.aborted) {
      return false;
    }

    markRunCancelled(store, runId, reason);
    await persistRunStateSnapshot(store, runId, runRootPath);
    return true;
  };

  if (await stopIfAborted()) {
    return;
  }

  const enqueue = (stepId: string, reason?: string) => {
    if (!stepById.has(stepId) || queued.has(stepId)) {
      return;
    }

    const attempts = attemptsByStep.get(stepId) ?? 0;
    if (attempts >= maxAttemptsPerStep) {
      appendRunLog(store, runId, `Skipped ${stepById.get(stepId)?.name ?? stepId}: max loop count reached`);
      return;
    }

    queue.push(stepId);
    queued.add(stepId);

    if (reason) {
      appendRunLog(store, runId, `Queued ${stepById.get(stepId)?.name ?? stepId} (${reason})`);
    }
  };

  const entrySteps = orderedSteps.filter((step) => (incomingById.get(step.id)?.length ?? 0) === 0);
  if (entrySteps.length > 0) {
    for (const step of entrySteps) {
      enqueue(step.id, "entry step");
    }
  } else {
    const orchestrator = orderedSteps.find((step) => step.role === "orchestrator");
    enqueue(orchestrator?.id ?? orderedSteps[0].id, "cycle bootstrap");
  }

  markRunStart(store, runId);
  await persistRunStateSnapshot(store, runId, runRootPath);

  if (await stopIfAborted()) {
    return;
  }

  let totalExecutions = 0;

  while (true) {
    if (await stopIfAborted()) {
      return;
    }

    if (totalExecutions >= runtime.maxStepExecutions) {
      markRunFailed(store, runId, `Execution cap reached (${runtime.maxStepExecutions} stages)`);
      await persistRunStateSnapshot(store, runId, runRootPath);
      return;
    }

    const stepId = queue.shift();
    if (!stepId) {
      const nextUnvisited = orderedSteps.find((step) => (attemptsByStep.get(step.id) ?? 0) === 0);
      if (!nextUnvisited) {
        break;
      }

      enqueue(nextUnvisited.id, "disconnected fallback");
      continue;
    }

    queued.delete(stepId);
    const step = stepById.get(stepId);
    if (!step) {
      continue;
    }

    const attempt = (attemptsByStep.get(stepId) ?? 0) + 1;
    if (attempt > maxAttemptsPerStep) {
      appendRunLog(store, runId, `Skipped ${step.name}: max loop count reached`);
      continue;
    }

    const incomingLinks = incomingById.get(stepId) ?? [];
    const storagePaths = resolveStepStoragePaths(step, pipeline.id, runId, storageConfig);
    await ensureStepStorage(storagePaths);

    if (await stopIfAborted()) {
      return;
    }

    const context = composeContext(
      step,
      task,
      timeline,
      latestOutputByStepId,
      incomingLinks,
      stepById,
      attempt,
      storagePaths,
      runInputs
    );
    markStepRunning(store, runId, step, context, attempt);

    try {
      const output = await executeStep(
        step,
        providers[step.providerId],
        context,
        task,
        runtime.stageTimeoutMs,
        mcpServersById,
        runInputs,
        abortSignal
      );
      const inferredOutcome = inferWorkflowOutcome(output);
      const contractEvaluation = await evaluateStepContracts(step, output, storagePaths, runInputs);
      const qualityGateResults = [
        ...contractEvaluation.gateResults,
        ...(await evaluatePipelineQualityGates(
          step,
          output,
          contractEvaluation.parsedJson,
          pipeline.qualityGates ?? [],
          storagePaths,
          runInputs
        ))
      ];
      const hasBlockingGateFailure = qualityGateResults.some(
        (result) => result.status === "fail" && result.blocking
      );
      const blockingFailureSummary = formatBlockingGateFailures(qualityGateResults);
      const outputWithQuality = hasBlockingGateFailure && blockingFailureSummary.length > 0
        ? `${output}\n\n${blockingFailureSummary}`
        : output;
      const workflowOutcome: WorkflowOutcome = hasBlockingGateFailure ? "fail" : inferredOutcome;
      const outgoingLinks = outgoingById.get(stepId) ?? [];
      const routedLinks = outgoingLinks.filter((link) => routeMatchesCondition(link.condition, workflowOutcome));
      const subagentNotes = buildDelegationNotes(step, routedLinks, outgoingLinks.length, stepById);

      attemptsByStep.set(stepId, attempt);
      latestOutputByStepId.set(stepId, outputWithQuality);
      timeline.push({
        stepId,
        stepName: step.name,
        output: outputWithQuality
      });
      totalExecutions += 1;

      markStepCompleted(
        store,
        runId,
        step,
        outputWithQuality,
        subagentNotes,
        qualityGateResults,
        workflowOutcome,
        attempt
      );
      await persistRunStateSnapshot(store, runId, runRootPath);

      if (hasBlockingGateFailure) {
        const failedGates = qualityGateResults
          .filter((result) => result.status === "fail" && result.blocking)
          .map((result) => `${result.gateName}: ${result.message}`);
        appendRunLog(store, runId, `${step.name} blocked by quality gates -> ${failedGates.join(" | ")}`);
      }

      if (outgoingLinks.length > 0 && routedLinks.length === 0) {
        appendRunLog(store, runId, `${step.name} produced ${workflowOutcome}; no conditional route matched`);
      }

      for (const link of routedLinks) {
        enqueue(link.targetStepId, `${step.name} -> ${link.condition ?? "always"}`);
      }
    } catch (error) {
      if (abortSignal?.aborted) {
        markRunCancelled(store, runId, "Stopped by user");
        await persistRunStateSnapshot(store, runId, runRootPath);
        return;
      }

      if (isAbortError(error)) {
        const message = error instanceof Error ? error.message : "Step aborted";
        markStepFailed(store, runId, step, message, attempt);
        await persistRunStateSnapshot(store, runId, runRootPath);
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown step execution error";
      markStepFailed(store, runId, step, message, attempt);
      await persistRunStateSnapshot(store, runId, runRootPath);
      return;
    }
  }

  markRunCompleted(store, runId);
  await persistRunStateSnapshot(store, runId, runRootPath);
}
