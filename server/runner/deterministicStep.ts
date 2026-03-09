import fs from "node:fs/promises";
import path from "node:path";
import { replaceInputTokens, type RunInputs } from "../runInputs.js";
import type { PipelineStep } from "../types.js";
import type { StepStoragePaths } from "./types.js";
import { parseJsonOutput, resolvePathValue } from "./qualityGates/normalizers.js";

export type DeterministicStepKind = "fetch" | "diff" | "validate" | "publish";

interface DeterministicStepExecutionInput {
  step: PipelineStep;
  kind: DeterministicStepKind;
  task: string;
  stageTimeoutMs: number;
  storagePaths: StepStoragePaths;
  runInputs: RunInputs;
  log?: (message: string) => void;
  abortSignal?: AbortSignal;
}

interface FetchSourceConfig {
  from?: string;
  url?: string;
  to?: string;
  target?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  format?: "auto" | "text" | "json" | "binary";
}

interface DiffComparisonConfig {
  previous?: string;
  current?: string;
  left?: string;
  next?: string;
  right?: string;
  target?: string;
}

interface ValidateCheckConfig {
  kind?: string;
  path?: string;
  jsonPath?: string;
  equals?: unknown;
  includes?: string;
}

interface PublishActionConfig {
  from?: string;
  to?: string;
  overwrite?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProfileId(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveDeterministicStepKind(step: PipelineStep): DeterministicStepKind | null {
  const profiles = Array.isArray(step.policyProfileIds) ? step.policyProfileIds.map(normalizeProfileId) : [];
  if (profiles.includes("deterministic_fetch")) {
    return "fetch";
  }
  if (profiles.includes("deterministic_diff")) {
    return "diff";
  }
  if (profiles.includes("deterministic_validate")) {
    return "validate";
  }
  if (profiles.includes("deterministic_publish")) {
    return "publish";
  }
  return null;
}

function renderConfigSource(
  template: string,
  task: string,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): string {
  return replaceInputTokens(template, runInputs)
    .replace(/\{\{task\}\}/g, task)
    .replace(/\{\{shared_storage_path\}\}/g, storagePaths.sharedStoragePath)
    .replace(/\{\{isolated_storage_path\}\}/g, storagePaths.isolatedStoragePath)
    .replace(/\{\{run_storage_path\}\}/g, storagePaths.runStoragePath)
    .trim();
}

function resolvePathCandidate(value: string, runStoragePath: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Deterministic step path is empty.");
  }
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(runStoragePath, trimmed);
}

function parseDeterministicConfig(
  step: PipelineStep,
  task: string,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Record<string, unknown> {
  const rendered = renderConfigSource(step.prompt, task, storagePaths, runInputs);
  const parsed = parseJsonOutput(rendered);
  if (!parsed) {
    throw new Error(
      `Deterministic step "${step.name}" requires JSON config in prompt.`
    );
  }
  return parsed;
}

async function ensureParentDir(targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

function normalizeTextForDiff(raw: string): string {
  const parsed = parseJsonOutput(raw);
  if (!parsed) {
    return raw.replace(/\r\n/g, "\n").trim();
  }
  return JSON.stringify(parsed, null, 2);
}

function clip(value: string, maxChars = 240): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

async function readFileAsNormalizedText(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, "utf8");
  return normalizeTextForDiff(raw);
}

async function executeFetchStep(input: DeterministicStepExecutionInput, config: Record<string, unknown>): Promise<string> {
  const rawSources = Array.isArray(config.sources) ? config.sources : [];
  if (rawSources.length === 0) {
    throw new Error(`Deterministic fetch step "${input.step.name}" requires a non-empty "sources" array.`);
  }

  const summary: Array<Record<string, unknown>> = [];
  for (const rawSource of rawSources) {
    if (input.abortSignal?.aborted) {
      throw new Error("Deterministic fetch aborted.");
    }
    if (!isRecord(rawSource)) {
      throw new Error(`Deterministic fetch step "${input.step.name}" contains a non-object source entry.`);
    }

    const source = rawSource as FetchSourceConfig;
    const from = typeof source.from === "string" && source.from.trim().length > 0 ? source.from : source.url;
    const to = typeof source.to === "string" && source.to.trim().length > 0 ? source.to : source.target;
    if (!from || !to) {
      throw new Error(`Deterministic fetch source requires "from" and "to" fields.`);
    }

    const targetPath = resolvePathCandidate(to, input.storagePaths.runStoragePath);
    await ensureParentDir(targetPath);

    const isUrl = /^https?:\/\//i.test(from);
    if (isUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(5_000, input.stageTimeoutMs));
      try {
        const response = await fetch(from, {
          method: source.method?.trim() || "GET",
          headers: source.headers,
          body: source.body,
          signal: input.abortSignal
            ? AbortSignal.any([input.abortSignal, controller.signal])
            : controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${from}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        const format = source.format ?? "auto";
        if (format === "binary" || (format === "auto" && !/json|text|xml|javascript/i.test(contentType))) {
          const bytes = Buffer.from(await response.arrayBuffer());
          await fs.writeFile(targetPath, bytes);
          summary.push({ from, to: targetPath, bytes: bytes.length, source: "url" });
        } else {
          const text = await response.text();
          const normalized = format === "json" || /json/i.test(contentType)
            ? `${JSON.stringify(JSON.parse(text), null, 2)}\n`
            : text;
          await fs.writeFile(targetPath, normalized, "utf8");
          summary.push({ from, to: targetPath, chars: normalized.length, source: "url" });
        }
      } finally {
        clearTimeout(timer);
      }
      input.log?.(`Fetched remote source into ${targetPath}`);
      continue;
    }

    const sourcePath = resolvePathCandidate(from, input.storagePaths.runStoragePath);
    const format = source.format ?? "auto";
    if (format === "binary") {
      const bytes = await fs.readFile(sourcePath);
      await fs.writeFile(targetPath, bytes);
      summary.push({ from: sourcePath, to: targetPath, bytes: bytes.length, source: "file" });
    } else {
      const text = await fs.readFile(sourcePath, "utf8");
      const normalized = format === "json" ? `${JSON.stringify(JSON.parse(text), null, 2)}\n` : text;
      await fs.writeFile(targetPath, normalized, "utf8");
      summary.push({ from: sourcePath, to: targetPath, chars: normalized.length, source: "file" });
    }
    input.log?.(`Fetched local source into ${targetPath}`);
  }

  return JSON.stringify(
    {
      status: "completed",
      fetched_count: summary.length,
      artifacts: summary
    },
    null,
    2
  );
}

async function executeDiffStep(input: DeterministicStepExecutionInput, config: Record<string, unknown>): Promise<string> {
  const rawComparisons = Array.isArray(config.comparisons) ? config.comparisons : [];
  if (rawComparisons.length === 0) {
    throw new Error(`Deterministic diff step "${input.step.name}" requires a non-empty "comparisons" array.`);
  }

  const comparisons: Array<Record<string, unknown>> = [];
  let changedCount = 0;
  for (const rawComparison of rawComparisons) {
    if (!isRecord(rawComparison)) {
      throw new Error(`Deterministic diff step "${input.step.name}" contains a non-object comparison entry.`);
    }
    const comparison = rawComparison as DiffComparisonConfig;
    const previousLiteral = comparison.previous ?? comparison.current ?? comparison.left;
    const nextLiteral = comparison.next ?? comparison.right;
    if (!previousLiteral || !nextLiteral) {
      throw new Error(`Deterministic diff comparison requires "previous" and "next" paths.`);
    }

    const previousPath = resolvePathCandidate(previousLiteral, input.storagePaths.runStoragePath);
    const nextPath = resolvePathCandidate(nextLiteral, input.storagePaths.runStoragePath);
    const previousText = await readFileAsNormalizedText(previousPath);
    const nextText = await readFileAsNormalizedText(nextPath);
    const changed = previousText !== nextText;
    if (changed) {
      changedCount += 1;
    }

    const entry = {
      previous: previousPath,
      next: nextPath,
      changed,
      previous_preview: clip(previousText),
      next_preview: clip(nextText)
    };
    comparisons.push(entry);

    if (typeof comparison.target === "string" && comparison.target.trim().length > 0) {
      const targetPath = resolvePathCandidate(comparison.target, input.storagePaths.runStoragePath);
      await ensureParentDir(targetPath);
      await fs.writeFile(
        targetPath,
        `${JSON.stringify(
          {
            ...entry,
            has_changes: changed
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
  }

  return JSON.stringify(
    {
      status: "completed",
      has_changes: changedCount > 0,
      changed_count: changedCount,
      unchanged_count: comparisons.length - changedCount,
      comparisons
    },
    null,
    2
  );
}

async function executeValidateStep(input: DeterministicStepExecutionInput, config: Record<string, unknown>): Promise<string> {
  const rawChecks = Array.isArray(config.checks) ? config.checks : [];
  if (rawChecks.length === 0) {
    throw new Error(`Deterministic validate step "${input.step.name}" requires a non-empty "checks" array.`);
  }

  const results: Array<Record<string, unknown>> = [];
  let passCount = 0;
  let failCount = 0;

  for (const rawCheck of rawChecks) {
    if (!isRecord(rawCheck)) {
      throw new Error(`Deterministic validate step "${input.step.name}" contains a non-object check entry.`);
    }
    const check = rawCheck as ValidateCheckConfig;
    const kind = (check.kind ?? "").trim();
    const targetPath = typeof check.path === "string" ? resolvePathCandidate(check.path, input.storagePaths.runStoragePath) : "";
    let passed = false;
    let details = "";

    if (kind === "file_exists") {
      try {
        await fs.access(targetPath);
        passed = true;
      } catch {
        passed = false;
      }
      details = targetPath;
    } else if (kind === "json_field_exists" || kind === "json_equals") {
      const jsonPath = check.jsonPath?.trim() ?? "";
      const payload = parseJsonOutput(await fs.readFile(targetPath, "utf8"));
      const resolved = payload ? resolvePathValue(payload, jsonPath) : { found: false, value: undefined };
      passed = kind === "json_field_exists" ? resolved.found : resolved.found && resolved.value === check.equals;
      details = `${targetPath}:${jsonPath}`;
    } else if (kind === "text_includes" || kind === "text_not_includes") {
      const raw = await fs.readFile(targetPath, "utf8");
      const includes = typeof check.includes === "string" ? raw.includes(check.includes) : false;
      passed = kind === "text_includes" ? includes : !includes;
      details = `${targetPath}:${check.includes ?? ""}`;
    } else {
      throw new Error(`Unsupported deterministic validate check kind "${kind}".`);
    }

    if (passed) {
      passCount += 1;
    } else {
      failCount += 1;
    }

    results.push({
      kind,
      path: targetPath,
      passed,
      details
    });
  }

  return JSON.stringify(
    {
      status: failCount === 0 ? "completed" : "failed",
      pass_count: passCount,
      fail_count: failCount,
      validation_passed: failCount === 0,
      test_results: results
    },
    null,
    2
  );
}

async function executePublishStep(input: DeterministicStepExecutionInput, config: Record<string, unknown>): Promise<string> {
  const rawActions = Array.isArray(config.actions) ? config.actions : [];
  if (rawActions.length === 0) {
    throw new Error(`Deterministic publish step "${input.step.name}" requires a non-empty "actions" array.`);
  }

  const published: Array<Record<string, unknown>> = [];
  for (const rawAction of rawActions) {
    if (!isRecord(rawAction)) {
      throw new Error(`Deterministic publish step "${input.step.name}" contains a non-object action entry.`);
    }
    const action = rawAction as PublishActionConfig;
    if (!action.from || !action.to) {
      throw new Error(`Deterministic publish action requires "from" and "to" fields.`);
    }

    const fromPath = resolvePathCandidate(action.from, input.storagePaths.runStoragePath);
    const toPath = resolvePathCandidate(action.to, input.storagePaths.runStoragePath);
    await ensureParentDir(toPath);

    const stat = await fs.stat(fromPath);
    if (stat.isDirectory()) {
      await fs.cp(fromPath, toPath, { recursive: true, force: action.overwrite !== false });
      published.push({ from: fromPath, to: toPath, type: "directory" });
    } else {
      await fs.copyFile(fromPath, toPath);
      published.push({ from: fromPath, to: toPath, type: "file", bytes: stat.size });
    }
    input.log?.(`Published artifact ${fromPath} -> ${toPath}`);
  }

  return JSON.stringify(
    {
      status: "completed",
      published_count: published.length,
      published
    },
    null,
    2
  );
}

export async function executeDeterministicStep(input: DeterministicStepExecutionInput): Promise<string> {
  const config = parseDeterministicConfig(input.step, input.task, input.storagePaths, input.runInputs);
  input.log?.(`Deterministic ${input.kind} handler started`);

  if (input.kind === "fetch") {
    return executeFetchStep(input, config);
  }
  if (input.kind === "diff") {
    return executeDiffStep(input, config);
  }
  if (input.kind === "validate") {
    return executeValidateStep(input, config);
  }
  return executePublishStep(input, config);
}
