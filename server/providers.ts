import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { PipelineStep, ProviderConfig, ReasoningEffort } from "./types.js";
import { getCachedCodexAccessToken, getProviderOAuthStatus } from "./oauth.js";
import { createAbortError, isAbortError, mergeAbortSignals } from "./abort.js";

const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";
const CLAUDE_DEFAULT_URL = "https://api.anthropic.com/v1";
const CLI_EXEC_TIMEOUT_MS = 1_200_000;
const LOCAL_BIN_DIR = path.join(os.homedir(), ".local", "bin");
const CODEX_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "codex");
const CLAUDE_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "claude");
const CODEX_CLI_COMMAND =
  (process.env.CODEX_CLI_PATH ?? "").trim() || (fsSync.existsSync(CODEX_LOCAL_BIN_PATH) ? CODEX_LOCAL_BIN_PATH : "codex");
const CLAUDE_CLI_COMMAND =
  (process.env.CLAUDE_CLI_PATH ?? "").trim() ||
  (fsSync.existsSync(CLAUDE_LOCAL_BIN_PATH) ? CLAUDE_LOCAL_BIN_PATH : "claude");
const CLAUDE_CLI_SKIP_PERMISSIONS = (process.env.CLAUDE_CLI_SKIP_PERMISSIONS ?? "1").trim() !== "0";
const CLAUDE_CLI_STRICT_MCP = (process.env.CLAUDE_CLI_STRICT_MCP ?? "1").trim() !== "0";
const CLAUDE_CLI_DISABLE_SLASH_COMMANDS = (process.env.CLAUDE_CLI_DISABLE_SLASH_COMMANDS ?? "1").trim() !== "0";
const CLAUDE_CLI_SETTING_SOURCES = (process.env.CLAUDE_CLI_SETTING_SOURCES ?? "user").trim();
const CLAUDE_CLI_FALLBACK_MODEL = (process.env.CLAUDE_CLI_FALLBACK_MODEL ?? "claude-sonnet-4-6").trim();
const CLAUDE_CLI_BASE_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_BASE_TIMEOUT_MS ?? "300000", 10);
  if (!Number.isFinite(raw)) {
    return 300_000;
  }
  return Math.max(60_000, Math.min(1_200_000, raw));
})();
const CLAUDE_CLI_HEAVY_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_HEAVY_TIMEOUT_MS ?? "420000", 10);
  if (!Number.isFinite(raw)) {
    return 420_000;
  }
  return Math.max(120_000, Math.min(1_200_000, raw));
})();
const CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS ?? "180000", 10);
  if (!Number.isFinite(raw)) {
    return 180_000;
  }
  return Math.max(60_000, Math.min(900_000, raw));
})();
const CLAUDE_CLI_PERMISSION_MODE = (() => {
  const candidate = (process.env.CLAUDE_CLI_PERMISSION_MODE ?? "bypassPermissions").trim();
  const allowed = new Set(["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan"]);
  return allowed.has(candidate) ? candidate : "bypassPermissions";
})();

function applyClaudeNonInteractiveFlags(args: string[]): void {
  args.push("--no-session-persistence");
  if (CLAUDE_CLI_SETTING_SOURCES.length > 0) {
    args.push("--setting-sources", CLAUDE_CLI_SETTING_SOURCES);
  }
  if (CLAUDE_CLI_STRICT_MCP) {
    args.push("--strict-mcp-config");
  }
  if (CLAUDE_CLI_DISABLE_SLASH_COMMANDS) {
    args.push("--disable-slash-commands");
  }

  if (CLAUDE_CLI_SKIP_PERMISSIONS) {
    args.push("--dangerously-skip-permissions");
    return;
  }

  args.push("--permission-mode", CLAUDE_CLI_PERMISSION_MODE);
}

function applyClaudeCompatibilityFlags(args: string[]): void {
  args.push("--no-session-persistence");
  if (CLAUDE_CLI_SKIP_PERMISSIONS) {
    args.push("--dangerously-skip-permissions");
    return;
  }
  args.push("--permission-mode", CLAUDE_CLI_PERMISSION_MODE);
}

function isUnknownClaudeOptionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\bunknown\b.+\b(option|argument)\b|did you mean|unrecognized option/i.test(error.message);
}

type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";
type ClaudeEffort = "low" | "medium" | "high";

export interface ProviderExecutionInput {
  provider: ProviderConfig;
  step: PipelineStep;
  context: string;
  task: string;
  outputMode?: "markdown" | "json";
  signal?: AbortSignal;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface ClaudeApiOptions {
  disable1MContext?: boolean;
  disableEffort?: boolean;
}

function credentialFromProvider(provider: ProviderConfig): string | undefined {
  if (provider.authMode === "oauth") {
    const token = provider.oauthToken.trim();
    return token.length > 0 ? token : undefined;
  }

  const apiKey = provider.apiKey.trim();
  return apiKey.length > 0 ? apiKey : undefined;
}

function mapOpenAIReasoningEffort(value: ReasoningEffort): OpenAIReasoningEffort {
  if (value === "xhigh") {
    return "high";
  }

  return value;
}

function mapClaudeEffort(value: ReasoningEffort): ClaudeEffort {
  if (value === "minimal" || value === "low") {
    return "low";
  }
  if (value === "xhigh" || value === "high") {
    return "high";
  }
  return "medium";
}

function extractOpenAIText(responseBody: unknown): string {
  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "output_text" in responseBody &&
    typeof (responseBody as { output_text?: unknown }).output_text === "string"
  ) {
    return (responseBody as { output_text: string }).output_text;
  }

  if (typeof responseBody === "object" && responseBody !== null && "output" in responseBody) {
    const output = (responseBody as { output?: unknown }).output;
    if (Array.isArray(output)) {
      const chunks: string[] = [];
      for (const item of output) {
        if (typeof item !== "object" || item === null || !("content" in item)) {
          continue;
        }
        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) {
          continue;
        }
        for (const block of content) {
          if (typeof block === "object" && block !== null && "text" in block) {
            const text = (block as { text?: unknown }).text;
            if (typeof text === "string") {
              chunks.push(text);
            }
          }
        }
      }
      if (chunks.length > 0) {
        return chunks.join("\n");
      }
    }
  }

  return "Provider returned no text output.";
}

function extractClaudeText(responseBody: unknown): string {
  if (typeof responseBody !== "object" || responseBody === null || !("content" in responseBody)) {
    return "Provider returned no text output.";
  }

  const content = (responseBody as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "Provider returned no text output.";
  }

  const segments: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null && "text" in block) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") {
        segments.push(text);
      }
    }
  }

  if (segments.length === 0) {
    return "Provider returned no text output.";
  }

  return segments.join("\n");
}

function composeCliPrompt(input: ProviderExecutionInput): string {
  const outputInstruction =
    input.outputMode === "json"
      ? "Return STRICT JSON only. No markdown fences. No prose before or after the JSON object."
      : "Return only the step output in concise markdown.";
  const scopeInstruction =
    input.step.role === "orchestrator"
      ? [
          "This is a single orchestrator turn, not a full end-to-end run.",
          "Do not simulate downstream stages yourself.",
          "Return only the immediate orchestration decision, routing/status update, and what should run next."
        ].join("\n")
      : "";

  const sections = [
    `System instructions:\n${input.step.prompt}`,
    "",
    `Runtime options:\n- reasoning_effort=${input.step.reasoningEffort}\n- fast_mode=${input.step.fastMode ? "on" : "off"}\n- one_million_context=${input.step.use1MContext ? "on" : "off"}\n- context_window_tokens=${input.step.contextWindowTokens.toLocaleString()}`
  ];

  if (scopeInstruction.length > 0) {
    sections.push("", `Execution contract:\n${scopeInstruction}`);
  }

  sections.push("", `Task:\n${input.task}`, "", `Context:\n${input.context}`, "", outputInstruction);
  return sections.join("\n");
}

function buildClaudeSystemPrompt(step: PipelineStep, outputMode: ProviderExecutionInput["outputMode"]): string {
  const notes: string[] = [step.prompt];

  if (step.fastMode) {
    notes.push("Fast mode requested: prioritize lower latency with concise output when possible.");
  }

  if (step.use1MContext) {
    notes.push("1M context mode requested for compatible Sonnet/Opus models.");
  }

  if (outputMode === "json") {
    notes.push("Output must be STRICT JSON only, as a single object, with no markdown fences or extra narration.");
  }

  return notes.join("\n\n");
}

function runCommand(
  command: string,
  args: string[],
  stdinInput?: string,
  timeoutMs = 240000,
  signal?: AbortSignal
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
      fn();
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`${command} timed out`)));
    }, timeoutMs);

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
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      finish(() => reject(error));
    });

    child.once("close", (code) => {
      if (code === 0) {
        finish(() => resolve({ stdout, stderr }));
        return;
      }

      finish(() => reject(new Error(`${command} exited with code ${code}: ${(stderr || stdout).slice(0, 520)}`)));
    });

    if (stdinInput && stdinInput.length > 0) {
      child.stdin.write(stdinInput);
    }
    child.stdin.end();
  });
}

function resolveClaudeCliAttemptTimeoutMs(step: PipelineStep, providerDefaultModel: string): number {
  const model = (step.model || providerDefaultModel || "").toLowerCase();
  if (step.role === "orchestrator") {
    return CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS;
  }
  if (step.use1MContext || step.contextWindowTokens >= 500_000 || model.includes("opus")) {
    return CLAUDE_CLI_HEAVY_TIMEOUT_MS;
  }
  return CLAUDE_CLI_BASE_TIMEOUT_MS;
}

function trimContextForRetry(context: string, maxChars: number): string {
  if (context.length <= maxChars) {
    return context;
  }

  const lead = Math.floor(maxChars * 0.65);
  const trail = Math.floor(maxChars * 0.3);
  const head = context.slice(0, lead);
  const tail = context.slice(context.length - trail);
  return `${head}\n\n[Context trimmed for timeout fallback]\n\n${tail}`;
}

function shouldTryClaudeTimeoutFallback(input: ProviderExecutionInput, error: unknown): boolean {
  if (input.provider.id !== "claude") {
    return false;
  }
  if (input.signal?.aborted) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (!(isAbortError(error) || /\btimed?\s*out\b|etimedout|timeout/i.test(message))) {
    return false;
  }

  const model = (input.step.model || input.provider.defaultModel || "").toLowerCase();
  const alreadyFast =
    input.step.fastMode &&
    (input.step.reasoningEffort === "low" || input.step.reasoningEffort === "minimal") &&
    !input.step.use1MContext &&
    !model.includes("opus");
  return !alreadyFast;
}

function buildClaudeTimeoutFallbackInput(input: ProviderExecutionInput): ProviderExecutionInput {
  const currentModel = (input.step.model || input.provider.defaultModel || "").trim();
  const shouldSwitchToFallbackModel = currentModel.length === 0 || currentModel.toLowerCase().includes("opus");
  const nextModel =
    shouldSwitchToFallbackModel && CLAUDE_CLI_FALLBACK_MODEL.length > 0 ? CLAUDE_CLI_FALLBACK_MODEL : currentModel;
  const maxChars = input.step.role === "orchestrator" ? 120_000 : 220_000;

  return {
    ...input,
    context: trimContextForRetry(input.context, maxChars),
    step: {
      ...input.step,
      model: nextModel,
      fastMode: true,
      reasoningEffort: "low",
      use1MContext: false,
      contextWindowTokens: Math.min(input.step.contextWindowTokens, 220_000)
    }
  };
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
      input.signal
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

async function runClaudeCli(input: ProviderExecutionInput): Promise<string> {
  const prompt = composeCliPrompt(input);
  const selectedModel = input.step.model || input.provider.defaultModel;
  const timeoutMs = resolveClaudeCliAttemptTimeoutMs(input.step, input.provider.defaultModel);
  const buildArgs = (compatibilityMode = false): string[] => {
    const args = ["--print", "--output-format", "text"];
    if (compatibilityMode) {
      applyClaudeCompatibilityFlags(args);
    } else {
      applyClaudeNonInteractiveFlags(args);
    }
    args.push("--model", selectedModel);
    if (!compatibilityMode) {
      args.push("--effort", mapClaudeEffort(input.step.reasoningEffort));
    }
    if (CLAUDE_CLI_FALLBACK_MODEL.length > 0 && CLAUDE_CLI_FALLBACK_MODEL !== selectedModel) {
      args.push("--fallback-model", CLAUDE_CLI_FALLBACK_MODEL);
    }

    if (input.step.fastMode) {
      args.push("--append-system-prompt", "Fast mode requested. Prioritize lower latency and concise responses.");
    }

    if (input.step.use1MContext) {
      args.push("--append-system-prompt", "1M context mode requested for compatible Sonnet/Opus models.");
    }

    args.push(prompt);
    return args;
  };

  let stdout = "";
  try {
    ({ stdout } = await runCommand(CLAUDE_CLI_COMMAND, buildArgs(false), undefined, timeoutMs, input.signal));
  } catch (error) {
    if (!isUnknownClaudeOptionError(error)) {
      throw error;
    }
    ({ stdout } = await runCommand(CLAUDE_CLI_COMMAND, buildArgs(true), undefined, timeoutMs, input.signal));
  }
  const trimmed = stdout.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  return "Claude CLI completed with no text output.";
}

async function executeViaCli(input: ProviderExecutionInput): Promise<string> {
  if (input.provider.id === "openai") {
    return runCodexCli(input);
  }

  return runClaudeCli(input);
}

async function executeOpenAIWithApi(input: ProviderExecutionInput, credential: string): Promise<string> {
  const endpoint = `${(input.provider.baseUrl || OPENAI_DEFAULT_URL).replace(/\/$/, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`
    },
    body: JSON.stringify({
      model: input.step.model || input.provider.defaultModel,
      input: [
        { role: "system", content: input.step.prompt },
        { role: "user", content: input.context }
      ],
      reasoning: {
        effort: mapOpenAIReasoningEffort(input.step.reasoningEffort)
      }
    }),
    signal: input.signal
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorBody.slice(0, 320)}`);
  }

  const body = (await response.json()) as unknown;
  return extractOpenAIText(body);
}

async function executeClaudeWithApi(
  input: ProviderExecutionInput,
  credential: string,
  options?: ClaudeApiOptions
): Promise<string> {
  const endpoint = `${(input.provider.baseUrl || CLAUDE_DEFAULT_URL).replace(/\/$/, "")}/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01"
  };

  const betas: string[] = [];
  if (options?.disableEffort !== true) {
    betas.push("effort-2025-11-24");
  }
  if (input.step.use1MContext && options?.disable1MContext !== true) {
    betas.push("context-1m-2025-08-07");
  }
  if (betas.length > 0) {
    headers["anthropic-beta"] = betas.join(",");
  }

  if (input.provider.authMode === "oauth") {
    headers.Authorization = `Bearer ${credential}`;
  } else {
    headers["x-api-key"] = credential;
  }

  const requestBody: Record<string, unknown> = {
    model: input.step.model || input.provider.defaultModel,
    max_tokens: Math.max(1200, Math.min(6400, Math.floor(input.step.contextWindowTokens * 0.02))),
    system: buildClaudeSystemPrompt(input.step, input.outputMode),
    messages: [{ role: "user", content: input.context }]
  };

  if (options?.disableEffort !== true) {
    requestBody.output_config = {
      effort: mapClaudeEffort(input.step.reasoningEffort)
    };
  }

  const requestSignal = mergeAbortSignals([input.signal]);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: requestSignal
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude request failed (${response.status}): ${errorBody.slice(0, 320)}`);
  }

  const body = (await response.json()) as unknown;
  return extractClaudeText(body);
}

export async function executeProviderStep(input: ProviderExecutionInput): Promise<string> {
  let credential = credentialFromProvider(input.provider);
  const hasExplicitApiKey = input.provider.apiKey.trim().length > 0;
  let oauthStatus:
    | {
        canUseApi: boolean;
        canUseCli: boolean;
        message: string;
      }
    | null = null;

  if (!credential && input.provider.id === "openai") {
    credential = getCachedCodexAccessToken();
  }

  if (!credential && input.provider.authMode === "oauth") {
    try {
      oauthStatus = await getProviderOAuthStatus(input.provider.id);
    } catch {
      oauthStatus = null;
    }
  }

  if (!credential) {
    if (input.provider.authMode === "oauth" && oauthStatus && !oauthStatus.canUseCli && !oauthStatus.canUseApi) {
      throw new Error(`Provider OAuth is not ready. ${oauthStatus.message} Open Provider Auth and reconnect.`);
    }

    try {
      return await executeViaCli(input);
    } catch (error) {
      let retryFailureDetails = "";
      if (shouldTryClaudeTimeoutFallback(input, error)) {
        try {
          return await executeViaCli(buildClaudeTimeoutFallbackInput(input));
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : "retry failed";
          retryFailureDetails = ` Timeout fallback retry failed: ${retryMessage}`;
        }
      }

      const message = error instanceof Error ? error.message : "CLI execution failed";
      const timeoutHint =
        isAbortError(error) || /\btimed?\s*out\b/i.test(message)
          ? "CLI execution timed out or was aborted. Increase stageTimeoutMs or use a lower-latency model."
          : "CLI fallback failed.";
      let credentialHint: string;
      if (input.provider.authMode === "oauth") {
        credentialHint =
          oauthStatus?.canUseCli || oauthStatus?.canUseApi
            ? "Provider OAuth is ready via CLI (dashboard token may stay empty in CLI-managed mode)."
            : "No provider OAuth token is stored in dashboard settings and provider CLI OAuth is not ready.";
      } else {
        credentialHint = "No provider API credentials are stored in dashboard settings.";
      }

      throw new Error(`${credentialHint} ${timeoutHint} Details: ${message}${retryFailureDetails}`);
    }
  }

  try {
    if (input.provider.id === "claude") {
      try {
        return await executeClaudeWithApi(input, credential);
      } catch (error) {
        const fallbackOptions: ClaudeApiOptions[] = [
          { disable1MContext: true },
          { disableEffort: true },
          { disable1MContext: true, disableEffort: true }
        ];

        for (const options of fallbackOptions) {
          try {
            return await executeClaudeWithApi(input, credential, options);
          } catch {
            // Try next fallback.
          }
        }

        throw error;
      }
    }

    return await executeOpenAIWithApi(input, credential);
  } catch (error) {
    if (input.provider.authMode !== "oauth" && hasExplicitApiKey) {
      throw error;
    }

    try {
      return await executeViaCli(input);
    } catch (cliError) {
      const apiMessage = error instanceof Error ? error.message : "Provider API request failed";
      const cliMessage = cliError instanceof Error ? cliError.message : "CLI execution failed";
      throw new Error(`${apiMessage}; CLI fallback failed: ${cliMessage}`);
    }
  }
}
