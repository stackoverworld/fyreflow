import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLAUDE_DEFAULT_URL = "https://api.anthropic.com/v1";
export const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";
export const CLI_EXEC_TIMEOUT_MS = 1_200_000;

const LOCAL_BIN_DIR = path.join(os.homedir(), ".local", "bin");
const CODEX_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "codex");
const CLAUDE_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "claude");

export const CODEX_CLI_COMMAND =
  (process.env.CODEX_CLI_PATH ?? "").trim() || (fsSync.existsSync(CODEX_LOCAL_BIN_PATH) ? CODEX_LOCAL_BIN_PATH : "codex");
export const CLAUDE_CLI_COMMAND =
  (process.env.CLAUDE_CLI_PATH ?? "").trim() || (fsSync.existsSync(CLAUDE_LOCAL_BIN_PATH) ? CLAUDE_LOCAL_BIN_PATH : "claude");

const CLAUDE_CLI_SKIP_PERMISSIONS = (process.env.CLAUDE_CLI_SKIP_PERMISSIONS ?? "1").trim() !== "0";
const CLAUDE_CLI_STRICT_MCP = (process.env.CLAUDE_CLI_STRICT_MCP ?? "1").trim() !== "0";
const CLAUDE_CLI_DISABLE_SLASH_COMMANDS = (process.env.CLAUDE_CLI_DISABLE_SLASH_COMMANDS ?? "1").trim() !== "0";
const CLAUDE_CLI_SETTING_SOURCES = (process.env.CLAUDE_CLI_SETTING_SOURCES ?? "user").trim();

const CLAUDE_CLI_PERMISSION_MODE = (() => {
  const candidate = (process.env.CLAUDE_CLI_PERMISSION_MODE ?? "bypassPermissions").trim();
  const allowed = new Set(["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan"]);
  return allowed.has(candidate) ? candidate : "bypassPermissions";
})();

export function applyClaudeNonInteractiveFlags(args: string[]): void {
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

export function applyClaudeCompatibilityFlags(args: string[]): void {
  args.push("--no-session-persistence");
  if (CLAUDE_CLI_SKIP_PERMISSIONS) {
    args.push("--dangerously-skip-permissions");
    return;
  }
  args.push("--permission-mode", CLAUDE_CLI_PERMISSION_MODE);
}

export function isUnknownClaudeOptionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\bunknown\b.+\b(option|argument)\b|did you mean|unrecognized option/i.test(error.message);
}
