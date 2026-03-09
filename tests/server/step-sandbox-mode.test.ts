import { describe, expect, it } from "vitest";

import {
  analyzeStepSandboxRequirement,
  normalizeStepSandboxMode
} from "../../server/sandboxMode.js";

describe("server sandbox mode analysis", () => {
  it("defaults unknown sandbox mode to auto", () => {
    expect(normalizeStepSandboxMode("invalid")).toBe("auto");
  });

  it("detects full-access requirement for remote gitlab publish step", () => {
    const requirement = analyzeStepSandboxRequirement({
      name: "Publisher",
      role: "executor",
      prompt: "PUT to https://gitlab.com/api/v4/projects/{{input.project_id}} with curl",
      contextTemplate: "Task:\n{{task}}",
      requiredOutputFiles: ["{{shared_storage_path}}/publish-report.json"],
      skipIfArtifacts: []
    });
    expect(requirement.requiresFullAccess).toBe(true);
    expect(requirement.reasons.length).toBeGreaterThan(0);
  });

  it("does not require full access for local-only artifact handling", () => {
    const requirement = analyzeStepSandboxRequirement({
      name: "Formatter",
      role: "executor",
      prompt: "Read and rewrite markdown files in shared storage only.",
      contextTemplate: "Task:\n{{task}}",
      requiredOutputFiles: ["{{shared_storage_path}}/source.md"],
      skipIfArtifacts: []
    });
    expect(requirement.requiresFullAccess).toBe(false);
  });
});
