import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { sendZodError } from "./helpers.js";
import { flowBuilderRequestSchema } from "./schemas.js";

export function registerFlowBuilderRoutes(app: Express, deps: PipelineRouteContext): void {
  app.post("/api/flow-builder/generate", async (request: Request, response: Response) => {
    try {
      const input = flowBuilderRequestSchema.parse(request.body);
      const result = await deps.generateFlowDraft(input, deps.store.getProviders());
      response.json(result);
    } catch (error) {
      sendZodError(error, response);
    }
  });
}
