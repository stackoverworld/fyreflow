import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getRunStartupCheck: vi.fn(),
  listRuns: vi.fn(),
  pauseRun: vi.fn(),
  resolveRunApproval: vi.fn(),
  resumeRun: vi.fn(),
  savePipelineSecureInputs: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn()
}));

vi.mock("../../src/lib/api.ts", () => ({
  getRunStartupCheck: apiMocks.getRunStartupCheck,
  listRuns: apiMocks.listRuns,
  pauseRun: apiMocks.pauseRun,
  resolveRunApproval: apiMocks.resolveRunApproval,
  resumeRun: apiMocks.resumeRun,
  savePipelineSecureInputs: apiMocks.savePipelineSecureInputs,
  startRun: apiMocks.startRun,
  stopRun: apiMocks.stopRun
}));

import { runStartupCheckBeforeStart } from "../../src/app/state/appStateRunController.ts";
import type { RunStartupCheck } from "../../src/lib/types";

function createCheck(partial: Partial<RunStartupCheck>): RunStartupCheck {
  return {
    status: "pass",
    summary: "",
    requests: [],
    blockers: [],
    source: "deterministic",
    notes: [],
    ...partial
  };
}

describe("run startup auto-correction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-corrects recoverable repo input and re-runs startup check before showing modal", async () => {
    apiMocks.getRunStartupCheck
      .mockResolvedValueOnce({
        check: createCheck({
          status: "needs_input",
          summary: "Run startup input required",
          requests: [
            {
              key: "github_repo",
              label: "GitHub Repo",
              type: "text",
              required: true,
              reason: 'Expected owner/repo format without protocol (example: "org/project").',
              defaultValue: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD"
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        check: createCheck({
          status: "pass",
          summary: "Startup check passed."
        })
      });

    const setNotice = vi.fn();
    const setRunInputModal = vi.fn();
    const inputs: Record<string, string> = {
      github_repo: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD"
    };

    const result = await runStartupCheckBeforeStart({
      pipelineId: "pipeline-1",
      task: "sync",
      inputs,
      source: "startup",
      setNotice,
      setRunInputModal
    });

    expect(result).toBe("pass");
    expect(inputs.github_repo).toBe("Lunarbase-Lab/Prop-AMM-RnD");
    expect(apiMocks.getRunStartupCheck).toHaveBeenCalledTimes(2);
    expect(setRunInputModal).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });

  it("dedupes equivalent startup requests before opening the modal", async () => {
    apiMocks.getRunStartupCheck.mockResolvedValueOnce({
      check: createCheck({
        status: "needs_input",
        summary: "Credentials are required.",
        requests: [
          {
            key: "github_repo",
            label: "GitHub Repo",
            type: "text",
            required: true,
            reason: "Repository is required."
          },
          {
            key: "github_repository",
            label: "GitHub Repository",
            type: "text",
            required: true,
            reason: "Repository is required."
          }
        ]
      })
    });

    const setNotice = vi.fn();
    const setRunInputModal = vi.fn();

    const result = await runStartupCheckBeforeStart({
      pipelineId: "pipeline-1",
      task: "sync",
      inputs: {},
      source: "startup",
      setNotice,
      setRunInputModal
    });

    expect(result).toBe("needs_input");
    expect(setRunInputModal).toHaveBeenCalledTimes(1);
    expect(setRunInputModal.mock.calls[0]?.[0]).toMatchObject({
      summary: "Credentials are required.",
      requests: [
        expect.objectContaining({
          key: "github_repo"
        })
      ]
    });
    expect(setRunInputModal.mock.calls[0]?.[0]?.requests).toHaveLength(1);
    expect(setNotice).not.toHaveBeenCalled();
  });
});
