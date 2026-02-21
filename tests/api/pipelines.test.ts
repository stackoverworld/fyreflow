import { describe, expect, it } from "vitest";

import { registerPipelineCrudRoutes } from "../../server/http/routes/pipelines/registerPipelineCrudRoutes.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";
import { createTempStore } from "../helpers/tempStore.js";

const basePipelineInput = {
  name: "Release Workflow",
  description: "Build and verify before release.",
  steps: [
    {
      name: "Planner",
      role: "planner",
      prompt: "Create a release plan."
    }
  ]
} as const;

describe("Pipeline CRUD Routes", () => {
  it("creates, updates, lists, and deletes pipelines", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    try {
      registerPipelineCrudRoutes(app as never, {
        store
      } as never);

      const createHandler = route("POST", "/api/pipelines");
      const createResponse = await invokeRoute(createHandler, {
        method: "POST",
        path: "/api/pipelines",
        body: basePipelineInput
      });
      const created = createResponse.body as { pipeline: { id: string; name: string } };
      expect(createResponse.statusCode).toBe(201);
      expect(created.pipeline.name).toBe(basePipelineInput.name);
      const pipelineId = created.pipeline.id;

      const listHandler = route("GET", "/api/pipelines");
      const listResponse = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/pipelines"
      });
      const listed = listResponse.body as { pipelines: Array<{ id: string }> };
      expect(listResponse.statusCode).toBe(200);
      expect(listed.pipelines.some((pipeline) => pipeline.id === pipelineId)).toBe(true);

      const updateHandler = route("PUT", "/api/pipelines/:pipelineId");
      const updateResponse = await invokeRoute(updateHandler, {
        method: "PUT",
        path: `/api/pipelines/${pipelineId}`,
        params: { pipelineId },
        body: {
          ...basePipelineInput,
          name: "Release Workflow Updated",
          steps: [
            {
              name: "Review",
              role: "review",
              prompt: "Review deployment risks."
            }
          ]
        }
      });
      const updated = updateResponse.body as { pipeline: { id: string; name: string } };
      expect(updateResponse.statusCode).toBe(200);
      expect(updated.pipeline.name).toBe("Release Workflow Updated");

      const deleteHandler = route("DELETE", "/api/pipelines/:pipelineId");
      const deleteResponse = await invokeRoute(deleteHandler, {
        method: "DELETE",
        path: `/api/pipelines/${pipelineId}`,
        params: { pipelineId }
      });
      expect(deleteResponse.statusCode).toBe(204);

      const listAfterDelete = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/pipelines"
      });
      const listedAfterDelete = listAfterDelete.body as { pipelines: Array<{ id: string }> };
      expect(listAfterDelete.statusCode).toBe(200);
      expect(listedAfterDelete.pipelines.some((pipeline) => pipeline.id === pipelineId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("rejects invalid pipeline payloads with a validation error", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    try {
      registerPipelineCrudRoutes(app as never, {
        store
      } as never);

      const createHandler = route("POST", "/api/pipelines");
      const invalidResponse = await invokeRoute(createHandler, {
        method: "POST",
        path: "/api/pipelines",
        body: {
          name: "x",
          description: "",
          steps: []
        }
      });

      const errorBody = invalidResponse.body as { error: string; details: Array<{ path: string }> };
      expect(invalidResponse.statusCode).toBe(400);
      expect(errorBody.error).toBe("Validation failed");
      expect(Array.isArray(errorBody.details)).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
