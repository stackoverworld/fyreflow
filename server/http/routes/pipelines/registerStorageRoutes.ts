import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { sendZodError } from "./helpers.js";
import { storageUpdateSchema } from "./schemas.js";

export function registerStorageRoutes(app: Express, deps: PipelineRouteContext): void {
  app.put("/api/storage", (request: Request, response: Response) => {
    try {
      const input = storageUpdateSchema.parse(request.body);
      const storage = deps.store.updateStorageConfig(input);
      response.json({ storage });
    } catch (error) {
      sendZodError(error, response);
    }
  });
}
