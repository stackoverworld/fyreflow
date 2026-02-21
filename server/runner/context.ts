import fs from "node:fs/promises";
import path from "node:path";
import {
  formatRunInputsSummary,
  getRunInputValue,
  replaceInputTokens,
  type RunInputs
} from "../runInputs.js";
import type { PipelineLink, PipelineStep, StorageConfig } from "../types.js";
import type { StepStoragePaths, TimelineEntry } from "./types.js";

export const safeStorageSegment = (value: string): string => {
  const trimmed = value.trim();
  const fallback = trimmed.length > 0 ? trimmed : "default";
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
};

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
      addPath(path.resolve(outputDir, templateTrimmed));
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
    `storage_enabled: ${
      storagePaths.sharedStoragePath !== "DISABLED" || storagePaths.isolatedStoragePath !== "DISABLED" ? "true" : "false"
    }`,
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
      .replace(
        /\{\{mcp_servers\}\}/g,
        step.enabledMcpServerIds.length > 0 ? step.enabledMcpServerIds.join(", ") : "None"
      ),
    runInputs
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
