import { describe, expect, it } from "vitest";

import { registerRunRoutes } from "../../server/http/routes/runs.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";
import { createTempStore } from "../helpers/tempStore.js";

describe("Run Lifecycle Routes", () => {
  it("lists runs and fetches a run by id", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      registerRunRoutes(app as never, {
        store,
        activeRunControllers: new Map<string, AbortController>(),
        attachWorkerToExistingRun: async () => {}
      });

      const pipeline = store.listPipelines()[0];
      const run = store.createRun(pipeline, "Run integration checks");

      const listHandler = route("GET", "/api/runs");
      const listResponse = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/runs",
        query: { limit: "5" }
      });
      const listPayload = listResponse.body as { runs: Array<{ id: string }> };
      expect(listResponse.statusCode).toBe(200);
      expect(listPayload.runs.some((entry) => entry.id === run.id)).toBe(true);

      const getHandler = route("GET", "/api/runs/:runId");
      const getResponse = await invokeRoute(getHandler, {
        method: "GET",
        path: `/api/runs/${run.id}`,
        params: { runId: run.id }
      });
      const getPayload = getResponse.body as { run: { id: string; status: string } };
      expect(getResponse.statusCode).toBe(200);
      expect(getPayload.run.id).toBe(run.id);
      expect(getPayload.run.status).toBe("queued");
    } finally {
      await cleanup();
    }
  });

  it("pauses, resumes, and stops a run", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      registerRunRoutes(app as never, {
        store,
        activeRunControllers: new Map<string, AbortController>(),
        attachWorkerToExistingRun: async () => {}
      });

      const pipeline = store.listPipelines()[0];
      const run = store.createRun(pipeline, "Deploy canary");

      const pauseHandler = route("POST", "/api/runs/:runId/pause");
      const pauseResponse = await invokeRoute(pauseHandler, {
        method: "POST",
        path: `/api/runs/${run.id}/pause`,
        params: { runId: run.id }
      });
      const pausePayload = pauseResponse.body as { run: { status: string } };
      expect(pauseResponse.statusCode).toBe(200);
      expect(pausePayload.run.status).toBe("paused");

      const resumeHandler = route("POST", "/api/runs/:runId/resume");
      const resumeResponse = await invokeRoute(resumeHandler, {
        method: "POST",
        path: `/api/runs/${run.id}/resume`,
        params: { runId: run.id }
      });
      const resumePayload = resumeResponse.body as { run: { status: string } };
      expect(resumeResponse.statusCode).toBe(200);
      expect(resumePayload.run.status).toBe("running");

      const stopHandler = route("POST", "/api/runs/:runId/stop");
      const stopResponse = await invokeRoute(stopHandler, {
        method: "POST",
        path: `/api/runs/${run.id}/stop`,
        params: { runId: run.id }
      });
      const stopPayload = stopResponse.body as { run: { status: string } };
      expect(stopResponse.statusCode).toBe(200);
      expect(stopPayload.run.status).toBe("cancelled");
    } finally {
      await cleanup();
    }
  });

  it("returns 404 for missing runs", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      registerRunRoutes(app as never, {
        store,
        activeRunControllers: new Map<string, AbortController>(),
        attachWorkerToExistingRun: async () => {}
      });

      const getHandler = route("GET", "/api/runs/:runId");
      const getMissing = await invokeRoute(getHandler, {
        method: "GET",
        path: "/api/runs/does-not-exist",
        params: { runId: "does-not-exist" }
      });
      expect(getMissing.statusCode).toBe(404);

      const stopHandler = route("POST", "/api/runs/:runId/stop");
      const stopMissing = await invokeRoute(stopHandler, {
        method: "POST",
        path: "/api/runs/does-not-exist/stop",
        params: { runId: "does-not-exist" }
      });
      expect(stopMissing.statusCode).toBe(404);
    } finally {
      await cleanup();
    }
  });
});
