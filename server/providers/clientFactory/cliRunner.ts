import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { createAbortError } from "../../abort.js";
import type { CommandResult, ProviderExecutionInput } from "../types.js";
import { CLAUDE_CLI_FALLBACK_MODEL, resolveClaudeCliAttemptTimeoutMs } from "../retryPolicy.js";
import { composeCliPrompt, mapClaudeEffort } from "../normalizers.js";
import {
  CLAUDE_CLI_COMMAND,
  CLI_EXEC_TIMEOUT_MS,
  CODEX_CLI_COMMAND,
  applyClaudeDiagnosticFlags,
  applyClaudeCompatibilityFlags,
  applyClaudeNonInteractiveFlags,
  isUnknownClaudeOptionError
} from "./config.js";

const execFileAsync = promisify(execFile);
const CLI_STREAM_CHUNK_LOGS = (process.env.CLI_STREAM_CHUNK_LOGS ?? "1").trim() !== "0";
const CLAUDE_CLI_STREAM_JSON = (process.env.CLAUDE_CLI_STREAM_JSON ?? "1").trim() !== "0";
const CLAUDE_CLI_MARKDOWN_STREAM_JSON = (process.env.CLAUDE_CLI_MARKDOWN_STREAM_JSON ?? "1").trim() !== "0";

type ClaudeCliOutputFormat = "text" | "json" | "stream-json";
const STREAM_JSON_MAX_LINE_CHARS = 8_000_000;
const MODEL_COMMAND_MAX_CHARS = 360;
const MODEL_SUMMARY_MAX_CHARS = 420;
const EMBEDDED_JSON_MAX_CHARS = 1_000_000;

function redactSensitiveText(value: string): string {
  let redacted = value;
  const replacements: Array<{ pattern: RegExp; replacement: string }> = [
    {
      pattern: /(authorization\s*[:=]\s*(?:bearer\s+)?)([^\s"'`,;]+)/gi,
      replacement: "$1[REDACTED]"
    },
    {
      pattern: /(x-[a-z0-9_-]*token\s*[:=]\s*)([^\s"'`,;]+)/gi,
      replacement: "$1[REDACTED]"
    },
    {
      pattern: /\b([a-z0-9._-]*(?:token|api[_-]?key|secret)\s*[:=]\s*)([^\s"'`,;]+)/gi,
      replacement: "$1[REDACTED]"
    },
    {
      pattern:
        /("?(?:[a-z0-9._-]*(?:token|api[_-]?key|secret)|authorization)"?\s*[:=]\s*"?)([^"\\\s,}]+)/gi,
      replacement: '$1[REDACTED]'
    }
  ];

  for (const replacement of replacements) {
    redacted = redacted.replace(replacement.pattern, replacement.replacement);
  }

  return redacted;
}

export interface StreamJsonCommandHint {
  tool?: string;
  command: string;
  cwd?: string;
}

export interface StreamJsonSummaryHint {
  summary: string;
}

function sanitizeModelCommand(value: string): string {
  const normalized = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= MODEL_COMMAND_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MODEL_COMMAND_MAX_CHARS - 3)}...`;
}

function sanitizeModelSummary(value: string): string {
  const normalized = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= MODEL_SUMMARY_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MODEL_SUMMARY_MAX_CHARS - 3)}...`;
}

function shouldUseSummaryCandidate(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 18) {
    return false;
  }
  if (!/[A-Za-z]/.test(normalized)) {
    return false;
  }
  const lowered = normalized.toLowerCase();
  if (lowered === "tool" || lowered === "plan" || lowered === "explore") {
    return false;
  }
  return true;
}

function maybeRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function maybeEmbeddedJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > EMBEDDED_JSON_MAX_CHARS ||
    (trimmed[0] !== "{" && trimmed[0] !== "[")
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return null;
    }
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function inferSyntheticCommandForTool(
  tool: string | undefined,
  record: Record<string, unknown>,
  nested: Record<string, unknown> | null
): string | undefined {
  const toolName = (tool ?? "").toLowerCase();
  const source = nested ?? record;
  const filePath =
    maybeString(source.file_path) ??
    maybeString(source.path) ??
    maybeString(source.filePath) ??
    maybeString(source.target_file) ??
    maybeString(source.file) ??
    maybeString(source.filename) ??
    maybeString(source.output_path) ??
    maybeString(source.input_path);

  if (filePath) {
    if (toolName.includes("write")) {
      return `write ${filePath}`;
    }
    if (toolName.includes("edit")) {
      return `edit ${filePath}`;
    }
    if (toolName.includes("read")) {
      return `read ${filePath}`;
    }
    if (toolName.includes("ls")) {
      return `ls ${filePath}`;
    }
  }

  const pattern = maybeString(source.pattern) ?? maybeString(source.query);
  if (pattern && toolName.includes("grep")) {
    return `grep "${pattern}"${filePath ? ` in ${filePath}` : ""}`;
  }

  if (pattern && toolName.includes("glob")) {
    return `glob "${pattern}"${filePath ? ` in ${filePath}` : ""}`;
  }

  return undefined;
}

function extractCommandsFromTextPayload(text: string): Array<{ tool?: string; command: string }> {
  const results: Array<{ tool?: string; command: string }> = [];
  const normalized = text.trim();
  if (normalized.length === 0) {
    return results;
  }

  const xmlRegex = /<tool_name>\s*([^<]+)\s*<\/tool_name>[\s\S]{0,5000}?<parameter name="command">([\s\S]{1,20000}?)<\/parameter>/gi;
  let xmlMatch: RegExpExecArray | null = null;
  while ((xmlMatch = xmlRegex.exec(normalized)) !== null) {
    const tool = maybeString(xmlMatch[1]);
    const command = maybeString(xmlMatch[2]);
    if (!command) {
      continue;
    }
    results.push({ tool, command });
  }

  const jsonRegex = /"name"\s*:\s*"([^"]+)"[\s\S]{0,5000}?"command"\s*:\s*"([\s\S]{1,12000}?)"/gi;
  let jsonMatch: RegExpExecArray | null = null;
  while ((jsonMatch = jsonRegex.exec(normalized)) !== null) {
    const tool = maybeString(jsonMatch[1]);
    const command = maybeString(jsonMatch[2]?.replace(/\\"/g, '"'));
    if (!command) {
      continue;
    }
    results.push({ tool, command });
  }

  return results;
}

function extractSummariesFromTextPayload(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return [];
  }

  const summaries: string[] = [];
  const jsonSummaryRegex = /"summary"\s*:\s*"((?:\\.|[^"\\]){6,1200})"/gi;
  let match: RegExpExecArray | null = null;
  while ((match = jsonSummaryRegex.exec(normalized)) !== null) {
    const extracted = maybeString(match[1]?.replace(/\\"/g, '"'));
    if (!extracted) {
      continue;
    }
    summaries.push(extracted);
  }

  return summaries;
}

function pushStreamJsonCommandHint(
  hints: StreamJsonCommandHint[],
  seen: Set<string>,
  command: string | undefined,
  tool: string | undefined,
  cwd: string | undefined
): void {
  if (!command) {
    return;
  }

  const sanitizedCommand = sanitizeModelCommand(command);
  if (sanitizedCommand.length === 0) {
    return;
  }

  const normalizedTool = maybeString(tool);
  const normalizedCwd = maybeString(cwd);
  const signature = `${normalizedTool ?? ""}::${normalizedCwd ?? ""}::${sanitizedCommand}`;
  if (seen.has(signature)) {
    return;
  }
  seen.add(signature);
  hints.push({
    tool: normalizedTool,
    command: sanitizedCommand,
    cwd: normalizedCwd
  });
}

function pushStreamJsonSummaryHint(hints: StreamJsonSummaryHint[], seen: Set<string>, summary: string | undefined): void {
  if (!summary) {
    return;
  }

  const sanitizedSummary = sanitizeModelSummary(summary);
  if (sanitizedSummary.length === 0) {
    return;
  }
  if (!shouldUseSummaryCandidate(sanitizedSummary)) {
    return;
  }
  const lowered = sanitizedSummary.toLowerCase();
  if (
    (lowered.includes("session_id") && lowered.includes("uuid")) ||
    (lowered.includes("parent_tool_use_id") && lowered.includes("context_management"))
  ) {
    return;
  }

  if (seen.has(sanitizedSummary)) {
    return;
  }
  seen.add(sanitizedSummary);
  hints.push({ summary: sanitizedSummary });
}

function collectStreamJsonSummaryHints(
  value: unknown,
  hints: StreamJsonSummaryHint[],
  seen: Set<string>
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStreamJsonSummaryHints(entry, hints, seen);
    }
    return;
  }

  const record = maybeRecord(value);
  if (!record) {
    const parsed = maybeEmbeddedJsonRecord(value);
    if (parsed) {
      collectStreamJsonSummaryHints(parsed, hints, seen);
    }
    return;
  }

  const summaryCandidates = [
    record.summary,
    record.reasoning_summary,
    record.thinking_summary,
    record.analysis_summary,
    record.final_summary,
    record.status_summary,
    record.reasoning,
    record.thinking,
    record.analysis,
    record.plan,
    record.explanation
  ];

  for (const candidate of summaryCandidates) {
    pushStreamJsonSummaryHint(hints, seen, maybeString(candidate));
  }

  const workflowStatus = maybeString(record.workflow_status);
  const htmlReviewStatus = maybeString(record.html_review_status);
  const pdfReviewStatus = maybeString(record.pdf_review_status);
  const nextAction = maybeString(record.next_action);
  if (workflowStatus || htmlReviewStatus || pdfReviewStatus || nextAction) {
    const segments = [
      workflowStatus ? `workflow=${workflowStatus}` : null,
      htmlReviewStatus ? `html=${htmlReviewStatus}` : null,
      pdfReviewStatus ? `pdf=${pdfReviewStatus}` : null,
      nextAction ? `next=${nextAction}` : null
    ].filter((entry): entry is string => entry !== null);
    pushStreamJsonSummaryHint(hints, seen, segments.join(" | "));
  }

  for (const textValue of Object.values(record)) {
    if (typeof textValue !== "string") {
      continue;
    }

    for (const extractedSummary of extractSummariesFromTextPayload(textValue)) {
      pushStreamJsonSummaryHint(hints, seen, extractedSummary);
    }
  }

  for (const nestedValue of Object.values(record)) {
    collectStreamJsonSummaryHints(nestedValue, hints, seen);
  }
}

function collectStreamJsonCommandHints(
  value: unknown,
  inheritedTool: string | undefined,
  hints: StreamJsonCommandHint[],
  seen: Set<string>
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStreamJsonCommandHints(entry, inheritedTool, hints, seen);
    }
    return;
  }

  const record = maybeRecord(value);
  if (!record) {
    const parsed = maybeEmbeddedJsonRecord(value);
    if (parsed) {
      collectStreamJsonCommandHints(parsed, inheritedTool, hints, seen);
    }
    return;
  }

  const localTool =
    maybeString(record.name) ??
    maybeString(record.tool_name) ??
    maybeString(record.toolName) ??
    maybeString(record.function_name) ??
    inheritedTool;

  pushStreamJsonCommandHint(
    hints,
    seen,
    maybeString(record.command) ??
      maybeString(record.cmd) ??
      maybeString(record.shell_command) ??
      maybeString(record.script),
    localTool,
    maybeString(record.cwd) ?? maybeString(record.workdir) ?? maybeString(record.working_directory)
  );

  const argumentContainers = [
    record.arguments,
    record.args,
    record.parameters,
    record.params,
    record.input,
    record.tool_input,
    record.function
  ];

  for (const container of argumentContainers) {
    const nested = maybeRecord(container) ?? maybeEmbeddedJsonRecord(container);
    if (!nested) {
      continue;
    }

    const synthetic = inferSyntheticCommandForTool(localTool, record, nested);
    pushStreamJsonCommandHint(
      hints,
      seen,
      synthetic,
      localTool,
      maybeString(nested.cwd) ?? maybeString(nested.workdir) ?? maybeString(nested.working_directory)
    );

    pushStreamJsonCommandHint(
      hints,
      seen,
      maybeString(nested.command) ??
        maybeString(nested.cmd) ??
        maybeString(nested.shell_command) ??
        maybeString(nested.script),
      localTool,
      maybeString(nested.cwd) ?? maybeString(nested.workdir) ?? maybeString(nested.working_directory)
    );
  }

  const localSynthetic = inferSyntheticCommandForTool(localTool, record, null);
  pushStreamJsonCommandHint(
    hints,
    seen,
    localSynthetic,
    localTool,
    maybeString(record.cwd) ?? maybeString(record.workdir) ?? maybeString(record.working_directory)
  );

  for (const textValue of Object.values(record)) {
    if (typeof textValue !== "string") {
      continue;
    }
    const extracted = extractCommandsFromTextPayload(textValue);
    for (const hint of extracted) {
      pushStreamJsonCommandHint(
        hints,
        seen,
        hint.command,
        hint.tool ?? localTool,
        maybeString(record.cwd) ?? maybeString(record.workdir) ?? maybeString(record.working_directory)
      );
    }
  }

  for (const nestedValue of Object.values(record)) {
    collectStreamJsonCommandHints(nestedValue, localTool, hints, seen);
  }
}

export function extractStreamJsonCommandHints(line: string): StreamJsonCommandHint[] {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > STREAM_JSON_MAX_LINE_CHARS) {
    return [];
  }

  const first = trimmed[0];
  if (first !== "{" && first !== "[") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const hints: StreamJsonCommandHint[] = [];
  const seen = new Set<string>();
  collectStreamJsonCommandHints(parsed, undefined, hints, seen);
  return hints;
}

export function extractStreamJsonSummaryHints(line: string): StreamJsonSummaryHint[] {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > STREAM_JSON_MAX_LINE_CHARS) {
    return [];
  }

  const first = trimmed[0];
  if (first !== "{" && first !== "[") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const hints: StreamJsonSummaryHint[] = [];
  const seen = new Set<string>();
  collectStreamJsonSummaryHints(parsed, hints, seen);
  return hints;
}

export function compactProcessSnapshot(value: string, maxChars = 220): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/"/g, "'")
    .slice(Math.max(0, value.length - maxChars), value.length);
}

async function readProcessSnapshot(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "pid=,ppid=,stat=,etime=,pcpu=,pmem=,rss=,vsz=,comm="
    ]);
    const compact = compactProcessSnapshot(stdout);
    return compact.length > 0 ? compact : null;
  } catch {
    return null;
  }
}

interface CliRunningLogInput {
  command: string;
  elapsedMs: number;
  stdoutChars: number;
  stderrChars: number;
  idleMs: number;
  stderrTail?: string;
  pid?: number | null;
  processSnapshot?: string | null;
}

export function formatCliRunningLog(input: CliRunningLogInput): string {
  const stderrPreview = input.stderrTail ? `, stderrTail="${input.stderrTail}"` : "";
  const pidPart = typeof input.pid === "number" ? `, pid=${input.pid}` : "";
  const processPart = input.processSnapshot ? `, process="${input.processSnapshot}"` : "";
  return `CLI command running: ${input.command} (${input.elapsedMs}ms elapsed, stdout=${input.stdoutChars} chars, stderr=${input.stderrChars} chars, idle=${input.idleMs}ms${pidPart}${stderrPreview}${processPart})`;
}

interface CliCommandStartLogInput {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

function compactCommandPreview(value: string, maxChars = 320): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/"/g, "'");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function maskCommandArg(value: string, index: number, total: number): string {
  if (index === total - 1 && value.length > 0) {
    return "<prompt>";
  }
  if (value.length > 120 || /\s{2,}/.test(value) || value.includes("\n")) {
    return `<arg${index + 1}>`;
  }
  return value;
}

export function formatCliCommandStartLog(input: CliCommandStartLogInput): string {
  const renderedArgs = input.args.map((arg, index) => maskCommandArg(arg, index, input.args.length));
  const commandWithArgs = renderedArgs.length > 0 ? `${input.command} ${renderedArgs.join(" ")}` : input.command;
  const commandPreview = compactCommandPreview(redactSensitiveText(commandWithArgs));
  return `CLI command started: ${commandPreview} (cwd=${input.cwd}, timeout=${input.timeoutMs}ms)`;
}

function runCommand(
  command: string,
  args: string[],
  stdinInput?: string,
  timeoutMs = 240000,
  signal?: AbortSignal,
  onLog?: (message: string) => void
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const preview = (value: string, maxChars = 160): string =>
      value
        .replace(/\s+/g, " ")
        .trim()
        .slice(Math.max(0, value.length - maxChars), value.length);
    const startedAt = Date.now();
    onLog?.(
      formatCliCommandStartLog({
        command,
        args,
        cwd: process.cwd(),
        timeoutMs
      })
    );
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const inspectStreamJson = args.includes("stream-json");

    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastOutputAt: number | null = null;
    let firstStdoutAt: number | null = null;
    let firstStderrAt: number | null = null;
    let lastChunkLogAt = 0;
    let stdoutLineBuffer = "";
    const emittedModelCommands = new Set<string>();
    const emittedModelSummaries = new Set<string>();

    const emitStreamJsonModelCommands = (line: string): void => {
      if (!inspectStreamJson || !onLog) {
        return;
      }

      const hints = extractStreamJsonCommandHints(line);
      if (hints.length === 0) {
        return;
      }

      for (const hint of hints) {
        const payload = JSON.stringify({
          tool: hint.tool ?? null,
          command: hint.command,
          cwd: hint.cwd ?? null
        });
        if (emittedModelCommands.has(payload)) {
          continue;
        }
        emittedModelCommands.add(payload);
        onLog(`Model command: ${payload}`);
      }

      const summaries = extractStreamJsonSummaryHints(line);
      for (const hint of summaries) {
        if (emittedModelSummaries.has(hint.summary)) {
          continue;
        }
        emittedModelSummaries.add(hint.summary);
        onLog(`Model summary: ${hint.summary}`);
      }
    };

    const consumeStdoutLines = (chunk: string, flush = false): void => {
      if (!inspectStreamJson) {
        return;
      }

      stdoutLineBuffer += chunk;
      while (true) {
        const newlineIndex = stdoutLineBuffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const line = stdoutLineBuffer.slice(0, newlineIndex);
        stdoutLineBuffer = stdoutLineBuffer.slice(newlineIndex + 1);
        emitStreamJsonModelCommands(line);
      }

      if (flush && stdoutLineBuffer.trim().length > 0) {
        emitStreamJsonModelCommands(stdoutLineBuffer);
        stdoutLineBuffer = "";
      }
    };

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearInterval(progressTimer);
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
      fn();
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      onLog?.(`CLI command timeout after ${Date.now() - startedAt}ms: ${command}`);
      finish(() => reject(new Error(`${command} timed out`)));
    }, timeoutMs);
    let progressProbeInFlight = false;
    const progressTimer = setInterval(() => {
      if (settled || progressProbeInFlight) {
        return;
      }
      progressProbeInFlight = true;
      const emit = (processSnapshot: string | null) => {
        if (settled) {
          return;
        }
        const now = Date.now();
        const elapsedMs = now - startedAt;
        const idleMs = lastOutputAt === null ? elapsedMs : now - lastOutputAt;
        onLog?.(
          formatCliRunningLog({
            command,
            elapsedMs,
            stdoutChars: stdout.length,
            stderrChars: stderr.length,
            idleMs,
            pid: child.pid,
            stderrTail: stderr.length > 0 ? preview(stderr) : undefined,
            processSnapshot
          })
        );
      };

      if (typeof child.pid !== "number") {
        emit(null);
        progressProbeInFlight = false;
        return;
      }

      void readProcessSnapshot(child.pid)
        .then(emit)
        .finally(() => {
          progressProbeInFlight = false;
        });
    }, 15_000);

    const abortListener = signal
      ? () => {
          child.kill("SIGTERM");
          const reason = signal.reason;
          const reasonMessage =
            reason instanceof Error
              ? reason.message
              : typeof reason === "string"
                ? reason
                : `${command} aborted`;
          onLog?.(`CLI command aborted after ${Date.now() - startedAt}ms: ${reasonMessage}`);
          finish(() => reject(createAbortError(reasonMessage)));
        }
      : null;

    if (signal?.aborted) {
      if (abortListener) {
        abortListener();
      } else {
        const reason = signal?.reason;
        const reasonMessage =
          reason instanceof Error ? reason.message : typeof reason === "string" ? reason : `${command} aborted`;
        finish(() => reject(createAbortError(reasonMessage)));
      }
      return;
    }

    if (signal && abortListener) {
      signal.addEventListener("abort", abortListener, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stdout += value;
      lastOutputAt = Date.now();
      consumeStdoutLines(value);
      if (firstStdoutAt === null) {
        firstStdoutAt = lastOutputAt;
        onLog?.(`CLI command first stdout after ${firstStdoutAt - startedAt}ms`);
      }
      if (CLI_STREAM_CHUNK_LOGS && Date.now() - lastChunkLogAt >= 2_000) {
        lastChunkLogAt = Date.now();
        onLog?.(`CLI stdout chunk: "${redactSensitiveText(preview(value, 180))}"`);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stderr += value;
      lastOutputAt = Date.now();
      if (firstStderrAt === null) {
        firstStderrAt = lastOutputAt;
        onLog?.(`CLI command first stderr after ${firstStderrAt - startedAt}ms`);
      }
      if (CLI_STREAM_CHUNK_LOGS && Date.now() - lastChunkLogAt >= 2_000) {
        lastChunkLogAt = Date.now();
        onLog?.(`CLI stderr chunk: "${redactSensitiveText(preview(value, 180))}"`);
      }
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      onLog?.(`CLI command process error after ${Date.now() - startedAt}ms: ${error.message}`);
      finish(() => reject(error));
    });

    child.once("close", (code) => {
      if (settled) {
        return;
      }
      consumeStdoutLines("", true);
      if (code === 0) {
        const now = Date.now();
        onLog?.(
          `CLI command completed in ${now - startedAt}ms (stdout=${stdout.length} chars, stderr=${stderr.length} chars, idle=${
            lastOutputAt === null ? now - startedAt : now - lastOutputAt
          }ms, firstStdout=${
            firstStdoutAt === null ? "none" : `${firstStdoutAt - startedAt}ms`
          }, firstStderr=${firstStderrAt === null ? "none" : `${firstStderrAt - startedAt}ms`})`
        );
        finish(() => resolve({ stdout, stderr }));
        return;
      }

      onLog?.(`CLI command exited with code ${code} after ${Date.now() - startedAt}ms`);
      finish(() => reject(new Error(`${command} exited with code ${code}: ${(stderr || stdout).slice(0, 520)}`)));
    });

    if (stdinInput && stdinInput.length > 0) {
      child.stdin.write(stdinInput);
    }
    child.stdin.end();
  });
}

async function runCodexCli(input: ProviderExecutionInput): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fyreflow-codex-"));
  const outputPath = path.join(tempDir, `last-message-${Date.now()}.txt`);

  try {
    const prompt = composeCliPrompt(input);
    await runCommand(
      CODEX_CLI_COMMAND,
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--model",
        input.step.model || input.provider.defaultModel,
        "--config",
        `model_reasoning_effort="${input.step.reasoningEffort}"`,
        "--output-last-message",
        outputPath,
        "-"
      ],
      prompt,
      CLI_EXEC_TIMEOUT_MS,
      input.signal,
      input.log
    );

    const output = await fs.readFile(outputPath, "utf8");
    const trimmed = output.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  return "Codex CLI completed with no final message output.";
}

interface BuildClaudeCliArgsInput {
  selectedModel: string;
  prompt: string;
  compatibilityMode?: boolean;
  disableDiagnostics?: boolean;
  forcePlainTextOutput?: boolean;
}

function shouldDisableClaudeCliTools(input: ProviderExecutionInput): boolean {
  if (input.step.role === "orchestrator") {
    return true;
  }

  return false;
}

function shouldRequireGateResultContract(input: ProviderExecutionInput): boolean {
  if (input.step.role === "review" || input.step.role === "tester") {
    return true;
  }

  return /\bdeliver(y|ed|ing)?\b/i.test(input.step.name);
}

interface ResolveClaudeCliOutputFormatInput {
  outputMode: ProviderExecutionInput["outputMode"];
  compatibilityMode?: boolean;
  forcePlainTextOutput?: boolean;
}

function resolveClaudeCliOutputFormat({
  outputMode,
  compatibilityMode = false,
  forcePlainTextOutput = false
}: ResolveClaudeCliOutputFormatInput): ClaudeCliOutputFormat {
  if (forcePlainTextOutput) {
    return "text";
  }

  if (outputMode === "json") {
    if (!compatibilityMode && CLAUDE_CLI_STREAM_JSON) {
      return "stream-json";
    }
    return "json";
  }

  // Markdown steps default to stream-json so UI can render real live activity
  // (thinking phases, tool progress, and partial output).
  if (!compatibilityMode && CLAUDE_CLI_STREAM_JSON && CLAUDE_CLI_MARKDOWN_STREAM_JSON) {
    return "stream-json";
  }

  return "text";
}

function buildClaudeJsonSchema(input: ProviderExecutionInput): string | null {
  if (input.outputMode !== "json") {
    return null;
  }

  if (!shouldRequireGateResultContract(input)) {
    return null;
  }

  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["workflow_status", "next_action", "reasons"],
    properties: {
      workflow_status: {
        type: "string",
        enum: ["PASS", "FAIL", "NEUTRAL", "COMPLETE", "NEEDS_INPUT"]
      },
      next_action: {
        type: "string",
        enum: ["continue", "retry_step", "retry_stage", "escalate", "stop"]
      },
      summary: { type: "string" },
      reasons: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            severity: {
              type: "string",
              enum: ["critical", "high", "medium", "low"]
            }
          }
        }
      },
      html_review_status: {
        type: "string",
        enum: ["PASS", "FAIL", "NEUTRAL", "COMPLETE", "NEEDS_INPUT"]
      },
      pdf_review_status: {
        type: "string",
        enum: ["PASS", "FAIL", "NEUTRAL", "COMPLETE", "NEEDS_INPUT"]
      }
    }
  });
}

export function buildClaudeCliArgs(input: ProviderExecutionInput, params: BuildClaudeCliArgsInput): string[] {
  const compatibilityMode = params.compatibilityMode === true;
  const disableDiagnostics = params.disableDiagnostics === true;
  const forcePlainTextOutput = params.forcePlainTextOutput === true;
  const outputMode = input.outputMode ?? "markdown";
  const cliOutputFormat = resolveClaudeCliOutputFormat({
    outputMode,
    compatibilityMode,
    forcePlainTextOutput
  });
  const args = ["--print", "--output-format", cliOutputFormat];
  if (compatibilityMode) {
    applyClaudeCompatibilityFlags(args);
  } else {
    applyClaudeNonInteractiveFlags(args);
  }
  if (!disableDiagnostics) {
    applyClaudeDiagnosticFlags(args);
  }
  if (shouldDisableClaudeCliTools(input)) {
    // Keep orchestrator runs deterministic and routing-only.
    args.push("--tools", "");
  }
  // Agent SDK print mode does not support fast mode and can emit warnings plus model fallback.
  // Force standard mode for deterministic behavior and lower startup latency in automated runs.
  args.push("--settings", '{"fastMode":false}');
  if (outputMode === "json" && !forcePlainTextOutput) {
    const schema = buildClaudeJsonSchema(input);
    if (schema) {
      args.push("--json-schema", schema);
    }
  }
  args.push("--model", params.selectedModel);
  if (!compatibilityMode) {
    args.push("--effort", mapClaudeEffort(input.step.reasoningEffort));
  }
  if (CLAUDE_CLI_FALLBACK_MODEL.length > 0 && CLAUDE_CLI_FALLBACK_MODEL !== params.selectedModel) {
    args.push("--fallback-model", CLAUDE_CLI_FALLBACK_MODEL);
  }

  if (input.step.fastMode) {
    args.push("--append-system-prompt", "Fast mode requested. Prioritize lower latency and concise responses.");
  }

  if (input.step.use1MContext) {
    args.push("--append-system-prompt", "1M context mode requested for compatible Sonnet/Opus models.");
  }

  args.push(params.prompt);
  return args;
}

function parseClaudeJsonPayloads(stdout: string): Record<string, unknown>[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return [parsed as Record<string, unknown>];
    }
  } catch {
    // fall through and try line-delimited JSON payloads
  }

  const payloads: Record<string, unknown>[] = [];
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        payloads.push(parsed as Record<string, unknown>);
      }
    } catch {
      // continue scanning
    }
  }

  return payloads;
}

function getClaudePayloadText(payload: Record<string, unknown>): string | null {
  const structuredOutput = payload.structured_output;
  if (structuredOutput && typeof structuredOutput === "object" && !Array.isArray(structuredOutput)) {
    return JSON.stringify(structuredOutput);
  }

  if (typeof structuredOutput === "string" && structuredOutput.trim().length > 0) {
    return structuredOutput.trim();
  }

  const result = payload.result;
  if (typeof result === "string" && result.trim().length > 0) {
    return result.trim();
  }
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return JSON.stringify(result);
  }

  const content = payload.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
          const value = (entry as { text?: unknown }).text;
          return typeof value === "string" ? value : "";
        }
        return "";
      })
      .join("")
      .trim();
    if (text.length > 0) {
      return text;
    }
  }

  const message = payload.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message.trim();
  }

  return null;
}

function getClaudePayloadDelta(payload: Record<string, unknown>): string {
  const delta = payload.delta;
  if (typeof delta === "string") {
    return delta;
  }
  if (typeof delta === "object" && delta !== null && !Array.isArray(delta)) {
    const text = (delta as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }

  const completion = payload.completion;
  if (typeof completion === "string") {
    return completion;
  }

  return "";
}

function extractClaudeCliOutput(
  stdout: string,
  outputMode: ProviderExecutionInput["outputMode"],
  cliOutputFormat: ClaudeCliOutputFormat,
  onLog?: (message: string) => void
): string {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (cliOutputFormat === "text" && outputMode !== "json") {
    return trimmed;
  }

  const payloads = parseClaudeJsonPayloads(trimmed);
  if (payloads.length === 0) {
    return trimmed;
  }

  let streamText = "";
  for (const payload of payloads) {
    streamText += getClaudePayloadDelta(payload);
  }

  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const text = getClaudePayloadText(payloads[index]);
    if (text && text.length > 0) {
      return text;
    }
  }

  if (streamText.trim().length > 0) {
    return streamText.trim();
  }

  onLog?.("Claude CLI payload did not include structured output fields; returning latest JSON payload.");
  return JSON.stringify(payloads[payloads.length - 1]);
}

function isUnsupportedClaudeOutputFormatError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\boutput-format\b.+\b(invalid|unsupported|unknown|must be one of)\b|\bstream-json\b/i.test(error.message);
}

async function runClaudeCli(input: ProviderExecutionInput): Promise<string> {
  const prompt = composeCliPrompt(input);
  const selectedModel = input.step.model || input.provider.defaultModel;
  const outputMode = input.outputMode ?? "markdown";
  const initialOutputFormat = resolveClaudeCliOutputFormat({
    outputMode,
    compatibilityMode: false,
    forcePlainTextOutput: false
  });
  const timeoutMs = resolveClaudeCliAttemptTimeoutMs(input.step, input.provider.defaultModel, input.stageTimeoutMs);
  input.log?.(
    `Claude CLI request started: model=${selectedModel}, timeout=${timeoutMs}ms, effort=${input.step.reasoningEffort}, fastMode=${input.step.fastMode ? "on" : "off"}, outputMode=${outputMode}, cliOutputFormat=${initialOutputFormat}, tools=${shouldDisableClaudeCliTools(input) ? "disabled" : "enabled"}`
  );

  let stdout = "";
  let usedCompatibilityFallback = false;
  let usedForcePlainText = false;
  let usedOutputFormat: ClaudeCliOutputFormat = initialOutputFormat;
  try {
    ({ stdout } = await runCommand(
      CLAUDE_CLI_COMMAND,
      buildClaudeCliArgs(input, {
        selectedModel,
        prompt,
        compatibilityMode: false,
        disableDiagnostics: false
      }),
      undefined,
      timeoutMs,
      input.signal,
      input.log
    ));
  } catch (error) {
    if (!(isUnknownClaudeOptionError(error) || isUnsupportedClaudeOutputFormatError(error))) {
      throw error;
    }
    usedCompatibilityFallback = true;
    usedForcePlainText = true;
    usedOutputFormat = "text";
    input.log?.(
      isUnsupportedClaudeOutputFormatError(error)
        ? "Claude CLI output-format option is unsupported; retrying with compatibility flags and plain-text output."
        : "Claude CLI reported unknown option; retrying with compatibility flags, diagnostics disabled, and plain-text output."
    );
    ({ stdout } = await runCommand(
      CLAUDE_CLI_COMMAND,
      buildClaudeCliArgs(input, {
        selectedModel,
        prompt,
        compatibilityMode: true,
        disableDiagnostics: true,
        forcePlainTextOutput: true
      }),
      undefined,
      timeoutMs,
      input.signal,
      input.log
    ));
  }
  const trimmed = extractClaudeCliOutput(
    stdout,
    usedCompatibilityFallback || usedForcePlainText ? "markdown" : input.outputMode,
    usedOutputFormat,
    input.log
  );
  if (trimmed.length > 0) {
    return trimmed;
  }

  return "Claude CLI completed with no text output.";
}

export async function executeViaCli(input: ProviderExecutionInput): Promise<string> {
  if (input.provider.id === "openai") {
    return runCodexCli(input);
  }

  return runClaudeCli(input);
}
