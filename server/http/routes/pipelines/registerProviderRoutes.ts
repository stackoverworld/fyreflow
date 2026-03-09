import type { Express, Request, Response } from "express";
import { getModelEntry } from "../../../modelCatalog.js";
import type { ProviderOAuthStatus } from "../../../oauth.js";
import { assertResolvedPublicAddress } from "../../../security/networkTargets.js";
import { MASK_VALUE } from "../../../secureInputs.js";
import { isEncryptedSecret } from "../../../secretsCrypto.js";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sanitizeProviderConfig, sendZodError } from "./helpers.js";
import { providerIdSchema, providerOAuthCodeSubmitSchema, providerUpdateSchema } from "./schemas.js";

function isClaudeSetupToken(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("sk-ant-oat01-") && normalized.length >= 80;
}

function withStoredClaudeSetupTokenStatus(
  deps: PipelineRouteContext,
  providerId: "openai" | "claude",
  status: ProviderOAuthStatus
): ProviderOAuthStatus {
  if (providerId !== "claude") {
    return status;
  }

  const provider = deps.store.getProviders()[providerId];
  if (provider.authMode !== "oauth" || provider.oauthToken.trim().length === 0) {
    return status;
  }

  if (isEncryptedSecret(provider.oauthToken.trim())) {
    return {
      ...status,
      tokenAvailable: false,
      canUseApi: false,
      message:
        "Stored setup token cannot be decrypted. Keep DASHBOARD_SECRETS_KEY stable and persist backend data volume, then reconnect."
    };
  }

  if (!isClaudeSetupToken(provider.oauthToken)) {
    const hasCliAuth = status.loggedIn || status.canUseCli;
    return {
      ...status,
      tokenAvailable: false,
      canUseApi: false,
      message: hasCliAuth
        ? "Stored OAuth value is not a Claude setup-token. CLI auth is connected; API token fallback is unavailable. Paste setup-token (sk-ant-oat01-...) and save."
        : "Stored OAuth value is not a Claude setup-token. Browser Authentication Code cannot be saved here. Paste setup-token (sk-ant-oat01-...) and save."
    };
  }

  const runtimeProbe =
    status.runtimeProbe &&
    status.runtimeProbe.status === "fail" &&
    /not logged in|cli is not logged in/i.test(status.runtimeProbe.message)
      ? {
          ...status.runtimeProbe,
          status: "pass" as const,
          message: "Setup token is stored in dashboard. API path will be validated on first request."
        }
      : status.runtimeProbe;

  return {
    ...status,
    tokenAvailable: true,
    canUseApi: true,
    message: status.loggedIn
      ? status.message
      : "Setup token is stored in dashboard. Save changes and run once to validate token-based API auth.",
    ...(runtimeProbe ? { runtimeProbe } : {})
  };
}

async function withStoredOpenAiOAuthTokenStatus(
  deps: PipelineRouteContext,
  status: ProviderOAuthStatus,
  options: {
    includeRuntimeProbe: boolean;
  }
): Promise<ProviderOAuthStatus> {
  const provider = deps.store.getProviders().openai;
  if (provider.authMode !== "oauth") {
    return status;
  }

  const storedToken = provider.oauthToken.trim();
  const hasStoredToken = storedToken.length > 0;
  const hasUndecryptableStoredToken = hasStoredToken && isEncryptedSecret(storedToken);
  if (hasUndecryptableStoredToken) {
    return {
      ...status,
      tokenAvailable: false,
      canUseApi: false,
      runtimeProbe: options.includeRuntimeProbe
        ? {
            status: "fail",
            message:
              "Stored OpenAI OAuth token cannot be decrypted. Keep DASHBOARD_SECRETS_KEY stable and reconnect OpenAI OAuth.",
            checkedAt: new Date().toISOString()
          }
        : status.runtimeProbe,
      message:
        "Stored OpenAI OAuth token cannot be decrypted. Keep DASHBOARD_SECRETS_KEY stable and reconnect OpenAI OAuth."
    };
  }

  if (!options.includeRuntimeProbe) {
    if (!hasStoredToken) {
      return status;
    }

    return {
      ...status,
      tokenAvailable: true,
      canUseApi: false,
      message: "OpenAI OAuth token is stored in dashboard. Open Provider Auth to validate it."
    };
  }

  if (!hasStoredToken) {
    return status;
  }

  const runtimeProbe = await deps.probeOpenAiApiCredential(provider.baseUrl, storedToken);
  if (runtimeProbe.status === "fail") {
    return {
      ...status,
      tokenAvailable: false,
      canUseApi: false,
      runtimeProbe,
      message: `Stored OpenAI OAuth token failed runtime validation. ${runtimeProbe.message}`
    };
  }

  return {
    ...status,
    tokenAvailable: true,
    canUseApi: true,
    runtimeProbe,
    message: "Stored OpenAI OAuth token is valid and ready for API use."
  };
}

export function registerProviderRoutes(app: Express, deps: PipelineRouteContext): void {
  app.put("/api/providers/:providerId", async (request: Request, response: Response) => {
    try {
      const providerId = providerIdSchema.parse(firstParam(request.params.providerId));
      const input = providerUpdateSchema.parse(request.body);
      const currentProvider = deps.store.getProviders()[providerId];
      const effectiveAuthMode = input.authMode ?? currentProvider.authMode;
      const normalizedOauthToken = typeof input.oauthToken === "string" ? input.oauthToken.trim() : "";
      const shouldValidateClaudeSetupToken =
        providerId === "claude" &&
        effectiveAuthMode === "oauth" &&
        normalizedOauthToken.length > 0 &&
        !isEncryptedSecret(normalizedOauthToken) &&
        normalizedOauthToken !== MASK_VALUE;

      if (shouldValidateClaudeSetupToken && !isClaudeSetupToken(normalizedOauthToken)) {
        response.status(400).json({
          error:
            "Anthropic OAuth token must be Claude setup-token (sk-ant-oat01-...). Browser Authentication Code cannot be saved here."
        });
        return;
      }

      const nextBaseUrl = typeof input.baseUrl === "string" && input.baseUrl.trim().length > 0
        ? input.baseUrl.trim()
        : currentProvider.baseUrl;
      await assertResolvedPublicAddress(nextBaseUrl, "Provider baseUrl");

      const nextDefaultModel = typeof input.defaultModel === "string" && input.defaultModel.trim().length > 0
        ? input.defaultModel.trim()
        : currentProvider.defaultModel;
      if (!getModelEntry(providerId, nextDefaultModel)) {
        response.status(400).json({
          error: `Unknown default model "${nextDefaultModel}" for provider "${providerId}".`
        });
        return;
      }

      const provider = deps.store.upsertProvider(providerId, input);
      response.json({ provider: sanitizeProviderConfig(provider) });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.get("/api/providers/:providerId/oauth/status", async (request: Request, response: Response) => {
    try {
      const providerId = providerIdSchema.parse(firstParam(request.params.providerId));
      const deepRaw = request.query.deep;
      const deep = (Array.isArray(deepRaw) ? deepRaw[0] : deepRaw) === "1";
      const baseUrl = deps.store.getProviders()[providerId].baseUrl;
      const baseStatus = await deps.getProviderOAuthStatus(providerId, { includeRuntimeProbe: deep, baseUrl });
      const status = providerId === "openai"
        ? await withStoredOpenAiOAuthTokenStatus(deps, baseStatus, { includeRuntimeProbe: deep })
        : withStoredClaudeSetupTokenStatus(deps, providerId, baseStatus);
      response.json({ status });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.post("/api/providers/:providerId/oauth/start", async (request: Request, response: Response) => {
    try {
      const providerId = providerIdSchema.parse(firstParam(request.params.providerId));
      const result = await deps.startProviderOAuthLogin(providerId);
      const status = withStoredClaudeSetupTokenStatus(
        deps,
        providerId,
        await deps.getProviderOAuthStatus(providerId)
      );
      response.status(202).json({ result, status });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.post("/api/providers/:providerId/oauth/submit-code", async (request: Request, response: Response) => {
    try {
      const providerId = providerIdSchema.parse(firstParam(request.params.providerId));
      const { code } = providerOAuthCodeSubmitSchema.parse(request.body);
      const result = await deps.submitProviderOAuthCode(providerId, code);
      const status = withStoredClaudeSetupTokenStatus(
        deps,
        providerId,
        await deps.getProviderOAuthStatus(providerId)
      );
      response.status(202).json({ result, status });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.post("/api/providers/:providerId/oauth/sync-token", async (request: Request, response: Response) => {
    try {
      const providerId = providerIdSchema.parse(firstParam(request.params.providerId));
      const result = await deps.syncProviderOAuthToken(providerId);

      if (result.oauthToken) {
        deps.store.upsertProvider(providerId, {
          authMode: "oauth",
          oauthToken: result.oauthToken
        });
      }

      const provider = deps.store.getProviders()[providerId];
      response.json({
        provider: sanitizeProviderConfig(provider),
        result: result.oauthToken
          ? {
              ...result,
              oauthToken: MASK_VALUE
            }
          : result
      });
    } catch (error) {
      sendZodError(error, response);
    }
  });
}
