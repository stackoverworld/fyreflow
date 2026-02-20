import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { PipelineStep, ProviderConfig, ReasoningEffort } from "./types.js";
import { getCachedCodexAccessToken } from "./oauth.js";

const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";
const CLAUDE_DEFAULT_URL = "https://api.anthropic.com/v1";

type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";
type ClaudeEffort = "low" | "medium" | "high";

export interface ProviderExecutionInput {
  provider: ProviderConfig;
  step: PipelineStep;
  context: string;
  task: string;
  outputMode?: "markdown" | "json";
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

function simulatedOutput(input: ProviderExecutionInput, reason: string): string {
  const summary = input.context.split("\n").slice(0, 8).join("\n");
  return [
    `[Simulated ${input.provider.label} response: ${reason}]`,
    `Step: ${input.step.name} (${input.step.role})`,
    "",
    "Output summary:",
    `- Focused on task requirements and role-specific deliverable`,
    `- Reasoning effort requested: ${input.step.reasoningEffort}`,
    `- Fast mode requested: ${input.step.fastMode ? "yes" : "no"}`,
    `- 1M context requested: ${input.step.use1MContext ? "yes" : "no"}`,
    `- Model configured: ${input.step.model}`,
    "",
    "Context snapshot:",
    summary
  ].join("\n");
}

function composeCliPrompt(input: ProviderExecutionInput): string {
  const outputInstruction =
    input.outputMode === "json"
      ? "Return STRICT JSON only. No markdown fences. No prose before or after the JSON object."
      : "Return only the step output in concise markdown.";

  return [
    `System instructions:\n${input.step.prompt}`,
    "",
    `Runtime options:\n- reasoning_effort=${input.step.reasoningEffort}\n- fast_mode=${input.step.fastMode ? "on" : "off"}\n- one_million_context=${input.step.use1MContext ? "on" : "off"}\n- context_window_tokens=${input.step.contextWindowTokens.toLocaleString()}`,
    "",
    `Task:\n${input.task}`,
    "",
    `Context:\n${input.context}`,
    "",
    outputInstruction
  ].join("\n");
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

function runCommand(command: string, args: string[], stdinInput?: string, timeoutMs = 240000): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${(stderr || stdout).slice(0, 520)}`));
    });

    if (stdinInput && stdinInput.length > 0) {
      child.stdin.write(stdinInput);
    }
    child.stdin.end();
  });
}

async function runCodexCli(input: ProviderExecutionInput): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-dashboard-codex-"));
  const outputPath = path.join(tempDir, `last-message-${Date.now()}.txt`);

  try {
    const prompt = composeCliPrompt(input);
    await runCommand(
      "codex",
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
      300000
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
  const args = ["--print", "--output-format", "text", "--model", input.step.model || input.provider.defaultModel];

  if (input.step.fastMode) {
    args.push("--append-system-prompt", "Fast mode requested. Prioritize lower latency and concise responses.");
  }

  if (input.step.use1MContext) {
    args.push("--append-system-prompt", "1M context mode requested for compatible Sonnet/Opus models.");
  }

  args.push(prompt);

  const { stdout } = await runCommand("claude", args, undefined, 300000);
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
    })
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

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
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

  if (!credential && input.provider.id === "openai") {
    credential = getCachedCodexAccessToken();
  }

  if (!credential) {
    try {
      return await executeViaCli(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CLI execution failed";
      if (input.provider.authMode === "oauth") {
        return simulatedOutput(input, `oauth credentials missing and CLI fallback failed: ${message}`);
      }
      return simulatedOutput(input, `missing credentials and CLI fallback failed: ${message}`);
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
    } catch {
      throw error;
    }
  }
}
