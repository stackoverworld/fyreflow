import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ComposeRuntimeConfig {
  dockerBinary: string;
  composeFilePath: string;
  composeEnvFilePath: string;
  coreServiceName: string;
}

export async function runComposeCommand(
  config: ComposeRuntimeConfig,
  commandArgs: string[],
  timeoutMs: number
): Promise<void> {
  const args = [
    "compose",
    "--env-file",
    config.composeEnvFilePath,
    "-f",
    config.composeFilePath,
    ...commandArgs
  ];

  try {
    await execFileAsync(config.dockerBinary, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`docker compose ${commandArgs.join(" ")} failed: ${message}`);
  }
}

export async function pullAndRestartCoreService(config: ComposeRuntimeConfig, timeoutMs: number): Promise<void> {
  await runComposeCommand(config, ["pull", config.coreServiceName], timeoutMs);
  await runComposeCommand(config, ["up", "-d", "--no-deps", config.coreServiceName], timeoutMs);
}
