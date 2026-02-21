import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalStore } from "../../server/storage.js";

export async function createTempStore(): Promise<{
  store: LocalStore;
  cleanup(): Promise<void>;
}> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-tests-"));
  const dbPath = path.join(tempDir, "local-db.json");

  return {
    store: new LocalStore(dbPath),
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}
