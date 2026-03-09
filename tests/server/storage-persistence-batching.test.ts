import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalStore } from "../../server/storage.js";

describe("LocalStore run persistence batching", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-store-batch-"));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir.length > 0) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("coalesces repeated run updates into a single disk write", async () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    try {
      const store = new LocalStore(path.join(tempDir, "local-db.json"));
      const pipeline = store.listPipelines()[0];
      const run = store.createRun(pipeline, "Batch persistence test");
      const writesAfterCreateRun = writeSpy.mock.calls.length;

      store.updateRun(run.id, (current) => ({ ...current, logs: [...current.logs, "one"] }));
      store.updateRun(run.id, (current) => ({ ...current, logs: [...current.logs, "two"] }));
      store.updateRun(run.id, (current) => ({ ...current, logs: [...current.logs, "three"] }));

      expect(writeSpy.mock.calls.length).toBe(writesAfterCreateRun);

      await vi.advanceTimersByTimeAsync(300);

      expect(writeSpy.mock.calls.length).toBe(writesAfterCreateRun + 1);

      await store.flush();
    } finally {
      writeSpy.mockRestore();
    }
  });
});
