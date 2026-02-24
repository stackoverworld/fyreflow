import { describe, expect, it } from "vitest";

import type { PipelinePayload } from "../../src/lib/types";
import { clonePipelinePayload, createDraftStep } from "../../src/lib/pipelineDraft";

function createDraftFixture(): PipelinePayload {
  const firstStep = { ...createDraftStep(0), id: "step-1", name: "1. Analyzer" };
  const secondStep = { ...createDraftStep(1), id: "step-2", name: "2. Builder" };

  return {
    name: "Original Flow",
    description: "Flow used to verify deep clone behavior.",
    steps: [
      {
        ...firstStep,
        requiredOutputFiles: ["{{shared_storage_path}}/analysis.md"],
        enabledMcpServerIds: ["mcp-a"]
      },
      secondStep
    ],
    links: [
      {
        id: "link-1",
        sourceStepId: "step-1",
        targetStepId: "step-2",
        condition: "always"
      }
    ],
    qualityGates: [
      {
        id: "gate-1",
        name: "No TODO markers",
        targetStepId: "step-2",
        kind: "regex_must_not_match",
        blocking: true,
        pattern: "TODO",
        flags: "i",
        jsonPath: "",
        artifactPath: "",
        message: "Remove TODO markers before completion."
      }
    ],
    runtime: {
      maxLoops: 2,
      maxStepExecutions: 18,
      stageTimeoutMs: 240000
    },
    schedule: {
      enabled: true,
      cron: "0 8 * * 1-5",
      timezone: "UTC",
      task: "Daily check",
      runMode: "smart",
      inputs: {
        channel: "alerts"
      }
    }
  };
}

describe("clonePipelinePayload", () => {
  it("creates a detached deep copy for nested draft structures", () => {
    const original = createDraftFixture();
    const cloned = clonePipelinePayload(original);

    expect(cloned).not.toBe(original);
    expect(cloned.steps[0]).not.toBe(original.steps[0]);
    expect(cloned.links[0]).not.toBe(original.links[0]);
    expect(cloned.qualityGates[0]).not.toBe(original.qualityGates[0]);

    cloned.name = "Mutated Flow";
    cloned.steps[0].name = "Changed step";
    cloned.steps[0].enabledMcpServerIds.push("mcp-b");
    cloned.links[0].condition = "on_fail";
    cloned.qualityGates[0].pattern = "FIXME";
    if (cloned.runtime) {
      cloned.runtime.maxLoops = 7;
    }
    if (cloned.schedule) {
      cloned.schedule.timezone = "America/New_York";
      cloned.schedule.inputs.channel = "ops";
    }

    expect(original.name).toBe("Original Flow");
    expect(original.steps[0]?.name).toBe("1. Analyzer");
    expect(original.steps[0]?.enabledMcpServerIds).toEqual(["mcp-a"]);
    expect(original.links[0]?.condition).toBe("always");
    expect(original.qualityGates[0]?.pattern).toBe("TODO");
    expect(original.runtime?.maxLoops).toBe(2);
    expect(original.schedule?.timezone).toBe("UTC");
    expect(original.schedule?.inputs.channel).toBe("alerts");
  });
});
