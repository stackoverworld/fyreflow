import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);
const DEFAULT_CAPTURE_TIMEOUT_MS = 5_000;
const DEFAULT_CAPTURE_POLL_INTERVAL_MS = 150;
const DEFAULT_CAPTURE_STABLE_POLLS = 2;
const DEFAULT_EMPTY_CAPTURE_GRACE_MS = 1_500;
const DEFAULT_CAPTURE_MAX_BYTES = 16 * 1024;
const CAPTURE_LOG_RETENTION_MS = 5 * 60 * 1_000;

export interface LaunchDetachedCaptureOptions {
  captureTimeoutMs?: number;
  pollIntervalMs?: number;
  maxBytes?: number;
}

export interface LaunchDetachedCaptureResult {
  capturedOutput: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readFileTail(filePath: string, maxBytes: number): string {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size <= 0) {
      return "";
    }

    const length = Math.min(maxBytes, stats.size);
    const start = stats.size - length;
    const descriptor = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(descriptor, buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return "";
  }
}

function scheduleCaptureLogCleanup(filePath: string): void {
  const timer = setTimeout(() => {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore cleanup failures.
    }
  }, CAPTURE_LOG_RETENTION_MS);
  timer.unref();
}

async function waitForCapturedOutput(
  filePath: string,
  options: Required<Pick<LaunchDetachedCaptureOptions, "captureTimeoutMs" | "pollIntervalMs" | "maxBytes">>
): Promise<string> {
  const startedAt = Date.now();
  let output = "";
  let stablePollCount = 0;

  while (Date.now() - startedAt < options.captureTimeoutMs) {
    const nextOutput = readFileTail(filePath, options.maxBytes);
    if (nextOutput.length === 0 && Date.now() - startedAt >= DEFAULT_EMPTY_CAPTURE_GRACE_MS) {
      break;
    }

    if (nextOutput === output) {
      if (nextOutput.length > 0) {
        stablePollCount += 1;
        if (stablePollCount >= DEFAULT_CAPTURE_STABLE_POLLS) {
          break;
        }
      }
    } else {
      output = nextOutput;
      stablePollCount = 0;
    }

    await sleep(options.pollIntervalMs);
  }

  const finalOutput = readFileTail(filePath, options.maxBytes);
  return finalOutput.length > 0 ? finalOutput : output;
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  const normalizedCommand = command.trim();
  if (normalizedCommand.length === 0) {
    return false;
  }

  const hasPathSeparator = normalizedCommand.includes("/") || normalizedCommand.includes("\\");
  if (hasPathSeparator) {
    try {
      await access(normalizedCommand, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === "win32") {
    try {
      await execFileAsync("where", [normalizedCommand], { timeout: 6000 });
      return true;
    } catch {
      return false;
    }
  }

  try {
    await execFileAsync("which", [normalizedCommand], { timeout: 6000 });
    return true;
  } catch {
    return false;
  }
}

export function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export async function launchDetachedAndCapture(
  command: string,
  args: string[],
  options: LaunchDetachedCaptureOptions = {}
): Promise<LaunchDetachedCaptureResult> {
  const captureTimeoutMs = options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_CAPTURE_POLL_INTERVAL_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_CAPTURE_MAX_BYTES;
  const captureLogPath = path.join(
    os.tmpdir(),
    `fyreflow-oauth-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.log`
  );
  const logDescriptor = fs.openSync(captureLogPath, "a");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        detached: true,
        stdio: ["ignore", logDescriptor, logDescriptor]
      });

      child.once("error", (error) => {
        reject(error);
      });

      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    fs.closeSync(logDescriptor);
  }

  const capturedOutput = await waitForCapturedOutput(captureLogPath, {
    captureTimeoutMs,
    pollIntervalMs,
    maxBytes
  });
  scheduleCaptureLogCleanup(captureLogPath);

  return { capturedOutput };
}
