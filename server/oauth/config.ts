import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const LOCAL_BIN_DIR = path.join(os.homedir(), ".local", "bin");
const CODEX_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "codex");
const CLAUDE_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "claude");

export const CODEX_CLI_COMMAND =
  (process.env.CODEX_CLI_PATH ?? "").trim() || (fs.existsSync(CODEX_LOCAL_BIN_PATH) ? CODEX_LOCAL_BIN_PATH : "codex");
export const CLAUDE_CLI_COMMAND =
  (process.env.CLAUDE_CLI_PATH ?? "").trim() ||
  (fs.existsSync(CLAUDE_LOCAL_BIN_PATH) ? CLAUDE_LOCAL_BIN_PATH : "claude");

export const CLAUDE_CLI_SKIP_PERMISSIONS = (process.env.CLAUDE_CLI_SKIP_PERMISSIONS ?? "1").trim() !== "0";
export const CLAUDE_CLI_STRICT_MCP = (process.env.CLAUDE_CLI_STRICT_MCP ?? "1").trim() !== "0";
export const CLAUDE_CLI_DISABLE_SLASH_COMMANDS = (process.env.CLAUDE_CLI_DISABLE_SLASH_COMMANDS ?? "1").trim() !== "0";
export const CLAUDE_CLI_SETTING_SOURCES = (process.env.CLAUDE_CLI_SETTING_SOURCES ?? "user").trim();
export const CLAUDE_CLI_PERMISSION_MODE = (() => {
  const candidate = (process.env.CLAUDE_CLI_PERMISSION_MODE ?? "bypassPermissions").trim();
  const allowed = new Set(["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan"]);
  return allowed.has(candidate) ? candidate : "bypassPermissions";
})();

export const CLAUDE_PROBE_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_PROBE_TIMEOUT_MS ?? "45000", 10);
  if (!Number.isFinite(raw)) {
    return 45_000;
  }
  return Math.max(15_000, Math.min(300_000, raw));
})();
