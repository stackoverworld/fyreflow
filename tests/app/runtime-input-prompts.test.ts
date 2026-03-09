import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineRun } from "../../src/lib/types.ts";
import { buildRunInputModalSignature } from "../../src/app/state/appStateEffects.ts";
import { inspectRuntimeInputPrompts } from "../../src/app/state/controller/effects.ts";
import {
  __resetRunInputModalDismissalsForTests,
  dismissRunInputModalSignature
} from "../../src/lib/runInputModalStorage.ts";

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
  beforeEach(() => {
    __resetRunInputModalDismissalsForTests();
  });

  it("opens runtime input modal for active runs that contain explicit input requests", () => {
    const run = createRun({
      id: "run-needs-input",
      status: "running",
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
      logs: ["GitLab Site Fetcher requires user input; waiting for remediation."]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();
    const seenRef = { current: new Set<string>() };

    inspectRuntimeInputPrompts({
      runs: [run],
      selectedPipelineId: "pipeline-1",
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
    expect(modal.inputs).toMatchObject({
      gitlab_token: "[secure]"
    });
    expect(setNotice).toHaveBeenCalledWith("GitLab Site Fetcher: additional input required.");
  });

  it("keeps masked secure secret values for equivalent request keys", () => {
    const run = createRun({
      id: "run-needs-secret-alias",
      status: "failed",
      inputs: {
        source_api_token: "[secure]"
      },
      steps: [
        createStep({
          stepId: "step-fetch",
          stepName: "Source Fetcher",
          attempts: 1,
          output: JSON.stringify({
            status: "needs_input",
            summary: "Source token is required.",
            input_requests: [
              {
                key: "source_token",
                label: "Source Token",
                type: "secret",
                required: true,
                reason: "Need token to access source API."
              }
            ]
          })
        })
      ]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();

    inspectRuntimeInputPrompts({
      runs: [run],
      selectedPipelineId: "pipeline-1",
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: { current: new Set<string>() },
      setRunInputModal,
      setNotice
    });

    const modal = setRunInputModal.mock.calls[0]?.[0];
    expect(modal?.inputs?.source_token).toBe("[secure]");
    expect(setNotice).toHaveBeenCalledWith("Source Fetcher: additional input required.");
  });

  it("opens runtime input modal for failed runs when step output contains recoverable input requests", () => {
    const run = createRun({
      id: "run-failed-needs-input",
      status: "failed",
      steps: [
        createStep({
          stepId: "step-gitlab",
          stepName: "GitLab Site Fetcher",
          attempts: 2,
          output: JSON.stringify({
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
          })
        })
      ]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();

    inspectRuntimeInputPrompts({
      runs: [run],
      selectedPipelineId: "pipeline-1",
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: { current: new Set<string>() },
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).toHaveBeenCalledTimes(1);
    expect(setRunInputModal.mock.calls[0]?.[0]).toMatchObject({
      source: "runtime",
      runId: "run-failed-needs-input",
      confirmLabel: "Apply & Restart Run"
    });
    expect(setNotice).toHaveBeenCalledWith("GitLab Site Fetcher: additional input required.");
  });

  it("opens runtime input modal when output contains blockers even without input fields", () => {
    const run = createRun({
      id: "run-blocked-provider-auth",
      status: "paused",
      steps: [
        createStep({
          stepId: "step-orchestrator",
          stepName: "Orchestrator",
          attempts: 1,
          output: JSON.stringify({
            status: "blocked",
            summary: "Orchestrator is blocked by provider auth.",
            input_requests: [],
            blockers: [
              {
                id: "claude-provider-auth",
                title: "Claude provider auth required",
                message: "Reconnect Claude provider auth and retry.",
                details: "Claude OAuth token has expired."
              }
            ]
          })
        })
      ]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();

    inspectRuntimeInputPrompts({
      runs: [run],
      selectedPipelineId: "pipeline-1",
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: { current: new Set<string>() },
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).toHaveBeenCalledTimes(1);
    const modal = setRunInputModal.mock.calls[0]?.[0];
    expect(modal?.requests).toHaveLength(0);
    expect(modal?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-provider-auth",
          message: "Reconnect Claude provider auth and retry."
        })
      ])
    );
    expect(setNotice).toHaveBeenCalledWith("Orchestrator: run is blocked.");
  });

  it("does not re-open a runtime input modal that was dismissed earlier", () => {
    const run = createRun({
      id: "run-dismissed-runtime-input",
      status: "failed",
      task: "Sync website content",
      inputs: {
        gitlab_token: "[secure]"
      },
      steps: [
        createStep({
          stepId: "step-gitlab",
          stepName: "GitLab Site Fetcher",
          attempts: 5,
          output: JSON.stringify({
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
          })
        })
      ]
    });

    dismissRunInputModalSignature(
      buildRunInputModalSignature({
        source: "runtime",
        pipelineId: run.pipelineId,
        runId: run.id,
        task: run.task,
        requests: [
          {
            key: "gitlab_token",
            label: "GitLab Personal Access Token",
            type: "secret",
            required: true,
            reason: "Token is required to call GitLab API."
          }
        ],
        blockers: [],
        summary: "GitLab token is required to continue.",
        inputs: {
          gitlab_token: "[secure]"
        },
        confirmLabel: "Apply & Restart Run"
      })
    );

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();

    inspectRuntimeInputPrompts({
      runs: [run],
      selectedPipelineId: "pipeline-1",
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: { current: new Set<string>() },
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
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
      selectedPipelineId: "pipeline-1",
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
      status: "paused",
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
      selectedPipelineId: "pipeline-1",
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: seenRef,
      setRunInputModal,
      setNotice
    });

    inspectRuntimeInputPrompts({
      runs: [run],
      selectedPipelineId: "pipeline-1",
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: seenRef,
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).toHaveBeenCalledTimes(1);
    expect(setNotice).toHaveBeenCalledTimes(1);
  });

  it("ignores failed input prompts from non-selected pipelines", () => {
    const run = createRun({
      id: "run-legacy-input",
      pipelineId: "pipeline-legacy",
      status: "running",
      steps: [
        createStep({
          stepId: "step-gitlab",
          stepName: "GitLab Site Fetcher",
          attempts: 3,
          output: JSON.stringify({
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
          })
        })
      ]
    });

    const setRunInputModal = vi.fn();
    const setNotice = vi.fn();

    inspectRuntimeInputPrompts({
      runs: [run],
      selectedPipelineId: "pipeline-current",
      processingRunInputModal: false,
      runInputModal: null,
      runtimeInputPromptSeenRef: { current: new Set<string>() },
      setRunInputModal,
      setNotice
    });

    expect(setRunInputModal).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });
});
