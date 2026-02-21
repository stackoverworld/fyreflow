import type { ProviderConfig } from "./types.js";
import { getCachedCodexAccessToken, getProviderOAuthStatus } from "./oauth.js";
import { isAbortError } from "./abort.js";
import { executeClaudeWithApi, executeOpenAIWithApi, executeViaCli } from "./providers/clientFactory.js";
import { buildClaudeTimeoutFallbackInput, shouldTryClaudeTimeoutFallback } from "./providers/retryPolicy.js";
import type { ClaudeApiOptions, ProviderExecutionInput as ProviderExecutionInputShape } from "./providers/types.js";

export type ProviderExecutionInput = ProviderExecutionInputShape;

function credentialFromProvider(provider: ProviderConfig): string | undefined {
  if (provider.authMode === "oauth") {
    const token = provider.oauthToken.trim();
    return token.length > 0 ? token : undefined;
  }

  const apiKey = provider.apiKey.trim();
  return apiKey.length > 0 ? apiKey : undefined;
}

export async function executeProviderStep(input: ProviderExecutionInput): Promise<string> {
  let credential = credentialFromProvider(input.provider);
  const hasExplicitApiKey = input.provider.apiKey.trim().length > 0;
  let oauthStatus:
    | {
        canUseApi: boolean;
        canUseCli: boolean;
        message: string;
      }
    | null = null;

  if (!credential && input.provider.id === "openai") {
    credential = getCachedCodexAccessToken();
  }

  if (!credential && input.provider.authMode === "oauth") {
    try {
      oauthStatus = await getProviderOAuthStatus(input.provider.id);
    } catch {
      oauthStatus = null;
    }
  }

  if (!credential) {
    if (input.provider.authMode === "oauth" && oauthStatus && !oauthStatus.canUseCli && !oauthStatus.canUseApi) {
      throw new Error(`Provider OAuth is not ready. ${oauthStatus.message} Open Provider Auth and reconnect.`);
    }

    try {
      return await executeViaCli(input);
    } catch (error) {
      let retryFailureDetails = "";
      if (shouldTryClaudeTimeoutFallback(input, error)) {
        try {
          return await executeViaCli(buildClaudeTimeoutFallbackInput(input));
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : "retry failed";
          retryFailureDetails = ` Timeout fallback retry failed: ${retryMessage}`;
        }
      }

      const message = error instanceof Error ? error.message : "CLI execution failed";
      const timeoutHint =
        isAbortError(error) || /\btimed?\s*out\b/i.test(message)
          ? "CLI execution timed out or was aborted. Increase stageTimeoutMs or use a lower-latency model."
          : "CLI fallback failed.";
      let credentialHint: string;
      if (input.provider.authMode === "oauth") {
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
    if (input.provider.id === "claude") {
      try {
        return await executeClaudeWithApi(input, credential);
      } catch (error) {
        const fallbackOptions: ClaudeApiOptions[] = [
          { disable1MContext: true },
          { disableEffort: true },
          { disable1MContext: true, disableEffort: true }
        ];

        for (const options of fallbackOptions) {
          try {
            return await executeClaudeWithApi(input, credential, options);
          } catch {
            continue;
          }
        }

        throw error;
      }
    }

    return await executeOpenAIWithApi(input, credential);
  } catch (error) {
    if (input.provider.authMode !== "oauth" && hasExplicitApiKey) {
      throw error;
    }

    try {
      return await executeViaCli(input);
    } catch (cliError) {
      const apiMessage = error instanceof Error ? error.message : "Provider API request failed";
      const cliMessage = cliError instanceof Error ? cliError.message : "CLI execution failed";
      throw new Error(`${apiMessage}; CLI fallback failed: ${cliMessage}`);
    }
  }
}
