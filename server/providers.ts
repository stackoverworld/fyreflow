import type { ProviderConfig } from "./types.js";
import { getCachedCodexAccessToken, getProviderOAuthStatus, probeOpenAiApiCredential } from "./oauth.js";
import type { ProviderOAuthStatus } from "./oauth.js";
import { createAbortError, isAbortError } from "./abort.js";
import { modelRequiresApiCapability } from "./modelCatalog.js";
import { canProviderUseFastMode } from "./providerCapabilities.js";
import { ProviderApiError, executeClaudeWithApi, executeOpenAIWithApi, executeViaCli } from "./providers/clientFactory.js";
import { buildClaudeTimeoutFallbackInput, shouldTryClaudeTimeoutFallback } from "./providers/retryPolicy.js";
import type { ClaudeApiOptions, ProviderExecutionInput as ProviderExecutionInputShape } from "./providers/types.js";
import { isEncryptedSecret } from "./secretsCrypto.js";

export type ProviderExecutionInput = ProviderExecutionInputShape;

const RETRYABLE_API_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_PROVIDER_API_RETRIES = 2;
const DEFAULT_PROVIDER_API_BACKOFF_MS = 1_000;
const MAX_PROVIDER_API_BACKOFF_MS = 20_000;
const MAX_RETRY_AFTER_MS = 60_000;
const CLAUDE_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";
const CLAUDE_SETUP_TOKEN_MIN_LENGTH = 80;
const CLAUDE_RUNTIME_CLI_AUTH_FAILURE_PATTERN =
  /\b(not logged in|authentication[_\s-]?failed|auth[_\s-]?failed|invalid[_\s-]?auth|session expired|not authenticated|login required|please run\s+\/login|reauth(?:entication|enticate)?)\b/i;

function isClaudeSetupToken(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith(CLAUDE_SETUP_TOKEN_PREFIX) && normalized.length >= CLAUDE_SETUP_TOKEN_MIN_LENGTH;
}

function credentialFromProvider(provider: ProviderConfig): string | undefined {
  const isUsableStoredCredential = (value: string): boolean => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || isEncryptedSecret(trimmed)) {
      return false;
    }

    if (provider.id === "claude" && provider.authMode === "oauth") {
      return isClaudeSetupToken(trimmed);
    }

    return true;
  };

  if (provider.authMode === "oauth") {
    return isUsableStoredCredential(provider.oauthToken) ? provider.oauthToken.trim() : undefined;
  }

  return isUsableStoredCredential(provider.apiKey) ? provider.apiKey.trim() : undefined;
}

function parseCredentialList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\n]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function collectCredentialCandidates(provider: ProviderConfig): string[] {
  const candidates: string[] = [];
  const push = (value: string | undefined) => {
    const normalized = value?.trim();
    if (!normalized || normalized.length === 0 || candidates.includes(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  push(credentialFromProvider(provider));

  if (provider.id === "openai" && provider.authMode === "oauth") {
    push(getCachedCodexAccessToken());
  }

  const providerPrefix = provider.id === "openai" ? "OPENAI" : "CLAUDE";
  if (provider.authMode === "api_key") {
    for (const credential of parseCredentialList(process.env[`FYREFLOW_${providerPrefix}_API_KEYS`])) {
      push(credential);
    }
  } else {
    const oauthEnvKey = provider.id === "claude"
      ? "FYREFLOW_CLAUDE_SETUP_TOKENS"
      : `FYREFLOW_${providerPrefix}_OAUTH_TOKENS`;
    for (const credential of parseCredentialList(process.env[oauthEnvKey])) {
      push(credential);
    }
  }

  return candidates;
}

function shouldTryNextCredential(error: unknown): boolean {
  const statusCode = resolveApiStatusCode(error);
  if (typeof statusCode === "number") {
    return RETRYABLE_API_STATUS_CODES.has(statusCode) || statusCode === 401 || statusCode === 403;
  }

  return isRetryableNetworkError(error);
}

function hasEncryptedPlaceholderCredential(provider: ProviderConfig): boolean {
  if (provider.authMode === "oauth") {
    return isEncryptedSecret(provider.oauthToken.trim());
  }
  return isEncryptedSecret(provider.apiKey.trim());
}

function hasInvalidClaudeOauthCredential(provider: ProviderConfig): boolean {
  if (provider.id !== "claude" || provider.authMode !== "oauth") {
    return false;
  }

  const token = provider.oauthToken.trim();
  if (token.length === 0 || isEncryptedSecret(token)) {
    return false;
  }

  return !isClaudeSetupToken(token);
}

function normalizeOAuthStatusForExecution(
  input: ProviderExecutionInput,
  status: ProviderOAuthStatus | null
): ProviderOAuthStatus | null {
  if (!status) {
    return null;
  }

  if (input.provider.id !== "claude" || input.provider.authMode !== "oauth") {
    return status;
  }

  const probe = status.runtimeProbe;
  if (!probe || probe.status !== "fail") {
    return status;
  }

  const authFailureDetected = CLAUDE_RUNTIME_CLI_AUTH_FAILURE_PATTERN.test(probe.message);

  return {
    ...status,
    loggedIn: authFailureDetected ? false : status.loggedIn,
    canUseCli: false,
    message: `Claude CLI runtime preflight failed. ${probe.message}`
  };
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (isAbortError(error)) {
    return false;
  }

  return /\b(fetch failed|network|socket|connection|econnreset|etimedout|timeout)\b/i.test(error.message);
}

function resolveApiStatusCode(error: unknown): number | null {
  if (error instanceof ProviderApiError) {
    return error.statusCode;
  }

  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
      return Math.floor(statusCode);
    }
  }

  return null;
}

function resolveRetryAfterMs(error: unknown): number | null {
  if (error instanceof ProviderApiError) {
    return typeof error.retryAfterMs === "number" ? error.retryAfterMs : null;
  }

  if (typeof error === "object" && error !== null && "retryAfterMs" in error) {
    const retryAfter = (error as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
      return Math.max(0, Math.floor(retryAfter));
    }
  }

  return null;
}

function shouldRetryApiError(error: unknown): boolean {
  const statusCode = resolveApiStatusCode(error);
  if (typeof statusCode === "number") {
    return RETRYABLE_API_STATUS_CODES.has(statusCode);
  }
  return isRetryableNetworkError(error);
}

function resolveApiRetryDelayMs(error: unknown, retryIndex: number): number {
  const retryAfterMs = resolveRetryAfterMs(error);
  if (typeof retryAfterMs === "number") {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, retryAfterMs));
  }

  const exponential = Math.min(MAX_PROVIDER_API_BACKOFF_MS, DEFAULT_PROVIDER_API_BACKOFF_MS * 2 ** (retryIndex - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exponential + jitter;
}

async function waitWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  if (signal?.aborted) {
    throw createAbortError("Provider retry aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const onAbort = (): void => {
      if (done) {
        return;
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError("Provider retry aborted."));
    };

    timeout = setTimeout(() => {
      done = true;
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, delayMs);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function executeApiWithRetry(input: ProviderExecutionInput, request: () => Promise<string>): Promise<string> {
  let retriesUsed = 0;

  while (true) {
    try {
      return await request();
    } catch (error) {
      if (input.signal?.aborted) {
        throw createAbortError("Provider request aborted.");
      }

      if (!shouldRetryApiError(error) || retriesUsed >= MAX_PROVIDER_API_RETRIES) {
        throw error;
      }

      retriesUsed += 1;
      const statusCode = resolveApiStatusCode(error);
      const retryAfterMs = resolveRetryAfterMs(error);
      const delayMs = resolveApiRetryDelayMs(error, retriesUsed);
      const reason =
        typeof statusCode === "number"
          ? `status=${statusCode}`
          : error instanceof Error
            ? error.message
            : "transient provider API error";
      input.log?.(
        `Provider API retry ${retriesUsed}/${MAX_PROVIDER_API_RETRIES} scheduled in ${delayMs}ms (${reason}${
          typeof retryAfterMs === "number" ? `, retry_after_ms=${retryAfterMs}` : ""
        }).`
      );
      await waitWithAbort(delayMs, input.signal);
    }
  }
}

async function executeClaudeApiWithCompatibilityFallback(
  input: ProviderExecutionInput,
  credential: string
): Promise<string> {
  try {
    return await executeClaudeWithApi(input, credential);
  } catch (error) {
    input.log?.("Claude API request failed; trying compatibility fallback options.");
    const fallbackOptions: ClaudeApiOptions[] = [
      { disable1MContext: true },
      { disableEffort: true },
      { disableOutputFormat: true },
      { disable1MContext: true, disableEffort: true }
    ];

    for (const options of fallbackOptions) {
      try {
        input.log?.(
          `Claude API fallback attempt: disable1MContext=${options.disable1MContext === true}, disableEffort=${options.disableEffort === true}`
        );
        return await executeClaudeWithApi(input, credential, options);
      } catch {
        continue;
      }
    }

    throw error;
  }
}

export async function executeProviderStep(input: ProviderExecutionInput): Promise<string> {
  let credentialCandidates = collectCredentialCandidates(input.provider);
  let credential = credentialCandidates[0];
  const resolvedModelId = input.step.model || input.provider.defaultModel;
  const openAiApiOnlyModelRequested =
    input.provider.id === "openai" &&
    modelRequiresApiCapability(input.provider.id, resolvedModelId);
  let oauthStatus: ProviderOAuthStatus | null = null;

  if (input.provider.authMode === "oauth") {
    try {
      oauthStatus = normalizeOAuthStatusForExecution(
        input,
        await getProviderOAuthStatus(input.provider.id, {
          includeRuntimeProbe: input.provider.id === "claude" || openAiApiOnlyModelRequested,
          baseUrl: input.provider.baseUrl
        })
      );
      input.log?.(
        `OAuth status: canUseApi=${oauthStatus.canUseApi}, canUseCli=${oauthStatus.canUseCli}, message=${oauthStatus.message}`
      );
      if (oauthStatus.runtimeProbe) {
        input.log?.(
          `OAuth runtime probe: status=${oauthStatus.runtimeProbe.status}, message=${oauthStatus.runtimeProbe.message}`
        );
      }
    } catch {
      oauthStatus = null;
      input.log?.("OAuth status probe failed; proceeding with available credentials/fallbacks.");
    }
  }

  const fastModeUnavailable =
    input.step.fastMode &&
    !(
      canProviderUseFastMode(input.provider, resolvedModelId, oauthStatus) ||
      (input.provider.id === "openai" && typeof credential === "string" && credential.trim().length > 0)
    );
  const effectiveInput: ProviderExecutionInput = fastModeUnavailable
    ? {
        ...input,
        step: {
          ...input.step,
          fastMode: false
        }
      }
    : input;

  if (fastModeUnavailable) {
    input.log?.(
      `${input.provider.id === "openai" ? "OpenAI" : "Claude"} fast mode requested but unavailable; continuing in standard mode.`
    );
  }

  effectiveInput.log?.(
    `Provider dispatch started: provider=${effectiveInput.provider.id}, authMode=${effectiveInput.provider.authMode}, model=${resolvedModelId}`
  );
  const hasExplicitApiKey = effectiveInput.provider.apiKey.trim().length > 0;

  const executeCliWithGuidance = async (reason?: string): Promise<string> => {
    try {
      effectiveInput.log?.(reason ?? "No dashboard credential; executing via CLI.");
      return await executeViaCli(effectiveInput);
    } catch (error) {
      let retryFailureDetails = "";
      if (shouldTryClaudeTimeoutFallback(effectiveInput, error)) {
        effectiveInput.log?.("CLI attempt timed out/aborted; retrying with Claude timeout fallback profile.");
        try {
          return await executeViaCli(buildClaudeTimeoutFallbackInput(effectiveInput));
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : "retry failed";
          effectiveInput.log?.(`Timeout fallback retry failed: ${retryMessage}`);
          retryFailureDetails = ` Timeout fallback retry failed: ${retryMessage}`;
        }
      }

      const message = error instanceof Error ? error.message : "CLI execution failed";
      const timeoutHint =
        isAbortError(error) || /\btimed?\s*out\b/i.test(message)
          ? "CLI execution timed out or was aborted. Increase stageTimeoutMs or use a lower-latency model."
          : "CLI fallback failed.";
      let credentialHint: string;
      if (effectiveInput.provider.authMode === "oauth") {
        const runtimeProbeFailure =
          oauthStatus?.runtimeProbe?.status === "fail" ? oauthStatus.runtimeProbe.message : null;
        credentialHint =
          oauthStatus?.canUseCli || oauthStatus?.canUseApi
            ? runtimeProbeFailure
              ? `Provider OAuth is configured, but runtime preflight failed (${runtimeProbeFailure}).`
              : "Provider OAuth is ready via CLI (dashboard token may stay empty in CLI-managed mode)."
            : runtimeProbeFailure
              ? `Provider OAuth runtime preflight failed (${runtimeProbeFailure}).`
              : "No provider OAuth token is stored in dashboard settings and provider CLI OAuth is not ready.";
      } else {
        credentialHint = "No provider API credentials are stored in dashboard settings.";
      }

      throw new Error(`${credentialHint} ${timeoutHint} Details: ${message}${retryFailureDetails}`);
    }
  };

  if (openAiApiOnlyModelRequested && !credential) {
    throw new Error(
      `${resolvedModelId} requires an OpenAI API-capable credential. Codex CLI-only OpenAI sessions cannot run ${resolvedModelId}. Save an OpenAI API key or import a Codex access token, then retry or switch to gpt-5.4.`
    );
  }

  if (
    openAiApiOnlyModelRequested &&
    effectiveInput.provider.id === "openai" &&
    effectiveInput.provider.authMode === "oauth" &&
    credential
  ) {
    const validatedCandidates: string[] = [];
    let lastProbeMessage = "";
    for (const candidate of credentialCandidates) {
      const openAiApiProbe = await probeOpenAiApiCredential(effectiveInput.provider.baseUrl, candidate);
      effectiveInput.log?.(
        `OpenAI API credential probe: status=${openAiApiProbe.status}, message=${openAiApiProbe.message}`
      );
      if (openAiApiProbe.status === "pass") {
        validatedCandidates.push(candidate);
        continue;
      }
      lastProbeMessage = openAiApiProbe.message;
    }

    if (validatedCandidates.length === 0) {
      throw new Error(
        `${resolvedModelId} requires a valid OpenAI API-capable credential. ${lastProbeMessage} Refresh OpenAI OAuth, save a working API key, or switch to gpt-5.4.`
      );
    }

    credentialCandidates = validatedCandidates;
    credential = credentialCandidates[0];
  }

  const preferClaudeCliOAuthPath =
    effectiveInput.provider.id === "claude" &&
    effectiveInput.provider.authMode === "oauth" &&
    oauthStatus?.canUseCli === true;

  if (preferClaudeCliOAuthPath) {
    effectiveInput.log?.("Claude OAuth CLI session is available; using CLI path first.");
    try {
      return await executeCliWithGuidance("Claude OAuth CLI session is available; executing via CLI path.");
    } catch (error) {
      if (!credential) {
        throw error;
      }
      effectiveInput.log?.("CLI-preferred OAuth path failed; falling back to API credential.");
    }
  }

  if (!credential) {
    if (hasEncryptedPlaceholderCredential(effectiveInput.provider)) {
      throw new Error(
        "Stored provider credential cannot be decrypted. Verify DASHBOARD_SECRETS_KEY and persistent backend data volume, then reconnect provider auth."
      );
    }

    if (hasInvalidClaudeOauthCredential(effectiveInput.provider)) {
      effectiveInput.log?.(
        "Stored Claude OAuth value is not a setup-token; ignoring dashboard token and attempting CLI-auth path."
      );
    }

    if (
      effectiveInput.provider.authMode === "oauth" &&
      oauthStatus &&
      !oauthStatus.canUseCli &&
      !oauthStatus.canUseApi
    ) {
      throw new Error(`Provider OAuth is not ready. ${oauthStatus.message} Open Provider Auth and reconnect.`);
    }

    return await executeCliWithGuidance();
  }

  let lastApiError: unknown = null;
  for (const [index, candidate] of credentialCandidates.entries()) {
    try {
      effectiveInput.log?.(
        index === 0
          ? "Using provider API with available credential."
          : `Rotating to provider auth profile ${index + 1}/${credentialCandidates.length}.`
      );
      if (effectiveInput.provider.id === "claude") {
        return await executeApiWithRetry(effectiveInput, () =>
          executeClaudeApiWithCompatibilityFallback(effectiveInput, candidate)
        );
      }

      return await executeApiWithRetry(effectiveInput, () => executeOpenAIWithApi(effectiveInput, candidate));
    } catch (error) {
      lastApiError = error;
      if (index < credentialCandidates.length - 1 && shouldTryNextCredential(error)) {
        const message = error instanceof Error ? error.message : "provider API request failed";
        effectiveInput.log?.(`Provider API credential ${index + 1} failed; trying next credential. ${message}`);
        continue;
      }
      break;
    }
  }

  try {
    throw lastApiError;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (effectiveInput.provider.authMode !== "oauth" && hasExplicitApiKey) {
      throw error;
    }

    if (openAiApiOnlyModelRequested) {
      throw error;
    }

    try {
      return await executeCliWithGuidance("API path failed; retrying via CLI fallback.");
    } catch (cliError) {
      const apiMessage = error instanceof Error ? error.message : "Provider API request failed";
      const cliMessage = cliError instanceof Error ? cliError.message : "CLI execution failed";
      effectiveInput.log?.(`CLI fallback after API failure also failed: ${cliMessage}`);
      throw new Error(`${apiMessage}; CLI fallback failed: ${cliMessage}`);
    }
  }
}
