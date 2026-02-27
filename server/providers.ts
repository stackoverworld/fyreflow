import type { ProviderConfig } from "./types.js";
import { getCachedCodexAccessToken, getProviderOAuthStatus } from "./oauth.js";
import { createAbortError, isAbortError } from "./abort.js";
import { hasActiveClaudeApiKey } from "./providerCapabilities.js";
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

function isClaudeSetupToken(value: string): boolean {
  return /^sk-ant-oat/i.test(value.trim());
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
  const fastModeUnavailable =
    input.provider.id === "claude" &&
    input.step.fastMode &&
    !hasActiveClaudeApiKey(input.provider);
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
      "Claude fast mode requested but unavailable without active API key auth; continuing in standard mode."
    );
  }

  effectiveInput.log?.(
    `Provider dispatch started: provider=${effectiveInput.provider.id}, authMode=${effectiveInput.provider.authMode}, model=${effectiveInput.step.model || effectiveInput.provider.defaultModel}`
  );
  let credential = credentialFromProvider(effectiveInput.provider);
  const hasExplicitApiKey = effectiveInput.provider.apiKey.trim().length > 0;
  let oauthStatus:
    | {
        canUseApi: boolean;
        canUseCli: boolean;
        message: string;
      }
    | null = null;

  if (!credential && effectiveInput.provider.id === "openai") {
    credential = getCachedCodexAccessToken();
  }

  if (!credential && effectiveInput.provider.authMode === "oauth") {
    try {
      oauthStatus = await getProviderOAuthStatus(effectiveInput.provider.id);
      effectiveInput.log?.(
        `OAuth status: canUseApi=${oauthStatus.canUseApi}, canUseCli=${oauthStatus.canUseCli}, message=${oauthStatus.message}`
      );
    } catch {
      oauthStatus = null;
      effectiveInput.log?.("OAuth status probe failed; proceeding with available credentials/fallbacks.");
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

    try {
      effectiveInput.log?.("No dashboard credential; executing via CLI.");
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
        credentialHint =
          oauthStatus?.canUseCli || oauthStatus?.canUseApi
            ? "Provider OAuth is ready via CLI (dashboard token may stay empty in CLI-managed mode)."
            : "No provider OAuth token is stored in dashboard settings and provider CLI OAuth is not ready.";
      } else {
        credentialHint = "No provider API credentials are stored in dashboard settings.";
      }

      throw new Error(`${credentialHint} ${timeoutHint} Details: ${message}${retryFailureDetails}`);
    }
  }

  try {
    effectiveInput.log?.("Using provider API with available credential.");
    if (effectiveInput.provider.id === "claude") {
      return await executeApiWithRetry(effectiveInput, () =>
        executeClaudeApiWithCompatibilityFallback(effectiveInput, credential)
      );
    }

    return await executeApiWithRetry(effectiveInput, () => executeOpenAIWithApi(effectiveInput, credential));
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (effectiveInput.provider.authMode !== "oauth" && hasExplicitApiKey) {
      throw error;
    }

    try {
      effectiveInput.log?.("API path failed; retrying via CLI fallback.");
      return await executeViaCli(effectiveInput);
    } catch (cliError) {
      const apiMessage = error instanceof Error ? error.message : "Provider API request failed";
      const cliMessage = cliError instanceof Error ? cliError.message : "CLI execution failed";
      effectiveInput.log?.(`CLI fallback after API failure also failed: ${cliMessage}`);
      throw new Error(`${apiMessage}; CLI fallback failed: ${cliMessage}`);
    }
  }
}
