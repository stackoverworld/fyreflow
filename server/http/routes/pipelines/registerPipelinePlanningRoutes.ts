import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sendZodError } from "./helpers.js";
import {
  secureInputsDeleteSchema,
  secureInputsUpdateSchema,
  smartRunPlanRequestSchema,
  startupCheckRequestSchema
} from "./schemas.js";

export function registerPipelinePlanningRoutes(app: Express, deps: PipelineRouteContext): void {
  app.post("/api/pipelines/:pipelineId/smart-run-plan", async (request: Request, response: Response) => {
    try {
      const pipeline = deps.store.getPipeline(firstParam(request.params.pipelineId));
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const input = smartRunPlanRequestSchema.parse(request.body ?? {});
      const secureInputs = await deps.getPipelineSecureInputs(pipeline.id);
      const mergedInputs = deps.mergeRunInputsWithSecure(input.inputs ?? {}, secureInputs);
      const plan = await deps.buildSmartRunPlan(pipeline, deps.store.getState(), mergedInputs);
      response.json({ plan });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.post("/api/pipelines/:pipelineId/startup-check", async (request: Request, response: Response) => {
    try {
      const pipeline = deps.store.getPipeline(firstParam(request.params.pipelineId));
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const input = startupCheckRequestSchema.parse(request.body ?? {});
      const secureInputs = await deps.getPipelineSecureInputs(pipeline.id);
      const mergedInputs = deps.mergeRunInputsWithSecure(input.inputs ?? {}, secureInputs);
      const check = await deps.buildRunStartupCheck(pipeline, deps.store.getState(), {
        task: input.task,
        inputs: mergedInputs
      });
      response.json({ check });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.post("/api/pipelines/:pipelineId/secure-inputs", async (request: Request, response: Response) => {
    try {
      const pipeline = deps.store.getPipeline(firstParam(request.params.pipelineId));
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const input = secureInputsUpdateSchema.parse(request.body ?? {});
      const normalized = deps.normalizeRunInputs(input.inputs);
      if (Object.keys(normalized).length === 0) {
        response.json({ savedKeys: [] });
        return;
      }

      await deps.upsertPipelineSecureInputs(pipeline.id, normalized);
      response.json({ savedKeys: Object.keys(normalized).sort() });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.delete("/api/pipelines/:pipelineId/secure-inputs", async (request: Request, response: Response) => {
    try {
      const pipeline = deps.store.getPipeline(firstParam(request.params.pipelineId));
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const input = secureInputsDeleteSchema.parse(request.body ?? {});
      const result = await deps.deletePipelineSecureInputs(pipeline.id, input.keys);
      response.json(result);
    } catch (error) {
      sendZodError(error, response);
    }
  });
}
