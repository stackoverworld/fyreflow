import { describe, expect, it } from "vitest";

import { canStartSmartRun } from "../../src/components/dashboard/run-panel/stateDerivations.ts";
import type { Pipeline, SmartRunPlan } from "../../src/lib/types.ts";

function createPipeline(): Pipeline {
  const now = "2026-03-06T00:00:00.000Z";
  return {
    id: "pipeline-1",
    name: "Pipeline",
    description: "",
    createdAt: now,
    updatedAt: now,
    steps: [],
    links: [],
    runtime: {
      maxLoops: 3,
      maxStepExecutions: 10,
      stageTimeoutMs: 300_000
    },
    schedule: {
      enabled: false,
      cron: "",
      timezone: "UTC",
      task: "",
      runMode: "smart",
      inputs: {}
    },
    qualityGates: []
  };
}

function createPlan(checks: SmartRunPlan["checks"]): SmartRunPlan {
  return {
    fields: [],
    checks,
    canRun: checks.every((check) => check.status !== "fail")
  };
}

describe("canStartSmartRun", () => {
  it("allows starting when only missing-input checks are failing", () => {
    expect(
      canStartSmartRun({
        selectedPipeline: createPipeline(),
        controlsLocked: false,
        loadingSmartRunPlan: false,
        smartRunPlan: createPlan([
          {
            id: "input:gitlab_token",
            title: "Input GitLab Token",
            status: "fail",
            message: "Required input is missing."
          }
        ])
      })
    ).toBe(true);
  });

  it("blocks starting when a non-input check is failing", () => {
    expect(
      canStartSmartRun({
        selectedPipeline: createPipeline(),
        controlsLocked: false,
        loadingSmartRunPlan: false,
        smartRunPlan: createPlan([
          {
            id: "provider:gitlab",
            title: "GitLab connection",
            status: "fail",
            message: "Provider auth is missing."
          }
        ])
      })
    ).toBe(false);
  });
});
