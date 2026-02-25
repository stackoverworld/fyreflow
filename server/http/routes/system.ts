import type { Express } from "express";
import { MODEL_CATALOG } from "../../modelCatalog.js";
import type { DashboardState } from "../../types.js";

export interface SystemRouteDependencies {
  getState: () => DashboardState;
  sanitizeDashboardState: (state: DashboardState) => DashboardState;
  getVersion?: () => string;
  getRealtimeStatus?: () => {
    enabled: boolean;
    path: string;
  };
  getUpdaterStatus?: () => {
    configured: boolean;
  };
}

export function registerSystemRoutes(app: Express, deps: SystemRouteDependencies): void {
  app.get("/api/health", (_request, response) => {
    const realtimeStatus = deps.getRealtimeStatus?.();
    const updaterStatus = deps.getUpdaterStatus?.();
    const version = deps.getVersion?.();
    response.json({
      ok: true,
      now: new Date().toISOString(),
      ...(typeof version === "string" && version.trim().length > 0
        ? {
            version: version.trim()
          }
        : {}),
      ...(realtimeStatus
        ? {
            realtime: realtimeStatus
          }
        : {}),
      ...(updaterStatus
        ? {
            updater: updaterStatus
          }
        : {})
    });
  });

  app.get("/api/state", (_request, response) => {
    response.json(deps.sanitizeDashboardState(deps.getState()));
  });

  app.get("/api/model-catalog", (_request, response) => {
    response.json({ modelCatalog: MODEL_CATALOG });
  });
}
