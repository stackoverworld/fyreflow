import fs from "node:fs";
import { execFileAsync, isCommandAvailable, launchDetachedAndCapture } from "../commandUtils.js";
import { CODEX_AUTH_PATH, CODEX_CLI_COMMAND } from "../config.js";
import type {
  ProviderOAuthCodeSubmitResult,
  ProviderOAuthLoginResult,
  ProviderOAuthStatus,
  ProviderOAuthStatusOptions,
  ProviderOAuthSyncResult
} from "../contracts.js";
import { extractDeviceCode, extractFirstAuthUrl } from "../loginOutputParser.js";
import { probeOpenAiRuntime } from "../runtimeProbe.js";
import { nowIso } from "../time.js";

const OPENAI_API_PROBE_TIMEOUT_MS = 8_000;

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

function buildOpenAiModelsProbeUrl(baseUrl: string): URL {
  const normalizedBaseUrl = baseUrl.trim().endsWith("/") ? baseUrl.trim() : `${baseUrl.trim()}/`;
  return new URL("models?limit=1", normalizedBaseUrl);
}

function summarizeOpenAiProbeError(statusCode: number, responseText: string): string {
  const trimmed = responseText.trim();
  if (trimmed.length === 0) {
    return `OpenAI API probe failed with status ${statusCode}.`;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: {
        message?: unknown;
        code?: unknown;
      };
      message?: unknown;
    };
    const code =
      typeof parsed.error?.code === "string" && parsed.error.code.trim().length > 0
        ? parsed.error.code.trim()
        : "";
    const message =
      typeof parsed.error?.message === "string" && parsed.error.message.trim().length > 0
        ? parsed.error.message.trim()
        : typeof parsed.message === "string" && parsed.message.trim().length > 0
          ? parsed.message.trim()
          : "";

    if (statusCode === 401 && code === "token_expired") {
      return "OpenAI API token expired. Refresh OpenAI OAuth or save a fresh API key.";
    }

    if (message.length > 0) {
      return code.length > 0
        ? `OpenAI API probe failed (${code}): ${message}`
        : `OpenAI API probe failed: ${message}`;
    }
  } catch {
    // Ignore parse errors and fall back to the raw payload summary below.
  }

  return `OpenAI API probe failed with status ${statusCode}: ${trimmed.replace(/\s+/g, " ").slice(0, 280)}`;
}

export async function probeOpenAiApiCredential(
  baseUrl: string,
  accessToken: string
): Promise<ProviderOAuthStatus["runtimeProbe"]> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(`OpenAI API probe timed out after ${OPENAI_API_PROBE_TIMEOUT_MS}ms`);
  }, OPENAI_API_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(buildOpenAiModelsProbeUrl(baseUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;
    const responseText = await response.text();

    if (response.ok) {
      return {
        status: "pass",
        message: "OpenAI API credential verified.",
        checkedAt: nowIso(),
        latencyMs
      };
    }

    if (response.status === 429) {
      return {
        status: "pass",
        message: "OpenAI API credential verified, but the probe hit rate limiting.",
        checkedAt: nowIso(),
        latencyMs
      };
    }

    return {
      status: "fail",
      message: summarizeOpenAiProbeError(response.status, responseText),
      checkedAt: nowIso(),
      latencyMs
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message.trim() : "OpenAI API probe failed.";
    return {
      status: "fail",
      message: message.length > 0 ? message : "OpenAI API probe failed.",
      checkedAt: nowIso(),
      latencyMs
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getCodexLoggedInStatus(): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(CODEX_CLI_COMMAND, ["login", "status"], { timeout: 12000 });
    const text = `${stdout}\n${stderr}`.toLowerCase();
    return text.includes("logged in") && !text.includes("not logged in");
  } catch {
    return false;
  }
}

export async function startOpenAiOAuthLogin(providerId: "openai"): Promise<ProviderOAuthLoginResult> {
  const available = await isCommandAvailable(CODEX_CLI_COMMAND);
  if (!available) {
    throw new Error(`Codex CLI command "${CODEX_CLI_COMMAND}" is not installed. Install Codex CLI first, then retry.`);
  }

  const launchResult = await launchDetachedAndCapture(CODEX_CLI_COMMAND, ["login", "--device-auth"]);
  const authUrl = extractFirstAuthUrl(launchResult.capturedOutput);
  const authCode = extractDeviceCode(launchResult.capturedOutput);

  const messageParts = [
    "Codex browser login started.",
    authUrl ? `Open ${authUrl}.` : "",
    authCode ? `Use code ${authCode}.` : "",
    "If the browser did not open, run `codex login --device-auth` in your terminal."
  ].filter((value) => value.length > 0);

  return {
    providerId,
    command: `${CODEX_CLI_COMMAND} login --device-auth`,
    message: messageParts.join(" "),
    authUrl,
    authCode
  };
}

export async function getOpenAiOAuthStatus(
  providerId: "openai",
  options: ProviderOAuthStatusOptions = {}
): Promise<ProviderOAuthStatus> {
  const cliAvailable = await isCommandAvailable(CODEX_CLI_COMMAND);
  const loggedIn = cliAvailable ? await getCodexLoggedInStatus() : false;
  const cachedToken = getCachedCodexAccessToken();
  const tokenAvailable = Boolean(cachedToken);

  const status: ProviderOAuthStatus = {
    providerId,
    loginSource: "codex-cli",
    cliCommand: CODEX_CLI_COMMAND,
    cliAvailable,
    loggedIn,
    tokenAvailable,
    canUseApi: tokenAvailable,
    canUseCli: loggedIn,
    checkedAt: nowIso(),
    message: !cliAvailable
      ? "Codex CLI not found on this server. Install Codex CLI on backend and set CODEX_CLI_PATH if needed."
      : loggedIn && tokenAvailable
        ? "Logged in via ChatGPT. Cached access token is available for import."
        : loggedIn
          ? "Logged in via ChatGPT. No cached access token found yet."
          : "Not logged in. Start browser login."
  };

  if (options.includeRuntimeProbe) {
    if (cachedToken) {
      status.runtimeProbe = await probeOpenAiApiCredential(options.baseUrl ?? "https://api.openai.com/v1", cachedToken);
      if (status.runtimeProbe.status === "fail") {
        status.canUseApi = false;
        status.tokenAvailable = false;
        status.message = status.loggedIn
          ? `Cached Codex access token failed OpenAI API validation. ${status.runtimeProbe.message}`
          : status.runtimeProbe.message;
      }
    } else {
      status.runtimeProbe = probeOpenAiRuntime(status);
    }
  }

  return status;
}

export async function syncOpenAiOAuthToken(providerId: "openai"): Promise<ProviderOAuthSyncResult> {
  const token = getCachedCodexAccessToken();
  const status = await getOpenAiOAuthStatus(providerId);

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

export async function submitOpenAiOAuthCode(
  providerId: "openai",
  _code: string
): Promise<ProviderOAuthCodeSubmitResult> {
  return {
    providerId,
    accepted: false,
    message:
      "Codex device auth code must be entered on the browser page. If blocked, enable device code authorization in ChatGPT Settings -> Security and reconnect."
  };
}
