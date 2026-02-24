import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { sendZodError } from "./helpers.js";
import { flowBuilderRequestSchema } from "./schemas.js";
import {
  createFlowBuilderRequestRegistry,
  FlowBuilderRequestConflictError,
  stripFlowBuilderRequestId
} from "./flowBuilderRequestRegistry.js";

const flowBuilderRequestRegistry = createFlowBuilderRequestRegistry();

export function registerFlowBuilderRoutes(app: Express, deps: PipelineRouteContext): void {
  app.post("/api/flow-builder/generate", async (request: Request, response: Response) => {
    try {
      const input = flowBuilderRequestSchema.parse(request.body);
      const payload = stripFlowBuilderRequestId(input);
      const result =
        typeof input.requestId === "string" && input.requestId.trim().length > 0
          ? await flowBuilderRequestRegistry.resolve({
              requestId: input.requestId,
              payload,
              execute: async () => deps.generateFlowDraft(payload, deps.store.getProviders())
            })
          : await deps.generateFlowDraft(payload, deps.store.getProviders());
      response.json(result);
    } catch (error) {
      if (error instanceof FlowBuilderRequestConflictError) {
        response.status(409).json({ error: error.message });
        return;
      }
      sendZodError(error, response);
    }
  });
}
