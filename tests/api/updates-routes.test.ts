import { describe, expect, it, vi } from "vitest";

import { registerUpdateRoutes } from "../../server/http/routes/updates.js";
import { UpdaterProxyError, type UpdaterProxyClient } from "../../server/updater/proxyClient.js";
import type { UpdateStatus } from "../../server/updater/types.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";

const baseStatus: UpdateStatus = {
  channel: "stable",
  currentTag: "1.0.0",
  currentVersion: "1.0.0",
  latestTag: "1.0.1",
  updateAvailable: true,
  rollbackAvailable: true,
  busy: false
};

function createUpdaterStub(overrides: Partial<UpdaterProxyClient> = {}): UpdaterProxyClient {
  return {
    isConfigured: () => true,
    getStatus: async () => baseStatus,
    checkForUpdates: async () => baseStatus,
    applyUpdate: async () => ({ ...baseStatus, currentTag: "1.0.1", updateAvailable: false }),
    rollbackUpdate: async () => ({ ...baseStatus, currentTag: "1.0.0", updateAvailable: true }),
    ...overrides
  };
}

describe("update routes", () => {
  it("returns proxied status and accepts check/apply/rollback operations", async () => {
    const updater = createUpdaterStub({
      applyUpdate: vi.fn(async (input) => {
        return {
          ...baseStatus,
          currentTag: typeof input?.version === "string" && input.version.trim().length > 0 ? input.version.trim() : "1.0.1",
          updateAvailable: false
        };
      })
    });
    const { app, route } = createRouteHarness();

    registerUpdateRoutes(app as never, { updater });

    const statusResponse = await invokeRoute(route("GET", "/api/updates/status"), {
      method: "GET",
      path: "/api/updates/status"
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.body).toEqual({ status: baseStatus });

    const checkResponse = await invokeRoute(route("POST", "/api/updates/check"), {
      method: "POST",
      path: "/api/updates/check"
    });
    expect(checkResponse.statusCode).toBe(200);
    expect(checkResponse.body).toEqual({ status: baseStatus });

    const applyResponse = await invokeRoute(route("POST", "/api/updates/apply"), {
      method: "POST",
      path: "/api/updates/apply",
      body: {
        version: " 1.0.2 "
      }
    });
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.body).toEqual({
      status: {
        ...baseStatus,
        currentTag: "1.0.2",
        updateAvailable: false
      }
    });
    expect(updater.applyUpdate).toHaveBeenCalledWith({
      version: " 1.0.2 "
    });

    const rollbackResponse = await invokeRoute(route("POST", "/api/updates/rollback"), {
      method: "POST",
      path: "/api/updates/rollback"
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect(rollbackResponse.body).toEqual({
      status: {
        ...baseStatus,
        currentTag: "1.0.0",
        updateAvailable: true
      }
    });
  });

  it("returns typed error status when updater is not configured", async () => {
    const { app, route } = createRouteHarness();
    const updater = createUpdaterStub({
      isConfigured: () => false,
      getStatus: async () => {
        throw new UpdaterProxyError("Updater is not configured on this backend.", 503);
      }
    });

    registerUpdateRoutes(app as never, { updater });

    const response = await invokeRoute(route("GET", "/api/updates/status"), {
      method: "GET",
      path: "/api/updates/status"
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      error: "Updater is not configured on this backend."
    });
  });
});
