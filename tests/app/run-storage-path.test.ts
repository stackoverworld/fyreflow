import { describe, expect, it } from "vitest";
import type { StorageConfig } from "../../src/lib/types.ts";
import {
  buildIsolatedStepStoragePath,
  buildIsolatedStorageRootPath,
  buildRunFolderPath,
  isIsolatedStorageEnabledForStep,
  buildSharedStoragePath,
  getRevealFolderButtonLabel,
  shouldShowIsolatedStorageSection
} from "../../src/lib/runStoragePath.ts";

function createStorageConfig(overrides: Partial<StorageConfig> = {}): StorageConfig {
  return {
    enabled: true,
    rootPath: "/tmp/fyreflow",
    sharedFolder: "shared",
    isolatedFolder: "isolated",
    runsFolder: "runs",
    updatedAt: "2026-02-22T00:00:00.000Z",
    ...overrides
  };
}

describe("runStoragePath", () => {
  it("builds a normalized unix run folder path", () => {
    const storage = createStorageConfig({
      rootPath: "/tmp/fyreflow/",
      runsFolder: "/runs/"
    });

    expect(buildRunFolderPath(storage, "run-42")).toBe("/tmp/fyreflow/runs/run-42");
  });

  it("builds a normalized windows run folder path", () => {
    const storage = createStorageConfig({
      rootPath: "C:\\Fyreflow\\",
      runsFolder: "\\runs\\"
    });

    expect(buildRunFolderPath(storage, "run-42")).toBe("C:\\Fyreflow\\runs\\run-42");
  });

  it("builds a shared storage path scoped to pipeline id", () => {
    const storage = createStorageConfig({
      rootPath: "/tmp/fyreflow/",
      sharedFolder: "/shared/"
    });

    expect(buildSharedStoragePath(storage, "pipeline-42")).toBe("/tmp/fyreflow/shared/pipeline-42");
  });

  it("builds isolated storage root and step paths", () => {
    const storage = createStorageConfig({
      rootPath: "/tmp/fyreflow/",
      isolatedFolder: "/isolated/"
    });

    expect(buildIsolatedStorageRootPath(storage, "pipeline-42")).toBe("/tmp/fyreflow/isolated/pipeline-42");
    expect(buildIsolatedStepStoragePath(storage, "pipeline-42", "step-7")).toBe(
      "/tmp/fyreflow/isolated/pipeline-42/step-7"
    );
  });

  it("returns null for incomplete storage config or empty runId", () => {
    const storage = createStorageConfig({
      rootPath: "  ",
      runsFolder: "runs"
    });

    expect(buildRunFolderPath(storage, "run-42")).toBeNull();
    expect(buildRunFolderPath(createStorageConfig(), "   ")).toBeNull();
    expect(buildRunFolderPath(null, "run-42")).toBeNull();
    expect(buildSharedStoragePath(createStorageConfig({ sharedFolder: "   " }), "pipeline-42")).toBeNull();
    expect(buildSharedStoragePath(createStorageConfig(), "   ")).toBeNull();
    expect(buildSharedStoragePath(null, "pipeline-42")).toBeNull();
    expect(buildIsolatedStorageRootPath(createStorageConfig({ isolatedFolder: "   " }), "pipeline-42")).toBeNull();
    expect(buildIsolatedStepStoragePath(createStorageConfig(), "pipeline-42", "   ")).toBeNull();
  });

  it("normalizes unsafe path characters for storage segments", () => {
    const storage = createStorageConfig();

    expect(buildRunFolderPath(storage, "run id:42")).toBe("/tmp/fyreflow/runs/run_id_42");
    expect(buildSharedStoragePath(storage, "pipeline id/42")).toBe("/tmp/fyreflow/shared/pipeline_id_42");
    expect(buildIsolatedStorageRootPath(storage, "pipeline id/42")).toBe("/tmp/fyreflow/isolated/pipeline_id_42");
    expect(buildIsolatedStepStoragePath(storage, "pipeline id/42", "step id:1")).toBe(
      "/tmp/fyreflow/isolated/pipeline_id_42/step_id_1"
    );
  });

  it("returns platform-specific reveal labels", () => {
    expect(getRevealFolderButtonLabel("darwin")).toBe("Open in Finder");
    expect(getRevealFolderButtonLabel("win32")).toBe("Open in Explorer");
    expect(getRevealFolderButtonLabel("linux")).toBe("Open folder");
    expect(getRevealFolderButtonLabel(undefined)).toBe("Open folder");
  });

  it("derives isolated section visibility from configured isolated step ids", () => {
    expect(shouldShowIsolatedStorageSection(null)).toBe(true);
    expect(shouldShowIsolatedStorageSection(undefined)).toBe(true);
    expect(shouldShowIsolatedStorageSection(new Set())).toBe(false);
    expect(shouldShowIsolatedStorageSection(new Set(["step-1"]))).toBe(true);
  });

  it("checks whether isolated storage is enabled for a specific step", () => {
    expect(isIsolatedStorageEnabledForStep("step-1", null)).toBe(true);
    expect(isIsolatedStorageEnabledForStep("step-1", undefined)).toBe(true);
    expect(isIsolatedStorageEnabledForStep("step-1", new Set(["step-1"]))).toBe(true);
    expect(isIsolatedStorageEnabledForStep("step-1", new Set(["step-2"]))).toBe(false);
  });
});
