import express from "express";

import {
  createApiAuthMiddleware,
  createCorsMiddleware,
  createErrorMiddleware,
  createNotFoundMiddleware,
  createSecurityHeadersMiddleware
} from "./middleware.js";
import type { PipelineRouteDependencies } from "./routes/pipelines.js";
import { registerPipelineRoutes } from "./routes/pipelines.js";
import { registerRunRoutes, type RunRouteDependencies } from "./routes/runs.js";
import { registerSystemRoutes, type SystemRouteDependencies } from "./routes/system.js";

export interface AppFactoryDependencies {
  apiAuthToken: string;
  allowedCorsOrigins: string[];
  allowAnyCorsOrigin: boolean;
  system: SystemRouteDependencies;
  pipelines: PipelineRouteDependencies;
  runs: RunRouteDependencies;
}

export function createApp(deps: AppFactoryDependencies): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(createSecurityHeadersMiddleware());
  app.use(
    createCorsMiddleware({
      allowedOrigins: deps.allowedCorsOrigins,
      allowAnyOrigin: deps.allowAnyCorsOrigin
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(createApiAuthMiddleware(deps.apiAuthToken));

  registerSystemRoutes(app, deps.system);
  registerPipelineRoutes(app, deps.pipelines);
  registerRunRoutes(app, deps.runs);

  app.use(createNotFoundMiddleware());
  app.use(createErrorMiddleware());

  return app;
}
