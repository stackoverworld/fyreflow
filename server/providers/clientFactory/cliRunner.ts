import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { createAbortError } from "../../abort.js";
import type { CommandResult, ProviderExecutionInput } from "../types.js";
import { CLAUDE_CLI_FALLBACK_MODEL, resolveClaudeCliAttemptTimeoutMs } from "../retryPolicy.js";
import { composeCliPrompt, mapClaudeEffort } from "../normalizers.js";
import {
  CLAUDE_CLI_COMMAND,
  CLI_EXEC_TIMEOUT_MS,
  CODEX_CLI_COMMAND,
  applyClaudeCompatibilityFlags,
  applyClaudeNonInteractiveFlags,
  isUnknownClaudeOptionError
} from "./config.js";

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

export async function executeViaCli(input: ProviderExecutionInput): Promise<string> {
  if (input.provider.id === "openai") {
    return runCodexCli(input);
  }

  return runClaudeCli(input);
}
