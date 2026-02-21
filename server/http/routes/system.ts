import type { Express } from "express";
import { MODEL_CATALOG } from "../../modelCatalog.js";
import type { DashboardState } from "../../types.js";

export interface SystemRouteDependencies {
  getState: () => DashboardState;
  sanitizeDashboardState: (state: DashboardState) => DashboardState;
}

export function registerSystemRoutes(app: Express, deps: SystemRouteDependencies): void {
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, now: new Date().toISOString() });
  });

  app.get("/api/state", (_request, response) => {
    response.json(deps.sanitizeDashboardState(deps.getState()));
  });

  app.get("/api/model-catalog", (_request, response) => {
    response.json({ modelCatalog: MODEL_CATALOG });
  });
}
