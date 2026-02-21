import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sendZodError } from "./helpers.js";
import { runRequestSchema } from "./schemas.js";

export function registerPipelineRunRoutes(app: Express, deps: PipelineRouteContext): void {
  app.post("/api/pipelines/:pipelineId/runs", async (request: Request, response: Response) => {
    try {
      const pipeline = deps.store.getPipeline(firstParam(request.params.pipelineId));
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const input = runRequestSchema.parse(request.body);
      const task = input.task.trim().length > 0 ? input.task.trim() : `Run flow "${pipeline.name}"`;
      const scenario =
        typeof input.scenario === "string" && input.scenario.trim().length > 0
          ? input.scenario.trim()
          : undefined;
      const run = await deps.queuePipelineRun({
        pipeline,
        task,
        rawInputs: input.inputs ?? {},
        scenario,
        persistSensitiveInputs: true
      });

      response.status(202).json({ run });
    } catch (error) {
      if (deps.isRunPreflightError(error)) {
        const message = error instanceof Error ? error.message : "Run preflight checks failed";
        response.status(409).json({
          error: message,
          reason: "preflight_failed",
          failedChecks: error.failedChecks
        });
        return;
      }

      sendZodError(error, response);
    }
  });
}
