import fs from "node:fs/promises";
import path from "node:path";
import { MAX_CONTEXT_WINDOW_TOKENS } from "../modelCatalog.js";
import {
  formatRunInputsSummary,
  getRunInputValue,
  replaceInputTokens,
  type RunInputs
} from "../runInputs.js";
import type { PipelineLink, PipelineStep, StorageConfig } from "../types.js";
import type { StepStoragePaths, TimelineEntry } from "./types.js";
import { parseJsonOutput, resolvePathValue } from "./qualityGates/normalizers.js";

const CONTEXT_OUTPUT_SUMMARY_CHARS = 1_200;
const CONTEXT_PREVIOUS_OUTPUT_SUMMARY_CHARS = 1_600;
const CONTEXT_RECENT_TIMELINE_LIMIT = 4;

export const safeStorageSegment = (value: string): string => {
  const trimmed = value.trim();
  const fallback = trimmed.length > 0 ? trimmed : "default";
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
};

function clampContextToWindow(context: string, contextWindowTokens: number): string {
  const safeTokens = Math.max(16_000, Math.min(MAX_CONTEXT_WINDOW_TOKENS, Math.floor(contextWindowTokens || 272_000)));
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

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated for context]`;
}

function summarizeJsonForContext(payload: Record<string, unknown>, maxChars: number): string {
  const preferredPaths = [
    "status",
    "workflow_status",
    "summary",
    "has_changes",
    "confidence",
    "needs_human_review",
    "review_result",
    "issues_found",
    "pass_count",
    "fail_count",
    "test_results"
  ];
  const parts = preferredPaths
    .map((fieldPath) => {
      const value = resolvePathValue(payload, fieldPath);
      if (!value.found) {
        return null;
      }
      return `${fieldPath}=${JSON.stringify(value.value)}`;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (parts.length > 0) {
    return clipText(parts.join("; "), maxChars);
  }

  return clipText(JSON.stringify(payload), maxChars);
}

function summarizeOutputForContext(output: string | undefined, maxChars: number): string {
  const trimmed = typeof output === "string" ? output.trim() : "";
  if (trimmed.length === 0) {
    return "No output";
  }

  const parsedJson = parseJsonOutput(trimmed);
  if (parsedJson) {
    return summarizeJsonForContext(parsedJson, maxChars);
  }

  return clipText(trimmed.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n"), maxChars);
}

function formatUpstreamContextEntry(step: PipelineStep, output: string | undefined, maxChars: number): string {
  const artifactHint =
    step.requiredOutputFiles.length > 0 ? step.requiredOutputFiles.join(", ") : "none declared";
  return [
    `${step.name}:`,
    `Summary: ${summarizeOutputForContext(output, maxChars)}`,
    `Artifacts: ${artifactHint}`
  ].join("\n");
}

export function resolveStepStoragePaths(
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
  const runRoot = path.join(storageRoot, storage.runsFolder, safeStorageSegment(runId), safeStorageSegment(step.id));

  return {
    sharedStoragePath: step.enableSharedStorage && storage.enabled ? sharedRoot : "DISABLED",
    isolatedStoragePath: step.enableIsolatedStorage && storage.enabled ? isolatedRoot : "DISABLED",
    runStoragePath: runRoot
  };
}

export async function ensureStepStorage(paths: StepStoragePaths): Promise<void> {
  await fs.mkdir(paths.runStoragePath, { recursive: true });

  if (paths.sharedStoragePath !== "DISABLED") {
    await fs.mkdir(paths.sharedStoragePath, { recursive: true });
  }

  if (paths.isolatedStoragePath !== "DISABLED") {
    await fs.mkdir(paths.isolatedStoragePath, { recursive: true });
  }
}

function applyStoragePathTokens(template: string, storagePaths: StepStoragePaths, runInputs: RunInputs): string {
  const rendered = replaceInputTokens(template, runInputs, { includeSecrets: false })
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

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveSafeOutputDirArtifactPath(
  outputDirRaw: string,
  relativeTemplate: string,
  runStoragePath: string
): string | null {
  const runRoot = path.resolve(runStoragePath);
  const outputDirTrimmed = outputDirRaw.trim();
  if (outputDirTrimmed.length === 0) {
    return null;
  }

  const outputBase = path.isAbsolute(outputDirTrimmed)
    ? path.resolve(outputDirTrimmed)
    : path.resolve(runRoot, outputDirTrimmed);
  const candidate = path.resolve(outputBase, relativeTemplate);
  return isPathWithinRoot(candidate, runRoot) ? candidate : null;
}

export function resolveArtifactCandidatePaths(
  template: string,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): { disabledStorage: boolean; paths: string[] } {
  const resolved = applyStoragePathTokens(template, storagePaths, runInputs);
  const disabledStorage =
    resolved.includes("DISABLED") ||
    (template.includes("{{shared_storage_path}}") && storagePaths.sharedStoragePath === "DISABLED") ||
    (template.includes("{{isolated_storage_path}}") && storagePaths.isolatedStoragePath === "DISABLED");

  const paths: string[] = [];
  const addPath = (value: string) => {
    const normalized = value.trim();
    if (normalized.length === 0 || paths.includes(normalized)) {
      return;
    }
    paths.push(normalized);
  };

  if (!disabledStorage) {
    addPath(resolved);
  }

  const usesStoragePlaceholder =
    template.includes("{{shared_storage_path}}") ||
    template.includes("{{isolated_storage_path}}") ||
    template.includes("{{run_storage_path}}");
  const templateTrimmed = template.trim();
  const isRelativeTemplate = templateTrimmed.length > 0 && !path.isAbsolute(templateTrimmed);

  if (!usesStoragePlaceholder && isRelativeTemplate) {
    const outputDir = getRunInputValue(runInputs, "output_dir");
    if (outputDir && outputDir.trim().length > 0) {
      const safeCandidate = resolveSafeOutputDirArtifactPath(outputDir, templateTrimmed, storagePaths.runStoragePath);
      if (safeCandidate) {
        addPath(safeCandidate);
      }
    }
  }

  return { disabledStorage, paths };
}

export function composeContext(
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
  const renderedTask = replaceInputTokens(task, runInputs, { includeSecrets: false });
  const previousOutput = summarizeOutputForContext(
    timeline[timeline.length - 1]?.output,
    CONTEXT_PREVIOUS_OUTPUT_SUMMARY_CHARS
  );
  const allOutputs = timeline
    .slice(-CONTEXT_RECENT_TIMELINE_LIMIT)
    .map((entry, index, entries) => {
      const recentIndex = timeline.length - entries.length + index + 1;
      return `Step ${recentIndex} (${entry.stepName}):\n${summarizeOutputForContext(entry.output, CONTEXT_OUTPUT_SUMMARY_CHARS)}`;
    })
    .join("\n\n");
  const incomingOutputs = incomingLinks
    .map((link) => {
      const sourceStep = stepById.get(link.sourceStepId);
      const output = latestOutputByStepId.get(link.sourceStepId);
      if (!sourceStep || !output) {
        return "";
      }
      return formatUpstreamContextEntry(sourceStep, output, CONTEXT_OUTPUT_SUMMARY_CHARS);
    })
    .filter((entry) => entry.length > 0)
    .join("\n\n");
  const storagePolicy = [
    `storage_enabled: ${
      storagePaths.sharedStoragePath !== "DISABLED" || storagePaths.isolatedStoragePath !== "DISABLED" ? "true" : "false"
    }`,
    `shared_storage: ${storagePaths.sharedStoragePath !== "DISABLED" ? "rw" : "disabled"}`,
    `isolated_storage: ${storagePaths.isolatedStoragePath !== "DISABLED" ? "rw" : "disabled"}`
  ].join("\n");
  const runInputsSummary = formatRunInputsSummary(runInputs, { redactSecrets: true });
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
    `MCP servers enabled for this step: ${
      step.enabledMcpServerIds.length > 0 ? step.enabledMcpServerIds.join(", ") : "None"
    }`,
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
      `Previous step summary:\n${previousOutput}`,
      "",
      `Direct upstream summaries:\n${incomingOutputs || "None"}`,
      "",
      `Recent completed step summaries:\n${allOutputs || "None"}`,
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
      .replace(
        /\{\{mcp_servers\}\}/g,
        step.enabledMcpServerIds.length > 0 ? step.enabledMcpServerIds.join(", ") : "None"
      ),
    runInputs,
    { includeSecrets: false }
  );

  const rendered = `${renderedTemplate}\n\n${storageInfo}`;
  return clampContextToWindow(rendered, step.contextWindowTokens);
}

export function buildDelegationNotes(
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
