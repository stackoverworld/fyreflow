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
const DEFAULT_CAPTURE_SETTLE_MS = 600;
const DEFAULT_CAPTURE_MAX_BYTES = 16 * 1024;
const CAPTURE_LOG_RETENTION_MS = 5 * 60 * 1_000;

export interface LaunchDetachedCaptureOptions {
  captureTimeoutMs?: number;
  pollIntervalMs?: number;
  settleTimeMs?: number;
  maxBytes?: number;
  isOutputSufficient?: (capturedOutput: string) => boolean;
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
  options: Required<Pick<LaunchDetachedCaptureOptions, "captureTimeoutMs" | "pollIntervalMs" | "settleTimeMs" | "maxBytes">> &
    Pick<LaunchDetachedCaptureOptions, "isOutputSufficient">
): Promise<string> {
  const startedAt = Date.now();
  let output = "";
  let lastOutputChangeAt = startedAt;

  while (Date.now() - startedAt < options.captureTimeoutMs) {
    const nextOutput = readFileTail(filePath, options.maxBytes);
    if (nextOutput !== output) {
      output = nextOutput;
      lastOutputChangeAt = Date.now();
    } else if (nextOutput.length > 0 && Date.now() - lastOutputChangeAt >= options.settleTimeMs) {
      if (!options.isOutputSufficient || options.isOutputSufficient(output)) {
        break;
      }
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
  const settleTimeMs = options.settleTimeMs ?? DEFAULT_CAPTURE_SETTLE_MS;
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
    settleTimeMs,
    maxBytes,
    isOutputSufficient: options.isOutputSufficient
  });
  scheduleCaptureLogCleanup(captureLogPath);

  return { capturedOutput };
}
