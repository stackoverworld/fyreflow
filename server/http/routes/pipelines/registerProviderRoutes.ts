import type { Express, Request, Response } from "express";
import { MASK_VALUE } from "../../../secureInputs.js";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sanitizeProviderConfig, sendZodError } from "./helpers.js";
import { providerIdSchema, providerOAuthCodeSubmitSchema, providerUpdateSchema } from "./schemas.js";

export function registerProviderRoutes(app: Express, deps: PipelineRouteContext): void {
  app.put("/api/providers/:providerId", (request: Request, response: Response) => {
    try {
      const providerId = providerIdSchema.parse(firstParam(request.params.providerId));
      const input = providerUpdateSchema.parse(request.body);
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
      const status = await deps.getProviderOAuthStatus(providerId, { includeRuntimeProbe: deep });
      response.json({ status });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.post("/api/providers/:providerId/oauth/start", async (request: Request, response: Response) => {
    try {
      const providerId = providerIdSchema.parse(firstParam(request.params.providerId));
      const result = await deps.startProviderOAuthLogin(providerId);
      const status = await deps.getProviderOAuthStatus(providerId);
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
      const status = await deps.getProviderOAuthStatus(providerId);
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
