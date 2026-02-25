import type { Express, Request, Response } from "express";

import type { UpdaterProxyClient } from "../../updater/proxyClient.js";
import { UpdaterProxyError } from "../../updater/proxyClient.js";
import type { ApplyUpdateRequest } from "../../updater/types.js";

export interface UpdateRouteDependencies {
  updater: UpdaterProxyClient;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return String(error);
}

function handleUpdateRouteError(response: Response, error: unknown): void {
  if (error instanceof UpdaterProxyError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  response.status(502).json({
    error: toErrorMessage(error)
  });
}

export function registerUpdateRoutes(app: Express, deps: UpdateRouteDependencies): void {
  app.get("/api/updates/status", async (_request: Request, response: Response) => {
    try {
      response.json({
        status: await deps.updater.getStatus()
      });
    } catch (error) {
      handleUpdateRouteError(response, error);
    }
  });

  app.post("/api/updates/check", async (_request: Request, response: Response) => {
    try {
      response.json({
        status: await deps.updater.checkForUpdates()
      });
    } catch (error) {
      handleUpdateRouteError(response, error);
    }
  });

  app.post("/api/updates/apply", async (request: Request, response: Response) => {
    try {
      const body = (request.body ?? {}) as ApplyUpdateRequest;
      response.json({
        status: await deps.updater.applyUpdate(body)
      });
    } catch (error) {
      handleUpdateRouteError(response, error);
    }
  });

  app.post("/api/updates/rollback", async (_request: Request, response: Response) => {
    try {
      response.json({
        status: await deps.updater.rollbackUpdate()
      });
    } catch (error) {
      handleUpdateRouteError(response, error);
    }
  });
}
