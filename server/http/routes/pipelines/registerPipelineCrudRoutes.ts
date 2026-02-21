import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sendZodError } from "./helpers.js";
import { pipelineSchema } from "./schemas.js";

export function registerPipelineCrudRoutes(app: Express, deps: PipelineRouteContext): void {
  app.get("/api/pipelines", (_request: Request, response: Response) => {
    response.json({ pipelines: deps.store.listPipelines() });
  });

  app.post("/api/pipelines", (request: Request, response: Response) => {
    try {
      const input = pipelineSchema.parse(request.body);
      const pipeline = deps.store.createPipeline(input);
      response.status(201).json({ pipeline });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.put("/api/pipelines/:pipelineId", (request: Request, response: Response) => {
    try {
      const input = pipelineSchema.parse(request.body);
      const pipeline = deps.store.updatePipeline(firstParam(request.params.pipelineId), input);

      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      response.json({ pipeline });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.delete("/api/pipelines/:pipelineId", (request: Request, response: Response) => {
    const removed = deps.store.deletePipeline(firstParam(request.params.pipelineId));
    if (!removed) {
      response.status(404).json({ error: "Pipeline not found" });
      return;
    }

    response.status(204).send();
  });
}
