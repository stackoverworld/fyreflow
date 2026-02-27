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
  getClientCompatibility?: (clientVersion: string) => {
    minimumDesktopVersion: string;
    clientVersion?: string;
    updateRequired: boolean;
    message: string;
    downloadUrl?: string;
  } | null;
  getPersistenceStatus?: () => {
    status: "pass" | "warn";
    dataDir: string;
    secretsKeyConfigured: boolean;
    runningInContainer: boolean;
    dedicatedVolumeMounted: boolean | null;
    issues: string[];
  };
}

export function registerSystemRoutes(app: Express, deps: SystemRouteDependencies): void {
  app.get("/api/health", (request, response) => {
    const realtimeStatus = deps.getRealtimeStatus?.();
    const updaterStatus = deps.getUpdaterStatus?.();
    const persistenceStatus = deps.getPersistenceStatus?.();
    const version = deps.getVersion?.();
    const clientVersionHeader = (() => {
      const raw = request.headers["x-fyreflow-client-version"];
      if (typeof raw === "string") {
        return raw.trim();
      }
      if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
        return raw[0].trim();
      }
      return "";
    })();
    const clientCompatibility = deps.getClientCompatibility?.(clientVersionHeader);
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
        : {}),
      ...(persistenceStatus
        ? {
            persistence: persistenceStatus
          }
        : {}),
      ...(clientCompatibility
        ? {
            client: clientCompatibility
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
