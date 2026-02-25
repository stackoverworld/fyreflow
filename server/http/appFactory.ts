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
import { registerPairingRoutes, type PairingRouteDependencies } from "./routes/pairing.js";
import { registerRunRoutes, type RunRouteDependencies } from "./routes/runs.js";
import { registerSystemRoutes, type SystemRouteDependencies } from "./routes/system.js";
import { registerUpdateRoutes, type UpdateRouteDependencies } from "./routes/updates.js";

export interface AppFactoryDependencies {
  apiAuthToken: string;
  isAdditionalApiTokenValid?: (token: string) => boolean;
  allowedCorsOrigins: string[];
  allowAnyCorsOrigin: boolean;
  system: SystemRouteDependencies;
  updates: UpdateRouteDependencies;
  pairing: PairingRouteDependencies;
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
  app.use(
    createApiAuthMiddleware(deps.apiAuthToken, {
      isAdditionalTokenValid: deps.isAdditionalApiTokenValid
    })
  );

  registerSystemRoutes(app, deps.system);
  registerUpdateRoutes(app, deps.updates);
  registerPairingRoutes(app, deps.pairing);
  registerPipelineRoutes(app, deps.pipelines);
  registerRunRoutes(app, deps.runs);

  app.use(createNotFoundMiddleware());
  app.use(createErrorMiddleware());

  return app;
}
