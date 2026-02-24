import fs from "node:fs/promises";
import path from "node:path";
import { executeProviderStep } from "../providers.js";
import { executeMcpToolCall, type McpToolResult } from "../mcp.js";
import { createAbortError, mergeAbortSignals } from "../abort.js";
import { replaceInputTokens } from "../runInputs.js";
import type { LocalStore } from "../storage.js";
import { normalizeStepLabel } from "../stepLabel.js";
import type {
  McpServerConfig,
  PipelineLink,
  PipelineQualityGate,
  PipelineStep,
  ProviderConfig,
  StepQualityGateResult,
  WorkflowOutcome
} from "../types.js";
import type { RunInputs } from "../runInputs.js";
import type { StepStoragePaths } from "./types.js";
import { buildDelegationNotes } from "./context.js";
import type { ArtifactStateCheck } from "./artifacts.js";
import { checkArtifactsState } from "./artifacts.js";
import { formatMcpToolResults, parseMcpCallsFromOutput } from "./mcpOutput.js";
import {
  evaluatePipelineQualityGates,
  evaluateStepContracts,
  extractInputRequestSignal,
  inferWorkflowOutcome,
  parseGateResultContract,
  routeMatchesCondition
} from "./qualityGates.js";
import { isGateResultContractStep } from "./qualityGates/contracts.js";
import { listManualApprovalGates, waitForManualApprovals } from "./remediation.js";
import { evaluateArtifactContractsForStepProfiles } from "./policyProfiles.js";

const DEFAULT_STAGE_TIMEOUT_MS = 420_000;
const MAX_STAGE_TIMEOUT_MS = 18_000_000; // 5h hard ceiling
const IMMUTABLE_SHARED_ARTIFACT_BASENAMES = new Set([
  "ui-kit.json",
  "dev-code.json",
  "assets-manifest.json",
  "frame-map.json",
  "pdf-content.json"
]);
const SCRIPT_ARTIFACT_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1"
]);
const MAX_SCRIPT_ARTIFACT_SNAPSHOT_FILES = 2_000;

export interface ScriptArtifactSnapshot {
  normalizedPath: string;
  basename: string;
  mtimeMs: number;
  sizeBytes: number;
}

function artifactBasename(template: string): string {
  const normalized = template.trim().replace(/\\/g, "/");
  if (normalized.length === 0) {
    return "";
  }
  const segments = normalized.split("/");
  return (segments[segments.length - 1] ?? "").trim().toLowerCase();
}

function isScriptArtifactPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (extension.length === 0) {
    return false;
  }
  return SCRIPT_ARTIFACT_EXTENSIONS.has(extension);
}

function shouldEnforceUnexpectedScriptMutationGuard(step: PipelineStep): boolean {
  return step.role !== "orchestrator";
}

async function collectScriptArtifactsFromRoot(
  rootPath: string,
  target: ScriptArtifactSnapshot[],
  limit: number
): Promise<void> {
  const stack: string[] = [rootPath];
  while (stack.length > 0 && target.length < limit) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (target.length >= limit) {
        break;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !isScriptArtifactPath(entry.name)) {
        continue;
      }

      try {
        const stat = await fs.stat(fullPath);
        target.push({
          normalizedPath: path.resolve(fullPath),
          basename: entry.name.trim().toLowerCase(),
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size
        });
      } catch {
        continue;
      }
    }
  }
}

async function collectScriptArtifactSnapshots(storagePaths: StepStoragePaths): Promise<ScriptArtifactSnapshot[]> {
  const roots = [storagePaths.sharedStoragePath, storagePaths.isolatedStoragePath, storagePaths.runStoragePath].filter(
    (entry) => entry !== "DISABLED"
  );
  const snapshots: ScriptArtifactSnapshot[] = [];

  for (const root of roots) {
    if (snapshots.length >= MAX_SCRIPT_ARTIFACT_SNAPSHOT_FILES) {
      break;
    }
    await collectScriptArtifactsFromRoot(root, snapshots, MAX_SCRIPT_ARTIFACT_SNAPSHOT_FILES);
  }

  snapshots.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  return snapshots;
}

export function fixDuplicatedDataUriPrefixes(html: string): { normalized: string; replacements: number } {
  let replacements = 0;
  const normalized = html.replace(
    /data:image\/([a-zA-Z0-9.+-]+);base64,\s*data:image\/\1;base64,/gi,
    (_match: string, imageType: string) => {
      replacements += 1;
      return `data:image/${imageType};base64,`;
    }
  );
  return { normalized, replacements };
}

const ASSET_BACKGROUND_EXTENSIONS = ["png", "webp", "jpg", "jpeg", "svg", "gif"] as const;

function resolvePreferredSlideBackgroundAsset(
  frameIndexLiteral: string,
  availableAssetRefs: ReadonlySet<string>
): string | null {
  const frameIndex = Number.parseInt(frameIndexLiteral, 10);
  if (!Number.isFinite(frameIndex) || frameIndex <= 0) {
    return null;
  }

  const candidateIndexes = [frameIndex - 1, frameIndex];
  for (const candidateIndex of candidateIndexes) {
    if (candidateIndex < 0) {
      continue;
    }
    for (const ext of ASSET_BACKGROUND_EXTENSIONS) {
      const candidate = `assets/slide-${candidateIndex}-bg.${ext}`;
      if (availableAssetRefs.has(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function rewriteFrameBackgroundReferences(
  html: string,
  availableAssetRefs: ReadonlySet<string>
): { normalized: string; replacements: number } {
  if (availableAssetRefs.size === 0) {
    return { normalized: html, replacements: 0 };
  }

  let replacements = 0;
  const normalized = html.replace(
    /assets\/frame-(\d+)\.(png|jpe?g|webp|gif|svg)/gi,
    (match: string, frameIndexLiteral: string) => {
      const replacement = resolvePreferredSlideBackgroundAsset(frameIndexLiteral, availableAssetRefs);
      if (!replacement) {
        return match;
      }
      replacements += 1;
      return replacement;
    }
  );

  return { normalized, replacements };
}

async function collectSiblingAssetRefs(htmlArtifactPath: string): Promise<Set<string>> {
  const refs = new Set<string>();
  const assetsDir = path.join(path.dirname(htmlArtifactPath), "assets");
  let entries: Awaited<ReturnType<typeof fs.readdir>> = [];
  try {
    entries = await fs.readdir(assetsDir, { withFileTypes: true });
  } catch {
    return refs;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    refs.add(`assets/${entry.name.toLowerCase()}`);
  }
  return refs;
}

async function normalizeGeneratedHtmlAssets(
  step: PipelineStep,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs,
  log?: (message: string) => void
): Promise<void> {
  const htmlTemplates = step.requiredOutputFiles.filter((template) => /\.html?$/i.test(template.trim()));
  if (htmlTemplates.length === 0) {
    return;
  }

  const snapshots = await checkArtifactsState(htmlTemplates, storagePaths, runInputs);
  for (const snapshot of snapshots) {
    if (!snapshot.exists || snapshot.disabledStorage || !snapshot.foundPath) {
      continue;
    }

    try {
      const html = await fs.readFile(snapshot.foundPath, "utf8");
      const availableAssetRefs = await collectSiblingAssetRefs(snapshot.foundPath);
      const frameBackgroundRewrite = rewriteFrameBackgroundReferences(html, availableAssetRefs);
      const dataUriNormalization = fixDuplicatedDataUriPrefixes(frameBackgroundRewrite.normalized);
      const normalized = dataUriNormalization.normalized;
      if (normalized === html) {
        continue;
      }
      await fs.writeFile(snapshot.foundPath, normalized, "utf8");
      const logDetails: string[] = [];
      if (frameBackgroundRewrite.replacements > 0) {
        logDetails.push(
          `rewrote ${frameBackgroundRewrite.replacements} frame background reference${
            frameBackgroundRewrite.replacements === 1 ? "" : "s"
          }`
        );
      }
      if (dataUriNormalization.replacements > 0) {
        logDetails.push(
          `normalized ${dataUriNormalization.replacements} duplicated data URI prefix${
            dataUriNormalization.replacements === 1 ? "" : "es"
          }`
        );
      }
      log?.(
        `Normalized HTML asset references (${logDetails.join("; ") || "content updated"}): ${snapshot.foundPath}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown HTML normalization error";
      log?.(`Skipped HTML asset normalization for ${snapshot.foundPath}: ${message}`);
    }
  }
}

export function resolveEffectiveStageTimeoutMs(
  step: PipelineStep,
  provider: ProviderConfig,
  stageTimeoutMs: number
): number {
  const boundedBase = Math.max(10_000, Math.min(MAX_STAGE_TIMEOUT_MS, Math.floor(stageTimeoutMs || DEFAULT_STAGE_TIMEOUT_MS)));
  const model = (step.model || provider.defaultModel || "").toLowerCase();
  const isHighEffort = step.reasoningEffort === "high" || step.reasoningEffort === "xhigh";
  const isArtifactHeavyRole = step.role === "analysis" || step.role === "executor" || step.role === "planner";
  const isReviewLikeRole = step.role === "review" || step.role === "tester";
  let effective = boundedBase;

  if (provider.id === "claude") {
    const isOpus = model.includes("opus");
    const isVeryHeavyStep =
      isOpus ||
      step.use1MContext ||
      step.contextWindowTokens >= 500_000 ||
      isHighEffort ||
      isReviewLikeRole;
    const isHeavyStep = isArtifactHeavyRole || isReviewLikeRole || isOpus;

    if (model.includes("opus")) {
      effective = Math.max(effective, isHighEffort ? 3_600_000 : 2_400_000);
    } else {
      if (isArtifactHeavyRole && isHighEffort) {
        effective = Math.max(effective, 1_800_000);
      } else if (isHeavyStep) {
        effective = Math.max(effective, 1_200_000);
      } else {
        effective = Math.max(effective, 420_000);
      }
    }

    if (isVeryHeavyStep) {
      effective = Math.max(effective, 2_400_000);
    }
  } else if (step.use1MContext) {
    effective = Math.max(effective, 1_200_000);
  }

  return Math.min(effective, MAX_STAGE_TIMEOUT_MS);
}

function shouldEnforceRequiredArtifactFreshness(step: PipelineStep): boolean {
  if (step.requiredOutputFiles.length === 0) {
    return false;
  }

  return step.role === "analysis" || step.role === "executor" || step.role === "planner";
}

function didArtifactChange(before: ArtifactStateCheck, after: ArtifactStateCheck): boolean {
  if (!before.exists && after.exists) {
    return true;
  }

  if (before.foundPath !== after.foundPath) {
    return true;
  }

  const mtimeChanged =
    typeof before.mtimeMs === "number" &&
    Number.isFinite(before.mtimeMs) &&
    typeof after.mtimeMs === "number" &&
    Number.isFinite(after.mtimeMs) &&
    after.mtimeMs > before.mtimeMs + 0.5;
  if (mtimeChanged) {
    return true;
  }

  const sizeChanged =
    typeof before.sizeBytes === "number" &&
    Number.isFinite(before.sizeBytes) &&
    typeof after.sizeBytes === "number" &&
    Number.isFinite(after.sizeBytes) &&
    after.sizeBytes !== before.sizeBytes;
  if (sizeChanged) {
    return true;
  }

  return false;
}

export function resolveImmutableArtifactTemplatesForStep(
  stepById: Map<string, PipelineStep>,
  step: PipelineStep
): string[] {
  const writableBasenames = new Set(step.requiredOutputFiles.map((template) => artifactBasename(template)));
  const templatesByBasename = new Map<string, string>();

  for (const candidate of stepById.values()) {
    for (const template of candidate.requiredOutputFiles) {
      const basename = artifactBasename(template);
      if (!IMMUTABLE_SHARED_ARTIFACT_BASENAMES.has(basename)) {
        continue;
      }
      if (writableBasenames.has(basename)) {
        continue;
      }
      if (!templatesByBasename.has(basename)) {
        templatesByBasename.set(basename, template);
      }
    }
  }

  return [...templatesByBasename.values()];
}

export function buildImmutableArtifactMutationResults(
  step: PipelineStep,
  beforeSnapshots: ArtifactStateCheck[],
  afterSnapshots: ArtifactStateCheck[]
): StepQualityGateResult[] {
  if (beforeSnapshots.length === 0 || afterSnapshots.length === 0) {
    return [];
  }

  const beforeByTemplate = new Map(beforeSnapshots.map((entry) => [entry.template, entry]));
  const results: StepQualityGateResult[] = [];

  for (const after of afterSnapshots) {
    const before = beforeByTemplate.get(after.template);
    if (!before || after.disabledStorage) {
      continue;
    }

    if (!didArtifactChange(before, after)) {
      continue;
    }

    const basename = artifactBasename(after.template);
    results.push({
      gateId: `contract-immutable-artifact-${step.id}-${after.template}`,
      gateName: `Immutable artifact changed: ${after.template}`,
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message:
        basename.length > 0
          ? `Step "${step.name}" modified protected artifact "${basename}".`
          : `Step "${step.name}" modified a protected artifact.`,
      details: [
        `beforePath=${before.foundPath ?? "missing"}`,
        `afterPath=${after.foundPath ?? "missing"}`,
        `beforeMtime=${before.mtimeMs ?? "n/a"}`,
        `afterMtime=${after.mtimeMs ?? "n/a"}`,
        `beforeSize=${before.sizeBytes ?? "n/a"}`,
        `afterSize=${after.sizeBytes ?? "n/a"}`
      ].join(", ")
    });
  }

  return results;
}

export function buildRequiredArtifactFreshnessResults(
  step: PipelineStep,
  beforeSnapshots: ArtifactStateCheck[],
  afterSnapshots: ArtifactStateCheck[]
): StepQualityGateResult[] {
  if (!shouldEnforceRequiredArtifactFreshness(step)) {
    return [];
  }

  const beforeByTemplate = new Map(beforeSnapshots.map((entry) => [entry.template, entry]));
  const results: StepQualityGateResult[] = [];

  for (const after of afterSnapshots) {
    const before = beforeByTemplate.get(after.template);
    if (!before || after.disabledStorage || !after.exists) {
      continue;
    }

    const changed = didArtifactChange(before, after);
    results.push({
      gateId: `contract-artifact-updated-${step.id}-${after.template}`,
      gateName: `Required artifact updated: ${after.template}`,
      kind: "step_contract",
      status: "pass",
      blocking: true,
      message: changed
        ? `Required artifact was updated in this attempt: ${after.foundPath}`
        : `Required artifact is already up-to-date: ${after.foundPath}`,
      details: [
        `beforePath=${before.foundPath ?? "missing"}`,
        `afterPath=${after.foundPath ?? "missing"}`,
        `beforeMtime=${before.mtimeMs ?? "n/a"}`,
        `afterMtime=${after.mtimeMs ?? "n/a"}`,
        `beforeSize=${before.sizeBytes ?? "n/a"}`,
        `afterSize=${after.sizeBytes ?? "n/a"}`
      ].join(", ")
    });
  }

  return results;
}

function resolveAllowedScriptArtifactBasenames(step: PipelineStep): Set<string> {
  const allowed = new Set<string>();
  for (const template of step.requiredOutputFiles) {
    const basename = artifactBasename(template);
    if (!isScriptArtifactPath(basename)) {
      continue;
    }
    allowed.add(basename);
  }
  return allowed;
}

export function buildUnexpectedScriptMutationResults(
  step: PipelineStep,
  beforeSnapshots: ScriptArtifactSnapshot[],
  afterSnapshots: ScriptArtifactSnapshot[]
): StepQualityGateResult[] {
  if (beforeSnapshots.length === 0 && afterSnapshots.length === 0) {
    return [];
  }

  const allowedBasenames = resolveAllowedScriptArtifactBasenames(step);
  const beforeByPath = new Map(beforeSnapshots.map((entry) => [entry.normalizedPath, entry]));
  const unexpectedChanges: ScriptArtifactSnapshot[] = [];

  for (const after of afterSnapshots) {
    if (allowedBasenames.has(after.basename)) {
      continue;
    }

    const before = beforeByPath.get(after.normalizedPath);
    if (!before) {
      unexpectedChanges.push(after);
      continue;
    }

    const changed = after.sizeBytes !== before.sizeBytes || after.mtimeMs > before.mtimeMs + 0.5;
    if (changed) {
      unexpectedChanges.push(after);
    }
  }

  if (unexpectedChanges.length === 0) {
    return [];
  }

  return [
    {
      gateId: `contract-unexpected-script-${step.id}`,
      gateName: "Unexpected helper script mutation",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: `Step "${step.name}" created or modified helper script files that are not declared as required outputs.`,
      details: unexpectedChanges
        .slice(0, 5)
        .map((entry) => `${entry.normalizedPath} (size=${entry.sizeBytes})`)
        .join(" | ")
    }
  ];
}

export async function buildProfileArtifactContractResults(
  step: PipelineStep,
  afterSnapshots: ArtifactStateCheck[]
): Promise<StepQualityGateResult[]> {
  return evaluateArtifactContractsForStepProfiles(step, afterSnapshots);
}

export async function executeStep(
  step: PipelineStep,
  provider: ProviderConfig | undefined,
  context: string,
  task: string,
  stageTimeoutMs: number,
  mcpServersById: Map<string, McpServerConfig>,
  runInputs: RunInputs,
  log?: (message: string) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const stepLabel = normalizeStepLabel(step.name, step.id);
  if (!provider) {
    return `Provider ${step.providerId} is not configured. Configure credentials in Provider Settings.`;
  }

  const outputMode: "markdown" | "json" =
    step.outputFormat === "json" || isGateResultContractStep(step) ? "json" : "markdown";
  const effectiveStageTimeoutMs = resolveEffectiveStageTimeoutMs(step, provider, stageTimeoutMs);

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
          "When native tool-calling is available, invoke tool mcp_call with {server_id, tool, arguments}.",
          "Fallback only (for non-tool runtimes): return STRICT JSON:",
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
    'The "summary" field must always be written in English.',
    "Secret requests (type=secret) are persisted in secure per-pipeline storage for future runs.",
    "Use input_requests only when blocked and additional user data is required."
  ].join("\n");
  const gateResultContractGuidance =
    isGateResultContractStep(step)
      ? [
          "Status contract requirement (STRICT JSON):",
          "Return a single JSON object with this exact structure:",
          "{",
          '  "workflow_status": "PASS|FAIL|NEUTRAL|COMPLETE|NEEDS_INPUT",',
          '  "next_action": "continue|retry_step|retry_stage|escalate|stop",',
          '  "stage": "draft|pre_final|final",',
          '  "step_role": "orchestrator|extractor|builder|reviewer|remediator|renderer|delivery",',
          '  "gate_target": "step|stage|delivery",',
          '  "summary": "short summary",',
          '  "reasons": [',
          '    { "code": "machine_code", "message": "human-readable reason", "severity": "critical|high|medium|low" }',
          "  ]",
          "}",
          'The "summary" and each "reasons[*].message" value must be in English.',
          "When workflow_status is COMPLETE, set stage=final, step_role=delivery, and gate_target=delivery.",
          "Do not output markdown fences when output mode is JSON."
        ].join("\n")
      : "";

  let workingContext = `${context}\n\n${mcpGuidance}\n\n${inputRequestGuidance}${
    gateResultContractGuidance.length > 0 ? `\n\n${gateResultContractGuidance}` : ""
  }`;
  let lastOutput = "";
  const maxToolRounds = 2;
  const maxCallsPerRound = 4;
  const selectedModel = step.model || provider.defaultModel;

  log?.(
    `Execution config: provider=${provider.id}, model=${selectedModel}, timeout=${effectiveStageTimeoutMs}ms, effort=${step.reasoningEffort}, fastMode=${step.fastMode ? "on" : "off"}, outputMode=${outputMode}, contextChars=${workingContext.length}`
  );

  for (let round = 0; round <= maxToolRounds; round += 1) {
    if (abortSignal?.aborted) {
      throw createAbortError("Run stopped by user");
    }
    const roundNumber = round + 1;
    const roundStartedAt = Date.now();
    log?.(`Provider round ${roundNumber} started`);

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(createAbortError(`${stepLabel} (${step.role}) timed out after ${effectiveStageTimeoutMs}ms`));
    }, effectiveStageTimeoutMs);
    const stepSignal = mergeAbortSignals([abortSignal, timeoutController.signal]);

    let output: string;
    try {
      output = await executeProviderStep({
        provider,
        step: executableStep,
        context: workingContext,
        task,
        mcpServerIds: [...allowedServerIds],
        stageTimeoutMs: effectiveStageTimeoutMs,
        outputMode,
        log,
        signal: stepSignal
      });
      log?.(
        `Provider round ${roundNumber} finished in ${Date.now() - roundStartedAt}ms (outputChars=${output.length})`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider execution error";
      log?.(`Provider round ${roundNumber} failed in ${Date.now() - roundStartedAt}ms: ${message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    lastOutput = output;
    const calls = parseMcpCallsFromOutput(output);

    if (calls.length === 0) {
      log?.(`Provider round ${roundNumber} completed with final output (no MCP calls).`);
      return output;
    }

    log?.(`Provider round ${roundNumber} requested ${calls.length} MCP call(s).`);
    const limitedCalls = calls.slice(0, maxCallsPerRound);
    const results: McpToolResult[] = [];

    for (const call of limitedCalls) {
      if (abortSignal?.aborted) {
        throw createAbortError("Run stopped by user");
      }
      const mcpStartedAt = Date.now();
      log?.(`MCP call started: server=${call.serverId}, tool=${call.tool}`);

      if (!allowedServerIds.has(call.serverId)) {
        log?.(`MCP call rejected in ${Date.now() - mcpStartedAt}ms: server ${call.serverId} not enabled`);
        results.push({
          serverId: call.serverId,
          tool: call.tool,
          ok: false,
          error: `MCP server "${call.serverId}" is not enabled for this step`
        });
        continue;
      }

      const result = await executeMcpToolCall(
        mcpServersById.get(call.serverId),
        call,
        effectiveStageTimeoutMs,
        abortSignal
      );
      log?.(
        `MCP call ${result.ok ? "finished" : "failed"} in ${Date.now() - mcpStartedAt}ms: server=${call.serverId}, tool=${call.tool}`
      );
      results.push(result);
    }

    workingContext = [
      context,
      "",
      mcpGuidance,
      "",
      inputRequestGuidance,
      ...(gateResultContractGuidance.length > 0 ? ["", gateResultContractGuidance] : []),
      "",
      `MCP round ${round + 1} results:`,
      formatMcpToolResults(results),
      "",
      "Use these MCP results to continue. If more MCP calls are required, invoke mcp_call again (or return updated mcp_calls JSON on fallback runtimes).",
      "Otherwise return final output for this step."
    ].join("\n");
  }

  log?.(`Maximum MCP rounds reached; returning last output (chars=${lastOutput.length}).`);
  return lastOutput;
}

export interface StepExecutionInput {
  store: LocalStore;
  runId: string;
  step: PipelineStep;
  attempt: number;
  provider: ProviderConfig | undefined;
  context: string;
  task: string;
  stageTimeoutMs: number;
  mcpServersById: Map<string, McpServerConfig>;
  runInputs: RunInputs;
  outgoingLinks: PipelineLink[];
  qualityGates: PipelineQualityGate[];
  stepById: Map<string, PipelineStep>;
  storagePaths: StepStoragePaths;
  log?: (message: string) => void;
  abortSignal?: AbortSignal;
}

export interface StepExecutionOutput {
  output: string;
  qualityGateResults: StepQualityGateResult[];
  hasBlockingGateFailure: boolean;
  shouldStopForInput: boolean;
  inputSummary?: string;
  workflowOutcome: WorkflowOutcome;
  outgoingLinks: PipelineLink[];
  routedLinks: PipelineLink[];
  subagentNotes: string[];
}

function buildDeliveryCompletionContractInvariantResults(
  step: PipelineStep,
  outgoingLinks: PipelineLink[],
  output: string,
  parsedJson: Record<string, unknown> | null
): StepQualityGateResult[] {
  const contractCheck = parseGateResultContract(output, parsedJson);
  if (!contractCheck.contract || contractCheck.source !== "json") {
    return [];
  }

  if (contractCheck.contract.workflowStatus !== "COMPLETE") {
    return [];
  }

  const reportedStage = contractCheck.contract.stage?.trim().toLowerCase() ?? "";
  const reportedStepRole = contractCheck.contract.stepRole?.trim().toLowerCase() ?? "";
  const reportedGateTarget = contractCheck.contract.gateTarget?.trim().toLowerCase() ?? "";
  const hasRequiredContractMetadata =
    reportedStage === "final" && reportedStepRole === "delivery" && reportedGateTarget === "delivery";
  const isFinalExecutorStage = step.role === "executor" && outgoingLinks.length === 0;
  const passed = hasRequiredContractMetadata && isFinalExecutorStage;

  return [
    {
      gateId: `contract-delivery-complete-target-${step.id}`,
      gateName: "Delivery completion target invariant",
      kind: "step_contract",
      status: passed ? "pass" : "fail",
      blocking: true,
      message: passed
        ? "COMPLETE status was emitted on final delivery stage with explicit stage/role/target metadata."
        : "COMPLETE status must only be emitted by final delivery stage and include stage=final, step_role=delivery, gate_target=delivery.",
      details: `reported_stage=${reportedStage || "(missing)"}, reported_step_role=${reportedStepRole || "(missing)"}, reported_gate_target=${reportedGateTarget || "(missing)"}, step_role=${step.role}, outgoing_links=${outgoingLinks.length}`
    }
  ];
}

export function selectRoutedLinksForOutcome(
  outgoingLinks: PipelineLink[],
  workflowOutcome: WorkflowOutcome,
  hasBlockingGateFailure: boolean
): PipelineLink[] {
  const matched = outgoingLinks.filter((link) => routeMatchesCondition(link.condition, workflowOutcome));
  if (workflowOutcome !== "fail" || !hasBlockingGateFailure) {
    return matched;
  }

  const failOnly = matched.filter((link) => link.condition === "on_fail");
  return failOnly;
}

export async function evaluateStepExecution(input: StepExecutionInput): Promise<StepExecutionOutput> {
  const {
    store,
    runId,
    step,
    attempt,
    provider,
    context,
    task,
    stageTimeoutMs,
    mcpServersById,
    runInputs,
    outgoingLinks,
    qualityGates,
    stepById,
    storagePaths,
    log,
    abortSignal
  } = input;

  const requiredArtifactBeforeSnapshots = shouldEnforceRequiredArtifactFreshness(step)
    ? await checkArtifactsState(step.requiredOutputFiles, storagePaths, runInputs)
    : [];
  const scriptArtifactBeforeSnapshots = shouldEnforceUnexpectedScriptMutationGuard(step)
    ? await collectScriptArtifactSnapshots(storagePaths)
    : [];
  const immutableArtifactTemplates = resolveImmutableArtifactTemplatesForStep(stepById, step);
  const immutableArtifactBeforeSnapshots =
    immutableArtifactTemplates.length > 0
      ? await checkArtifactsState(immutableArtifactTemplates, storagePaths, runInputs)
      : [];

  const output = await executeStep(
    step,
    provider,
    context,
    task,
    stageTimeoutMs,
    mcpServersById,
    runInputs,
    log,
    abortSignal
  );
  await normalizeGeneratedHtmlAssets(step, storagePaths, runInputs, log);
  const inferredOutcome = inferWorkflowOutcome(output);
  const contractEvaluation = await evaluateStepContracts(step, output, storagePaths, runInputs);
  const deliveryCompletionContractInvariantResults = buildDeliveryCompletionContractInvariantResults(
    step,
    outgoingLinks,
    output,
    contractEvaluation.parsedJson
  );
  const requiredArtifactAfterSnapshots = shouldEnforceRequiredArtifactFreshness(step)
    ? await checkArtifactsState(step.requiredOutputFiles, storagePaths, runInputs)
    : [];
  const scriptArtifactAfterSnapshots = shouldEnforceUnexpectedScriptMutationGuard(step)
    ? await collectScriptArtifactSnapshots(storagePaths)
    : [];
  const immutableArtifactAfterSnapshots =
    immutableArtifactTemplates.length > 0
      ? await checkArtifactsState(immutableArtifactTemplates, storagePaths, runInputs)
      : [];
  const requiredArtifactFreshnessResults = buildRequiredArtifactFreshnessResults(
    step,
    requiredArtifactBeforeSnapshots,
    requiredArtifactAfterSnapshots
  );
  const immutableArtifactMutationResults = buildImmutableArtifactMutationResults(
    step,
    immutableArtifactBeforeSnapshots,
    immutableArtifactAfterSnapshots
  );
  const profileArtifactContractResults = await buildProfileArtifactContractResults(step, requiredArtifactAfterSnapshots);
  const unexpectedScriptMutationResults = buildUnexpectedScriptMutationResults(
    step,
    scriptArtifactBeforeSnapshots,
    scriptArtifactAfterSnapshots
  );
  const pipelineGateResults = await evaluatePipelineQualityGates(
    step,
    output,
    contractEvaluation.parsedJson,
    qualityGates,
    storagePaths,
    runInputs
  );
  const manualApprovalGates = listManualApprovalGates(step, qualityGates);
  const manualApprovalResults = await waitForManualApprovals(
    store,
    runId,
    step,
    manualApprovalGates,
    attempt,
    abortSignal
  );
  const qualityGateResults = [
    ...contractEvaluation.gateResults,
    ...deliveryCompletionContractInvariantResults,
    ...requiredArtifactFreshnessResults,
    ...immutableArtifactMutationResults,
    ...profileArtifactContractResults,
    ...unexpectedScriptMutationResults,
    ...pipelineGateResults,
    ...manualApprovalResults
  ];
  const hasBlockingGateFailure = qualityGateResults.some((result) => result.status === "fail" && result.blocking);
  const inputSignal = extractInputRequestSignal(output, contractEvaluation.parsedJson);
  const shouldStopForInput = inputSignal.needsInput;
  const workflowOutcome: WorkflowOutcome = hasBlockingGateFailure || shouldStopForInput ? "fail" : inferredOutcome;
  const routedLinks = shouldStopForInput
    ? []
    : selectRoutedLinksForOutcome(outgoingLinks, workflowOutcome, hasBlockingGateFailure);
  const subagentNotes = shouldStopForInput
    ? []
    : buildDelegationNotes(step, routedLinks, outgoingLinks.length, stepById);

  return {
    output,
    qualityGateResults,
    hasBlockingGateFailure,
    shouldStopForInput,
    inputSummary: inputSignal.summary,
    workflowOutcome,
    outgoingLinks: shouldStopForInput ? [] : outgoingLinks,
    routedLinks,
    subagentNotes
  };
}
