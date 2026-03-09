import { describe, expect, it, vi } from "vitest";

import type { PipelineRun } from "../../src/lib/types.ts";
import { buildRunCompletionModalContext } from "../../src/app/state/appStateEffects.ts";
import { syncRunStatusNotifications } from "../../src/app/state/controller/effects.ts";

function createStep(partial: Partial<PipelineRun["steps"][number]> = {}): PipelineRun["steps"][number] {
  return {
    stepId: "step-1",
    stepName: "Step 1",
    role: "analysis",
    status: "completed",
    attempts: 1,
    workflowOutcome: "neutral",
    inputContext: "",
    output: "",
    subagentNotes: [],
    qualityGateResults: [],
    ...partial
  };
}

function createRun(partial: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-1",
    pipelineId: "pipeline-1",
    pipelineName: "Pipeline Alpha",
    task: "Build release notes",
    inputs: {},
    status: "running",
    startedAt: "2026-03-04T00:00:00.000Z",
    logs: [],
    steps: [],
    approvals: [],
    ...partial
  };
}

describe("buildRunCompletionModalContext", () => {
  it("builds completed context for successful runs", () => {
    const run = createRun({
      status: "completed",
      finishedAt: "2026-03-04T00:04:00.000Z",
      steps: [
        createStep({
          stepId: "step-collect",
          stepName: "Collector",
          status: "completed",
          output: "Collected all release data and generated a final markdown summary."
        })
      ]
    });

    const context = buildRunCompletionModalContext(run);

    expect(context.status).toBe("completed");
    expect(context.completedSteps).toBe(1);
    expect(context.totalSteps).toBe(1);
    expect(context.finalStepName).toBe("Collector");
    expect(context.finalOutputPreview).toContain("final markdown summary");
    expect(context.failureReason).toBeUndefined();
    expect(context.failureDetails).toBeUndefined();
  });

  it("builds failed context with a clear reason and supporting details", () => {
    const failureMessage =
      "OpenAI request failed (401): Your authentication token has expired. Please try signing in again.; CLI fallback failed: GitHub Fetcher (executor) timed out after 480000ms";

    const run = createRun({
      status: "failed",
      finishedAt: "2026-03-04T00:10:00.000Z",
      logs: [
        "GitHub Fetcher failed: OpenAI request failed (401): Your authentication token has expired.",
        `Run failed: ${failureMessage}`
      ],
      steps: [
        createStep({
          stepId: "step-gitlab",
          stepName: "GitLab Site Fetcher",
          status: "completed",
          output: "Fetched site-current.json and ui-kit.json successfully."
        }),
        createStep({
          stepId: "step-github",
          stepName: "GitHub Fetcher",
          status: "failed",
          output: "Provider round 1 failed in 480054ms: code=token_expired",
          error: failureMessage
        })
      ]
    });

    const context = buildRunCompletionModalContext(run);

    expect(context.status).toBe("failed");
    expect(context.completedSteps).toBe(1);
    expect(context.totalSteps).toBe(2);
    expect(context.failureStepName).toBe("GitHub Fetcher");
    expect(context.failureReason).toContain("token has expired");
    expect(context.failureDetails).toEqual(
      expect.arrayContaining([expect.stringContaining("token_expired")])
    );
    expect(context.finalStepName).toBe("GitHub Fetcher");
    expect(context.finalOutputPreview).toContain("token_expired");
  });

  it("prefers non-generic failed step details over later cancelled wrapper failures", () => {
    const run = createRun({
      status: "failed",
      finishedAt: "2026-03-04T00:12:00.000Z",
      logs: [
        "GitHub Fetcher failed: OpenAI request failed (401): token_expired",
        "Orchestrator failed: Cancelled",
        "Run failed: GitHub Fetcher failed due to token_expired"
      ],
      steps: [
        createStep({
          stepId: "step-github",
          stepName: "GitHub Fetcher",
          status: "failed",
          output: "Provider round 1 failed: code=token_expired",
          error: "OpenAI request failed (401): token_expired"
        }),
        createStep({
          stepId: "step-orchestrator",
          stepName: "Orchestrator",
          status: "failed",
          output: "This operation was aborted",
          error: "Cancelled"
        })
      ]
    });

    const context = buildRunCompletionModalContext(run);

    expect(context.failureStepName).toBe("GitHub Fetcher");
    expect(context.failureReason).toContain("token_expired");
  });
});

describe("syncRunStatusNotifications", () => {
  it("opens failed-run callback when run transitions from active to failed", () => {
    const failedRun = createRun({
      status: "failed",
      steps: [
        createStep({
          stepId: "step-github",
          stepName: "GitHub Fetcher",
          status: "failed",
          error: "OpenAI request failed (401): token_expired"
        })
      ],
      logs: ["Run failed: OpenAI request failed (401): token_expired"]
    });

    const notifyDesktop = vi.fn();
    const onRunFailed = vi.fn();
    const onRunCompleted = vi.fn();

    syncRunStatusNotifications(
      [failedRun],
      { current: new Map([[failedRun.id, "running"]]) },
      notifyDesktop,
      { onRunFailed, onRunCompleted }
    );

    expect(notifyDesktop).toHaveBeenCalledWith(
      "runFailed",
      "Flow failed: Pipeline Alpha",
      "OpenAI request failed (401): token_expired"
    );
    expect(onRunFailed).toHaveBeenCalledWith(failedRun);
    expect(onRunCompleted).not.toHaveBeenCalled();
  });

  it("suppresses failed notifications when the failure includes recoverable runtime input requests", () => {
    const failedRun = createRun({
      status: "failed",
      steps: [
        createStep({
          stepId: "step-github",
          stepName: "GitHub Fetcher",
          status: "failed",
          output: JSON.stringify({
            status: "needs_input",
            summary: "Provide GitHub token to continue.",
            input_requests: [
              {
                key: "github_token",
                label: "GitHub token",
                type: "secret",
                required: true,
                reason: "Token is required for repository access."
              }
            ]
          }),
          error: "Cancelled"
        })
      ],
      logs: ["Run failed: GitHub Fetcher requested additional input"]
    });

    const notifyDesktop = vi.fn();
    const onRunFailed = vi.fn();

    syncRunStatusNotifications(
      [failedRun],
      { current: new Map([[failedRun.id, "running"]]) },
      notifyDesktop,
      { onRunFailed }
    );

    expect(notifyDesktop).not.toHaveBeenCalled();
    expect(onRunFailed).not.toHaveBeenCalled();
  });
});
