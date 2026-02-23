import type { PipelinePayload, PipelineRun } from "@/lib/types";

const DEFAULT_MAX_ACTIVITY_EVENTS = 220;

const ATTEMPT_MESSAGE_PREFIXES = [
  "Execution config:",
  "Provider round",
  "Provider dispatch started:",
  "OAuth status:",
  "No dashboard credential;",
  "Claude CLI request started:",
  "OpenAI API request started:",
  "Claude API request started:",
  "CLI command started:",
  "CLI command first stdout",
  "CLI command first stderr",
  "CLI command running:",
  "Model command:",
  "Model summary:",
  "CLI stdout chunk:",
  "CLI stderr chunk:",
  "CLI command completed",
  "CLI command timeout",
  "CLI command aborted",
  "CLI command exited",
  "MCP call started:",
  "MCP call finished",
  "MCP call failed",
  "MCP call rejected",
  "Timeout fallback",
  "fallback",
  "needs input",
  "blocked by quality gates"
] as const;

const STREAM_METADATA_MARKERS = [
  "session_id",
  "uuid",
  "parent_tool_use_id",
  "context_management",
  "permission_mode",
  "allowed_tools",
  "statusline"
] as const;

const STREAM_MEANINGFUL_MARKERS = [
  "workflow_status",
  "html_review_status",
  "pdf_review_status",
  "pass",
  "fail",
  "complete",
  "needs_input",
  "tool-results",
  "result",
  "summary",
  "error"
] as const;

const THINKING_PHASE_MARKERS = [
  "explore",
  "plan",
  "analyze",
  "review",
  "synthesize",
  "draft",
  "implement",
  "validate",
  "tool"
] as const;

export type StepLiveActivityKind =
  | "lifecycle"
  | "thinking"
  | "summary"
  | "status"
  | "command"
  | "command_progress"
  | "output"
  | "tool"
  | "error";

export interface StepLiveActivityEvent {
  id: string;
  kind: StepLiveActivityKind;
  attempt?: number;
  title: string;
  detail?: string;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  line: string;
}

interface AttemptEventShape {
  kind: StepLiveActivityKind;
  title: string;
  detail?: string;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveStepLabels(run: PipelineRun | null | undefined, step: PipelinePayload["steps"][number]): string[] {
  const labels = new Set<string>();
  const stepName = step.name.trim();
  if (stepName.length > 0) {
    labels.add(stepName);
  }

  const runStepName = run?.steps.find((entry) => entry.stepId === step.id)?.stepName?.trim() ?? "";
  if (runStepName.length > 0) {
    labels.add(runStepName);
  }

  return [...labels];
}

function isRelevantAttemptMessage(message: string): boolean {
  return ATTEMPT_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix));
}

function parseCliStart(message: string): { command: string; cwd?: string; timeoutMs?: number } | null {
  if (!message.startsWith("CLI command started: ")) {
    return null;
  }

  const raw = message.slice("CLI command started: ".length).trim();
  const detailsStart = raw.lastIndexOf(" (");
  if (detailsStart === -1 || !raw.endsWith(")")) {
    return { command: raw };
  }

  const command = raw.slice(0, detailsStart).trim();
  const details = raw.slice(detailsStart + 2, -1);
  const parts = details.split(",").map((part) => part.trim());
  let cwd: string | undefined;
  let timeoutMs: number | undefined;

  for (const part of parts) {
    if (part.startsWith("cwd=")) {
      cwd = part.slice("cwd=".length).trim();
      continue;
    }
    if (part.startsWith("timeout=")) {
      const parsed = Number.parseInt(part.slice("timeout=".length).replace(/ms$/i, ""), 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        timeoutMs = parsed;
      }
    }
  }

  return {
    command,
    cwd,
    timeoutMs
  };
}

function parseRunningMetrics(message: string): {
  commandName: string | null;
  elapsedSec: number;
  idleSec: number;
  stdoutChars: number;
  stderrChars: number;
} | null {
  const match =
    /^CLI command running: (.+?) \((\d+)ms elapsed, stdout=(\d+) chars, stderr=(\d+) chars, idle=(\d+)ms/.exec(message);
  if (!match) {
    return null;
  }

  const commandRaw = match[1]?.trim() ?? "";
  const elapsedMs = Number.parseInt(match[2], 10);
  const stdoutChars = Number.parseInt(match[3], 10);
  const stderrChars = Number.parseInt(match[4], 10);
  const idleMs = Number.parseInt(match[5], 10);
  const firstToken = commandRaw.split(/\s+/)[0] ?? commandRaw;
  const normalizedToken = firstToken.replace(/^['"]|['"]$/g, "");
  const lastSlashIndex = Math.max(normalizedToken.lastIndexOf("/"), normalizedToken.lastIndexOf("\\"));
  const commandName =
    lastSlashIndex >= 0 ? normalizedToken.slice(lastSlashIndex + 1).trim() : normalizedToken.trim();

  return {
    commandName: commandName.length > 0 ? commandName : null,
    elapsedSec: Math.max(0, Math.round(elapsedMs / 1000)),
    idleSec: Math.max(0, Math.round(idleMs / 1000)),
    stdoutChars: Math.max(0, stdoutChars),
    stderrChars: Math.max(0, stderrChars)
  };
}

function parseStreamChunk(message: string): { text: string; metadataOnly: boolean } | null | undefined {
  if (!message.startsWith("CLI stdout chunk:")) {
    return undefined;
  }

  const raw = message.slice("CLI stdout chunk:".length).trim();
  if (raw.length === 0 || raw === "\"\"") {
    return null;
  }

  let value = raw;
  if (value.startsWith("\"") && value.endsWith("\"")) {
    value = value.slice(1, -1);
  }

  value = value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (value.length === 0) {
    return null;
  }

  const lowered = value.toLowerCase();
  const metadataHits = STREAM_METADATA_MARKERS.filter((marker) => lowered.includes(marker)).length;
  const hasMeaningfulMarker = STREAM_MEANINGFUL_MARKERS.some((marker) => lowered.includes(marker));

  return {
    text: value,
    metadataOnly: metadataHits >= 2 && !hasMeaningfulMarker
  };
}

function extractThinkingHint(value: string): string | null {
  const lowered = value.toLowerCase();
  const phases = THINKING_PHASE_MARKERS.filter((marker) => lowered.includes(marker));
  if (phases.length === 0) {
    return null;
  }

  const unique = [...new Set(phases)];
  return `phase: ${unique.join(" · ")}`;
}

function parseModelCommandMessage(message: string): AttemptEventShape | null {
  if (!message.startsWith("Model command:")) {
    return null;
  }

  const raw = message.slice("Model command:".length).trim();
  if (raw.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const command = typeof record.command === "string" ? record.command.trim() : "";
      if (command.length === 0) {
        return null;
      }
      const tool = typeof record.tool === "string" ? record.tool.trim() : "";
      const cwd = typeof record.cwd === "string" ? record.cwd.trim() : undefined;
      const normalizedTool = tool.toLowerCase();
      const normalizedCommand = command.toLowerCase();
      const isShellTool =
        normalizedTool === "bash" ||
        normalizedTool === "shell" ||
        normalizedTool === "terminal" ||
        normalizedTool === "command" ||
        normalizedTool === "exec";
      const isShellCommand = isShellTool || normalizedCommand.startsWith("cd ") || normalizedCommand.includes(" && ");

      if (isShellCommand) {
        return {
          kind: "command",
          title: tool.length > 0 ? `Model shell command (${tool})` : "Model shell command",
          detail: tool.length > 0 ? `tool=${tool}` : undefined,
          command,
          cwd
        };
      }

      const actionLabel = normalizedCommand.startsWith("read ")
        ? "Read file"
        : normalizedCommand.startsWith("write ")
          ? "Write file"
          : normalizedCommand.startsWith("edit ")
            ? "Edit file"
            : normalizedCommand.startsWith("grep ")
              ? "Search text"
              : normalizedCommand.startsWith("glob ")
                ? "Find files"
                : tool.length > 0
                  ? tool
                  : "Action";

      return {
        kind: "tool",
        title: `Model tool action (${actionLabel})`,
        detail: tool.length > 0 ? `tool=${tool} · internal tool action (not terminal)` : "internal tool action (not terminal)",
        command,
        cwd
      };
    }
  } catch {
    // ignore and fall through to plain-text fallback
  }

  return {
    kind: "command",
    title: "Model shell command",
    command: raw
  };
}

function parseModelSummaryMessage(message: string): AttemptEventShape | null {
  if (!message.startsWith("Model summary:")) {
    return null;
  }

  const detail = message.slice("Model summary:".length).trim();
  if (detail.length === 0) {
    return null;
  }

  return {
    kind: "summary",
    title: "Model summary",
    detail
  };
}

function normalizeAttemptMessage(message: string): AttemptEventShape | null {
  if (!isRelevantAttemptMessage(message)) {
    return null;
  }

  const cliStart = parseCliStart(message);
  if (cliStart) {
    const timeoutText = typeof cliStart.timeoutMs === "number" ? `${Math.round(cliStart.timeoutMs / 1000)}s timeout` : undefined;
    return {
      kind: "command",
      title: "Command started",
      detail: timeoutText,
      command: cliStart.command,
      cwd: cliStart.cwd,
      timeoutMs: cliStart.timeoutMs
    };
  }

  if (message.startsWith("CLI command running:")) {
    // Hide provider heartbeat noise from user-facing timeline.
    return null;
  }

  const modelCommand = parseModelCommandMessage(message);
  if (modelCommand) {
    return modelCommand;
  }

  const modelSummary = parseModelSummaryMessage(message);
  if (modelSummary) {
    return modelSummary;
  }

  if (message.startsWith("CLI command completed")) {
    return {
      kind: "command",
      title: "Command completed",
      detail: message
    };
  }

  if (message.startsWith("CLI command timeout") || message.startsWith("CLI command aborted") || message.startsWith("CLI command exited")) {
    return {
      kind: "error",
      title: "Command stopped",
      detail: message
    };
  }

  if (message.startsWith("MCP call started:")) {
    return {
      kind: "tool",
      title: "Tool call started",
      detail: message.slice("MCP call started:".length).trim()
    };
  }

  if (message.startsWith("MCP call finished") || message.startsWith("MCP call failed") || message.startsWith("MCP call rejected")) {
    return {
      kind: message.startsWith("MCP call failed") ? "error" : "tool",
      title: message.startsWith("MCP call failed") ? "Tool call failed" : "Tool call update",
      detail: message
    };
  }

  const chunk = parseStreamChunk(message);
  if (chunk === null) {
    return null;
  }
  if (chunk) {
    if (chunk.metadataOnly) {
      const hint = extractThinkingHint(chunk.text);
      return {
        kind: "thinking",
        title: hint ? "Model thinking update" : "Model heartbeat",
        detail: hint ?? "Provider stream is active"
      };
    }
    return {
      kind: "output",
      title: "Model stream",
      detail: chunk.text
    };
  }

  if (message.startsWith("Provider round") && message.includes("started")) {
    return {
      kind: "thinking",
      title: "Model thinking",
      detail: message
    };
  }

  if (message.includes("failed") || message.includes("blocked by quality gates")) {
    return {
      kind: "error",
      title: "Step blocked",
      detail: message
    };
  }

  return {
    kind: "status",
    title: message
  };
}

function buildStepAttemptRegex(labels: string[]): RegExp | null {
  if (labels.length === 0) {
    return null;
  }

  const pattern = labels.map(escapeRegExp).join("|");
  return new RegExp(`^(?:${pattern}) \\[attempt (\\d+)\\] (.+)$`);
}

function buildQueuedRegex(labels: string[]): RegExp | null {
  if (labels.length === 0) {
    return null;
  }

  const pattern = labels.map(escapeRegExp).join("|");
  return new RegExp(`^Queued (?:${pattern})(?:\\b|\\s)(.*)$`);
}

function buildStartedRegex(labels: string[]): RegExp | null {
  if (labels.length === 0) {
    return null;
  }

  const pattern = labels.map(escapeRegExp).join("|");
  return new RegExp(`^(?:${pattern}) started \\(attempt (\\d+)\\)$`);
}

function buildCompletedRegex(labels: string[]): RegExp | null {
  if (labels.length === 0) {
    return null;
  }

  const pattern = labels.map(escapeRegExp).join("|");
  return new RegExp(`^(?:${pattern}) completed(?: \\(([^)]+)\\))?$`);
}

function buildFailedRegex(labels: string[]): RegExp | null {
  if (labels.length === 0) {
    return null;
  }

  const pattern = labels.map(escapeRegExp).join("|");
  return new RegExp(`^(?:${pattern}) failed: (.+)$`);
}

function buildSubagentRegex(labels: string[]): RegExp | null {
  if (labels.length === 0) {
    return null;
  }

  const pattern = labels.map(escapeRegExp).join("|");
  return new RegExp(`^Subagent-(\\d+) (started|finished|stopped): (?:${pattern})$`);
}

interface StepLifecycleMatchers {
  started: RegExp | null;
  completed: RegExp | null;
  failed: RegExp | null;
  queued: RegExp | null;
  subagent: RegExp | null;
}

function buildLifecycleMatchers(labels: string[]): StepLifecycleMatchers {
  return {
    started: buildStartedRegex(labels),
    completed: buildCompletedRegex(labels),
    failed: buildFailedRegex(labels),
    queued: buildQueuedRegex(labels),
    subagent: buildSubagentRegex(labels)
  };
}

function buildLifecycleEvent(logLine: string, matchers: StepLifecycleMatchers): AttemptEventShape | null {
  const startedMatch = matchers.started?.exec(logLine);
  if (startedMatch) {
    return {
      kind: "lifecycle",
      title: `Started attempt ${startedMatch[1]}`
    };
  }

  const completedMatch = matchers.completed?.exec(logLine);
  if (completedMatch) {
    const suffix = completedMatch[1]?.trim();
    return {
      kind: "lifecycle",
      title: suffix ? `Completed (${suffix})` : "Completed"
    };
  }

  const failedMatch = matchers.failed?.exec(logLine);
  if (failedMatch) {
    return {
      kind: "error",
      title: "Step failed",
      detail: failedMatch[1].trim()
    };
  }

  const queuedMatch = matchers.queued?.exec(logLine);
  if (queuedMatch) {
    const suffix = queuedMatch[1]?.trim();
    return {
      kind: "status",
      title: suffix.length > 0 ? `Queued ${suffix}` : "Queued"
    };
  }

  const subagentMatch = matchers.subagent?.exec(logLine);
  if (subagentMatch) {
    return {
      kind: "status",
      title: `Subagent-${subagentMatch[1]} ${subagentMatch[2]}`
    };
  }

  return null;
}

export function deriveStepLiveActivityEvents(
  run: PipelineRun | null | undefined,
  step: PipelinePayload["steps"][number],
  maxEvents = DEFAULT_MAX_ACTIVITY_EVENTS
): StepLiveActivityEvent[] {
  if (!run || !Array.isArray(run.logs) || run.logs.length === 0) {
    return [];
  }

  const labels = resolveStepLabels(run, step);
  if (labels.length === 0) {
    return [];
  }

  const attemptRegex = buildStepAttemptRegex(labels);
  if (!attemptRegex) {
    return [];
  }

  const lifecycleMatchers = buildLifecycleMatchers(labels);
  const events: StepLiveActivityEvent[] = [];

  for (let lineIndex = 0; lineIndex < run.logs.length; lineIndex += 1) {
    const line = run.logs[lineIndex];
    const attemptMatch = attemptRegex.exec(line);
    if (attemptMatch) {
      const attempt = Number.parseInt(attemptMatch[1], 10);
      const normalized = normalizeAttemptMessage(attemptMatch[2].trim());
      if (normalized) {
        events.push({
          id: `${lineIndex}-attempt-${attempt}`,
          kind: normalized.kind,
          attempt: Number.isNaN(attempt) ? undefined : attempt,
          title: normalized.title,
          detail: normalized.detail,
          command: normalized.command,
          cwd: normalized.cwd,
          timeoutMs: normalized.timeoutMs,
          line
        });
      }
      continue;
    }

    const lifecycle = buildLifecycleEvent(line, lifecycleMatchers);
    if (lifecycle) {
      events.push({
        id: `${lineIndex}-step`,
        kind: lifecycle.kind,
        title: lifecycle.title,
        detail: lifecycle.detail,
        line
      });
    }
  }

  if (maxEvents <= 0) {
    return events;
  }
  return events.slice(-maxEvents);
}

function formatActivityLine(event: StepLiveActivityEvent): string {
  const attemptPrefix = typeof event.attempt === "number" ? `[attempt ${event.attempt}]` : "[step]";

  if (event.kind === "command") {
    const parts: string[] = [];
    if (event.command) {
      parts.push(event.command);
    }
    if (event.cwd) {
      parts.push(`cwd=${event.cwd}`);
    }
    if (typeof event.timeoutMs === "number") {
      parts.push(`timeout=${event.timeoutMs}ms`);
    }
    if (event.detail) {
      parts.push(event.detail);
    }
    return `${attemptPrefix} ${event.title}${parts.length > 0 ? `: ${parts.join(" | ")}` : ""}`;
  }

  return `${attemptPrefix} ${event.title}${event.detail ? `: ${event.detail}` : ""}`;
}

export function deriveStepLiveActivityLines(
  run: PipelineRun | null | undefined,
  step: PipelinePayload["steps"][number],
  maxLines = DEFAULT_MAX_ACTIVITY_EVENTS
): string[] {
  return deriveStepLiveActivityEvents(run, step, maxLines).map(formatActivityLine);
}
