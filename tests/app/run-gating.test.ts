import { beforeEach, describe, expect, it, vi } from "vitest";

const runControllerMocks = vi.hoisted(() => ({
  confirmRunInputModalAndRestart: vi.fn(),
  launchRunAndRefresh: vi.fn(),
  pauseRunAndRefresh: vi.fn(),
  resolveRunApprovalAndRefresh: vi.fn(),
  runStartupCheckBeforeStart: vi.fn(),
  stopRunAndRefresh: vi.fn(),
  resumeRunAndRefresh: vi.fn()
}));

vi.mock("../../src/app/state/appStateRunController.ts", () => ({
  confirmRunInputModalAndRestart: runControllerMocks.confirmRunInputModalAndRestart,
  launchRunAndRefresh: runControllerMocks.launchRunAndRefresh,
  pauseRunAndRefresh: runControllerMocks.pauseRunAndRefresh,
  resolveRunApprovalAndRefresh: runControllerMocks.resolveRunApprovalAndRefresh,
  runStartupCheckBeforeStart: runControllerMocks.runStartupCheckBeforeStart,
  stopRunAndRefresh: runControllerMocks.stopRunAndRefresh,
  resumeRunAndRefresh: runControllerMocks.resumeRunAndRefresh
}));

import { selectRunPanelFlags } from "../../src/app/state/appStateSelectors.ts";
import { handleStartRunAction } from "../../src/app/state/controller/actions/executionActions.ts";

describe("run gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runControllerMocks.runStartupCheckBeforeStart.mockResolvedValue("pass");
    runControllerMocks.launchRunAndRefresh.mockResolvedValue(undefined);
  });

  it("disables run panel toggle while AI chat is updating the selected flow", () => {
    const flags = selectRunPanelFlags(
      "pipeline-1",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      "",
      true
    );

    expect(flags.runPanelToggleDisabled).toBe(true);
    expect(flags.runTooltip).toBe("AI is updating this flow. Wait until it finishes before running.");
    expect(flags.selectedPipelineEditLocked).toBe(false);
  });

  it("blocks starting a run while AI chat is updating the selected flow", async () => {
    const setNotice = vi.fn();
    const persistRunDraftInputs = vi.fn();
    const setStartingRunPipelineId = vi.fn();
    const setRunInputModal = vi.fn();
    const setRuns = vi.fn();

    await handleStartRunAction("Ship release", { branch: "main" }, undefined, {
      selectedPipelineId: "pipeline-1",
      setNotice,
      setRunInputModal,
      persistRunDraftInputs,
      runs: [],
      pipelineSaveValidationError: "",
      savingPipeline: false,
      isDirty: false,
      aiChatPending: true,
      setStartingRunPipelineId,
      setRuns
    });

    expect(setNotice).toHaveBeenCalledWith("AI is updating this flow. Wait for it to finish before running.");
    expect(persistRunDraftInputs).not.toHaveBeenCalled();
    expect(setStartingRunPipelineId).not.toHaveBeenCalled();
    expect(runControllerMocks.runStartupCheckBeforeStart).not.toHaveBeenCalled();
    expect(runControllerMocks.launchRunAndRefresh).not.toHaveBeenCalled();
  });

  it("allows starting another pipeline run while selected flow has AI chat pending", async () => {
    const setNotice = vi.fn();
    const persistRunDraftInputs = vi.fn();
    const setStartingRunPipelineId = vi.fn();
    const setRunInputModal = vi.fn();
    const setRuns = vi.fn();

    await handleStartRunAction("Ship release", { branch: "main" }, { pipelineId: "pipeline-2" }, {
      selectedPipelineId: "pipeline-1",
      setNotice,
      setRunInputModal,
      persistRunDraftInputs,
      runs: [],
      pipelineSaveValidationError: "",
      savingPipeline: false,
      isDirty: false,
      aiChatPending: true,
      setStartingRunPipelineId,
      setRuns
    });

    expect(persistRunDraftInputs).toHaveBeenCalledWith("Ship release", { branch: "main" });
    expect(setStartingRunPipelineId).toHaveBeenCalledWith("pipeline-2");
    expect(runControllerMocks.runStartupCheckBeforeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "pipeline-2"
      })
    );
    expect(runControllerMocks.launchRunAndRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "pipeline-2"
      })
    );
    expect(setNotice).not.toHaveBeenCalledWith("AI is updating this flow. Wait for it to finish before running.");
  });
});
