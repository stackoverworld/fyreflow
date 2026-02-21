import { spawn } from "node:child_process";
import { createAbortError } from "../abort.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  stdinInput: string | undefined,
  timeoutMs: number,
  extraEnv?: Record<string, string>,
  signal?: AbortSignal
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(extraEnv ?? {})
      }
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
      finish(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    const abortListener = signal
      ? () => {
          child.kill("SIGTERM");
          const reason = signal.reason;
          const reasonMessage =
            reason instanceof Error ? reason.message : typeof reason === "string" ? reason : `${command} aborted`;
          finish(() => reject(createAbortError(reasonMessage)));
        }
      : null;

    if (signal?.aborted) {
      if (abortListener) {
        abortListener();
      } else {
        const reason = signal.reason;
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

      finish(() => reject(new Error(`${command} exited with code ${code}: ${(stderr || stdout).slice(0, 500)}`)));
    });

    if (stdinInput && stdinInput.length > 0) {
      child.stdin.write(stdinInput);
    }
    child.stdin.end();
  });
}
