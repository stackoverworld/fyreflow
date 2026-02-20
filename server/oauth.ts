import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderId } from "./types.js";

const execFileAsync = promisify(execFile);
const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");

export interface ProviderOAuthStatus {
  providerId: ProviderId;
  loginSource: string;
  cliAvailable: boolean;
  loggedIn: boolean;
  tokenAvailable: boolean;
  canUseApi: boolean;
  canUseCli: boolean;
  message: string;
  checkedAt: string;
}

interface ClaudeStatusJson {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function isCommandAvailable(command: "codex" | "claude"): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 6000 });
    return true;
  } catch {
    return false;
  }
}

export function getCachedCodexAccessToken(): string | undefined {
  try {
    if (!fs.existsSync(CODEX_AUTH_PATH)) {
      return undefined;
    }

    const raw = fs.readFileSync(CODEX_AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      tokens?: {
        access_token?: unknown;
      };
    };

    const token = parsed.tokens?.access_token;
    if (typeof token !== "string") {
      return undefined;
    }

    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

async function getCodexLoggedInStatus(): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync("codex", ["login", "status"], { timeout: 12000 });
    const text = `${stdout}\n${stderr}`.toLowerCase();
    return text.includes("logged in") && !text.includes("not logged in");
  } catch {
    return false;
  }
}

async function getClaudeLoggedInStatus(): Promise<ClaudeStatusJson> {
  try {
    const { stdout } = await execFileAsync("claude", ["auth", "status", "--json"], { timeout: 12000 });
    return JSON.parse(stdout) as ClaudeStatusJson;
  } catch {
    return {
      loggedIn: false,
      authMethod: "unknown",
      apiProvider: "unknown"
    };
  }
}

function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export async function startProviderOAuthLogin(providerId: ProviderId): Promise<{
  providerId: ProviderId;
  command: string;
  message: string;
}> {
  if (providerId === "openai") {
    const available = await isCommandAvailable("codex");
    if (!available) {
      throw new Error("Codex CLI is not installed. Install Codex CLI first, then retry.");
    }

    launchDetached("codex", ["login", "--device-auth"]);
    return {
      providerId,
      command: "codex login --device-auth",
      message:
        "Codex browser login started. Complete login in the opened page. If the browser did not open, run `codex login --device-auth` in your terminal."
    };
  }

  const available = await isCommandAvailable("claude");
  if (!available) {
    throw new Error("Claude CLI is not installed. Install Claude Code first, then retry.");
  }

  launchDetached("claude", ["auth", "login"]);
  return {
    providerId,
    command: "claude auth login",
    message:
      "Claude browser login started. Complete login in the opened page. If the browser did not open, run `claude auth login` in your terminal."
  };
}

export async function getProviderOAuthStatus(providerId: ProviderId): Promise<ProviderOAuthStatus> {
  if (providerId === "openai") {
    const cliAvailable = await isCommandAvailable("codex");
    const loggedIn = cliAvailable ? await getCodexLoggedInStatus() : false;
    const tokenAvailable = Boolean(getCachedCodexAccessToken());

    return {
      providerId,
      loginSource: "codex-cli",
      cliAvailable,
      loggedIn,
      tokenAvailable,
      canUseApi: tokenAvailable,
      canUseCli: loggedIn,
      checkedAt: nowIso(),
      message: !cliAvailable
        ? "Codex CLI not found."
        : loggedIn && tokenAvailable
          ? "Logged in via ChatGPT. Cached access token is available for import."
          : loggedIn
            ? "Logged in via ChatGPT. No cached access token found yet."
            : "Not logged in. Start browser login."
    };
  }

  const cliAvailable = await isCommandAvailable("claude");
  const claudeStatus = cliAvailable ? await getClaudeLoggedInStatus() : { loggedIn: false };
  const loggedIn = claudeStatus.loggedIn === true;

  return {
    providerId,
    loginSource: "claude-cli",
    cliAvailable,
    loggedIn,
    tokenAvailable: false,
    canUseApi: false,
    canUseCli: loggedIn,
    checkedAt: nowIso(),
    message: !cliAvailable
      ? "Claude CLI not found."
      : loggedIn
        ? "Logged in with Claude Code. OAuth credentials are managed by Claude CLI."
        : "Not logged in. Start browser login."
  };
}

export async function syncProviderOAuthToken(providerId: ProviderId): Promise<{
  providerId: ProviderId;
  oauthToken?: string;
  message: string;
  status: ProviderOAuthStatus;
}> {
  if (providerId === "openai") {
    const token = getCachedCodexAccessToken();
    const status = await getProviderOAuthStatus(providerId);

    if (!token) {
      return {
        providerId,
        message: "No Codex cached token found. Complete browser login first.",
        status
      };
    }

    return {
      providerId,
      oauthToken: token,
      message: "Imported token from Codex local auth cache.",
      status
    };
  }

  const status = await getProviderOAuthStatus(providerId);
  return {
    providerId,
    message:
      "Claude Code stores OAuth credentials internally. Token export is not available; use CLI login and OAuth mode.",
    status
  };
}
