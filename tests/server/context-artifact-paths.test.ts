import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveArtifactCandidatePaths } from "../../server/runner/context.js";

describe("resolveArtifactCandidatePaths output_dir safety", () => {
  const runStoragePath = path.resolve("/tmp/fyreflow-tests/runs/run-1/step-delivery");
  const storagePaths = {
    sharedStoragePath: path.resolve("/tmp/fyreflow-tests/shared/pipeline-1"),
    isolatedStoragePath: "DISABLED",
    runStoragePath
  };

  it("allows output_dir when it resolves inside run storage", () => {
    const result = resolveArtifactCandidatePaths("investor-deck.html", storagePaths, {
      output_dir: "exports/final"
    });

    expect(result.paths).toContain(path.resolve(runStoragePath, "investor-deck.html"));
    expect(result.paths).toContain(path.resolve(runStoragePath, "exports/final", "investor-deck.html"));
  });

  it("blocks absolute output_dir outside run storage root", () => {
    const outsideDir = path.resolve("/tmp/fyreflow-tests/public-delivery");
    const result = resolveArtifactCandidatePaths("investor-deck.html", storagePaths, {
      output_dir: outsideDir
    });

    expect(result.paths).toContain(path.resolve(runStoragePath, "investor-deck.html"));
    expect(result.paths).not.toContain(path.resolve(outsideDir, "investor-deck.html"));
  });

  it("blocks traversal output_dir escaping run storage root", () => {
    const result = resolveArtifactCandidatePaths("investor-deck.html", storagePaths, {
      output_dir: "../../../../public-delivery"
    });

    expect(result.paths).toContain(path.resolve(runStoragePath, "investor-deck.html"));
    expect(result.paths.some((entry) => entry.includes("public-delivery/investor-deck.html"))).toBe(false);
  });
});
