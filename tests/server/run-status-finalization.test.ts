import { describe, expect, it } from "vitest";

import { markRunCompleted, markRunFailed } from "../../server/runner/scheduling.js";
import { createTempStore } from "../helpers/tempStore.js";

describe("run status finalization", () => {
  it("does not overwrite failed status with completed", async () => {
    const { store, cleanup } = await createTempStore();

    try {
      const pipeline = store.listPipelines()[0];
      if (!pipeline) {
        throw new Error("Expected seeded pipeline in temp store");
      }

      const run = store.createRun(pipeline, "status finalization");
      markRunFailed(store, run.id, "synthetic failure");
      markRunCompleted(store, run.id);

      const persisted = store.getRun(run.id);
      expect(persisted?.status).toBe("failed");
      expect(persisted?.logs.some((line) => line.includes("Run completed at"))).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
