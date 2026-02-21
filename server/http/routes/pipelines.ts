import type { Express } from "express";
import type { PipelineRouteContext } from "./pipelines/contracts.js";
import { registerFlowBuilderRoutes } from "./pipelines/registerFlowBuilderRoutes.js";
import { registerMcpRoutes } from "./pipelines/registerMcpRoutes.js";
import { registerPipelineCrudRoutes } from "./pipelines/registerPipelineCrudRoutes.js";
import { registerPipelinePlanningRoutes } from "./pipelines/registerPipelinePlanningRoutes.js";
import { registerPipelineRunRoutes } from "./pipelines/registerPipelineRunRoutes.js";
import { registerProviderRoutes } from "./pipelines/registerProviderRoutes.js";
import { registerStorageRoutes } from "./pipelines/registerStorageRoutes.js";

export function registerPipelineRoutes(app: Express, deps: PipelineRouteContext): void {
  registerPipelineCrudRoutes(app, deps);
  registerProviderRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerStorageRoutes(app, deps);
  registerPipelinePlanningRoutes(app, deps);
  registerFlowBuilderRoutes(app, deps);
  registerPipelineRunRoutes(app, deps);
}

export type PipelineRouteDependencies = PipelineRouteContext;
