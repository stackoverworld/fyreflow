import { describe, expect, it, vi } from "vitest";

import type { PipelineRun } from "../../src/lib/types.ts";
import { inspectRuntimeInputPrompts } from "../../src/app/state/controller/effects.ts";

function createStep(partial: Partial<PipelineRun["steps"][number]> = {}): PipelineRun["steps"][number] {
  return {
    stepId: "step-fetch",
    stepName: "Fetcher",
    role: "executor",
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
    pipelineName: "Auto Site Content Sync",
    task: "Sync website content",
    inputs: {},
    status: "running",
    startedAt: "2026-03-04T00:00:00.000Z",
    logs: [],
    steps: [],
    approvals: [],
    ...partial
  };
}

describe("runtime input prompts", () => {
  it("opens runtime input modal for failed runs that contain explicit input requests", () => {
    const run = createRun({
      id: "run-needs-input",
      status: "failed",
      inputs: {
        gitlab_token: "[secure]",
        gitlab_repo: "group/repo"
      },
      steps: [
        createStep({
          stepId: "step-gitlab",
          stepName: "GitLab Site Fetcher",
          attempts: 5,
          output: [
            "Could not continue due to missing credential.",
            "```json",
            JSON.stringify(
              {
                status: "needs_input",
                summary: "GitLab token is required to continue.",
                input_requests: [
                  {
                    key: "gitlab_token",
                    label: "GitLab Personal Access Token",
                    type: "secret",
                    required: true,
                    reason: "Token is required to call GitLab API."
                  }
                ]
              },
              null,
              2
            ),
            "```"
          ].join("\n")
        })
      ],
      logs: [
        "GitLab Site Fetcher requires user input; stopping run for remediation.",
        "Run failed: GitLab Site Fetcher requested additional input"
      ]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();
    const seenRef = { current: new Set<string>() };

    inspectRuntimeInputPrompts({
      runs: [run],
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: seenRef,
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).toHaveBeenCalledTimes(1);
    const modal = setRunInputModal.mock.calls[0]?.[0];
    expect(modal).toMatchObject({
      source: "runtime",
      pipelineId: "pipeline-1",
      runId: "run-needs-input",
      confirmLabel: "Apply & Restart Run"
    });
    expect(modal.summary).toBe("GitLab token is required to continue.");
    expect(modal.requests).toEqual([
      expect.objectContaining({
        key: "gitlab_token",
        type: "secret",
        required: true
      })
    ]);
    expect(setNotice).toHaveBeenCalledWith("GitLab Site Fetcher: additional input required.");
  });

  it("does not open runtime input modal for ordinary failed runs without input requests", () => {
    const run = createRun({
      id: "run-failed-no-input",
      status: "failed",
      steps: [
        createStep({
          stepId: "step-github",
          stepName: "GitHub Fetcher",
          status: "failed",
          output:
            "OpenAI request failed (401): { \"error\": { \"code\": \"token_expired\" } }; CLI fallback failed: aborted"
        })
      ],
      logs: ["Run failed: GitHub Fetcher failed due to token_expired"]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();

    inspectRuntimeInputPrompts({
      runs: [run],
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: { current: new Set<string>() },
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });

  it("does not re-open modal repeatedly for the same step/request signature", () => {
    const run = createRun({
      id: "run-repeat",
      status: "failed",
      steps: [
        createStep({
          stepId: "step-remediation",
          stepName: "GitLab Site Fetcher",
          attempts: 2,
          output: JSON.stringify({
            status: "needs_input",
            summary: "Need token",
            input_requests: [
              {
                key: "gitlab_token",
                label: "GitLab Token",
                type: "secret",
                required: true,
                reason: "Required for API call."
              }
            ]
          })
        })
      ]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();
    const seenRef = { current: new Set<string>() };

    inspectRuntimeInputPrompts({
      runs: [run],
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: seenRef,
      setRunInputModal,
      setNotice
    });

    inspectRuntimeInputPrompts({
      runs: [run],
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: seenRef,
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).toHaveBeenCalledTimes(1);
    expect(setNotice).toHaveBeenCalledTimes(1);
  });
});
