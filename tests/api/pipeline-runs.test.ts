import { describe, expect, it } from "vitest";

import type { AppFactoryDependencies } from "../../server/http/appFactory.js";
import { registerPipelineRunRoutes } from "../../server/http/routes/pipelines/registerPipelineRunRoutes.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";
import { createTempStore } from "../helpers/tempStore.js";

describe("Pipeline Run Trigger Routes", () => {
  it("queues a run and normalizes task/scenario values", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    try {
      const queuePipelineRun: AppFactoryDependencies["pipelines"]["queuePipelineRun"] = async ({
        pipeline,
        task,
        rawInputs,
        scenario
      }) => store.createRun(pipeline, task, rawInputs, scenario);

      registerPipelineRunRoutes(app as never, {
        store,
        queuePipelineRun,
        isRunPreflightError: () => false
      } as never);

      const pipeline = store.listPipelines()[0];
      const handler = route("POST", "/api/pipelines/:pipelineId/runs");

      const response = await invokeRoute(handler, {
        method: "POST",
        path: `/api/pipelines/${pipeline.id}/runs`,
        params: { pipelineId: pipeline.id },
        body: {
          task: "   ",
          scenario: "  smoke  ",
          inputs: {
            release_branch: "main"
          }
        }
      });

      const payload = response.body as {
        run: { pipelineId: string; task: string; scenario?: string; status: string };
      };
      expect(response.statusCode).toBe(202);
      expect(payload.run.pipelineId).toBe(pipeline.id);
      expect(payload.run.task).toBe(`Run flow "${pipeline.name}"`);
      expect(payload.run.scenario).toBe("smoke");
      expect(payload.run.status).toBe("queued");
    } finally {
      await cleanup();
    }
  });

  it("returns preflight failures with reason=preflight_failed", async () => {
    const failedChecks = [
      {
        id: "provider-openai",
        name: "OpenAI provider configured",
        status: "failed",
        message: "OpenAI key is missing."
      }
    ];

    const queuePipelineRun = (async () => {
      const error = new Error("Run preflight checks failed");
      (error as Error & { failedChecks: unknown[] }).failedChecks = failedChecks;
      throw error;
    }) as AppFactoryDependencies["pipelines"]["queuePipelineRun"];

    const isRunPreflightError = ((error: unknown): error is { failedChecks: unknown[] } =>
      typeof error === "object" &&
      error !== null &&
      Array.isArray((error as { failedChecks?: unknown }).failedChecks)) as AppFactoryDependencies["pipelines"]["isRunPreflightError"];

    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      registerPipelineRunRoutes(app as never, {
        store,
        queuePipelineRun,
        isRunPreflightError
      } as never);
      const pipeline = store.listPipelines()[0];

      const handler = route("POST", "/api/pipelines/:pipelineId/runs");
      const response = await invokeRoute(handler, {
        method: "POST",
        path: `/api/pipelines/${pipeline.id}/runs`,
        params: { pipelineId: pipeline.id },
        body: {
          task: "Ship release"
        }
      });

      const payload = response.body as { reason: string; failedChecks: unknown[] };
      expect(response.statusCode).toBe(409);
      expect(payload.reason).toBe("preflight_failed");
      expect(payload.failedChecks).toEqual(failedChecks);
    } finally {
      await cleanup();
    }
  });
});
