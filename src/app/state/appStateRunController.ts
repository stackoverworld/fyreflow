import { getRunStartupCheck, listRuns, pauseRun, resolveRunApproval, resumeRun, savePipelineSecureInputs, startRun, stopRun } from "@/lib/api";
import { isActiveRunStatus } from "@/lib/pipelineDraft";
import { normalizeSmartRunInputs } from "@/lib/smartRunInputs";
import type { DashboardState } from "@/lib/types";
import type { Dispatch, SetStateAction } from "react";
import { collectSecretInputsToSave, resolveRunActionTarget } from "./appStateRunHelpers";
import type { RunInputModalContext, RunInputModalSource } from "./appStateTypes";

export type HandleStartRunOptions = {
  pipelineId?: string;
  source?: RunInputModalSource;
  runId?: string;
  skipAutosaveCheck?: boolean;
  skipActiveRunCheck?: boolean;
};

type SetRuns = Dispatch<SetStateAction<DashboardState["runs"]>>;
type SetPipelineTransitionId = Dispatch<SetStateAction<string | null>>;

interface RunStartupCheckBeforeStartArgs {
  pipelineId: string;
  task: string;
  inputs: Record<string, string>;
  source: RunInputModalSource;
  runId?: string;
  setNotice: (notice: string) => void;
  setRunInputModal: Dispatch<SetStateAction<RunInputModalContext | null>>;
}

export async function runStartupCheckBeforeStart({
  pipelineId,
  task,
  inputs,
  source,
  runId,
  setNotice,
  setRunInputModal
}: RunStartupCheckBeforeStartArgs): Promise<"pass" | "needs_input" | "blocked"> {
  const response = await getRunStartupCheck(pipelineId, task, inputs);
  const check = response.check;

  if (check.status === "blocked") {
    const firstBlocker = check.blockers[0];
    setNotice(check.summary || firstBlocker?.message || "Startup check failed.");
    return "blocked";
  }

  if (check.requests.length > 0) {
    setRunInputModal({
      source,
      pipelineId,
      runId,
      task,
      requests: check.requests,
      blockers: check.blockers,
      summary: check.summary,
      inputs,
      confirmLabel: source === "runtime" ? "Apply & Restart Run" : "Apply & Start Run"
    });
    return "needs_input";
  }

  if (check.status === "needs_input") {
    setNotice(check.summary || "Additional inputs are required before run.");
    return "needs_input";
  }

  return "pass";
}

interface LaunchRunArgs {
  pipelineId: string;
  task: string;
  inputs: Record<string, string>;
  setRuns: SetRuns;
  setNotice: (notice: string) => void;
}

export async function launchRunAndRefresh({ pipelineId, task, inputs, setRuns, setNotice }: LaunchRunArgs): Promise<void> {
  const response = await startRun(pipelineId, task, inputs);
  setRuns((current) => [response.run, ...current].slice(0, 40));
  setNotice("Flow run started.");

  const refreshed = await listRuns(40);
  setRuns(refreshed.runs);
}

interface RunTransitionActionArgs {
  runId?: string;
  activePipelineRun: DashboardState["runs"][number] | null;
  runs: DashboardState["runs"];
  selectedPipelineId: string | null;
  setTransitionPipelineId: SetPipelineTransitionId;
  setRuns: SetRuns;
  setNotice: (notice: string) => void;
  missingNotice: string;
  successNotice: string;
  failureNotice: string;
  runAction: (runId: string) => Promise<{ run: DashboardState["runs"][number] }>;
}

async function executeRunTransitionAction({
  runId,
  activePipelineRun,
  runs,
  selectedPipelineId,
  setTransitionPipelineId,
  setRuns,
  setNotice,
  missingNotice,
  successNotice,
  failureNotice,
  runAction
}: RunTransitionActionArgs): Promise<void> {
  const { targetRunId, targetPipelineId } = resolveRunActionTarget(runId, activePipelineRun, runs, selectedPipelineId);
  if (!targetRunId) {
    setNotice(missingNotice);
    return;
  }

  if (targetPipelineId) {
    setTransitionPipelineId(targetPipelineId);
  }

  try {
    const response = await runAction(targetRunId);
    setRuns((current) => current.map((run) => (run.id === response.run.id ? response.run : run)));
    setNotice(successNotice);

    const refreshed = await listRuns(40);
    setRuns(refreshed.runs);
  } catch (error) {
    const message = error instanceof Error ? error.message : failureNotice;
    setNotice(message);
  } finally {
    if (targetPipelineId) {
      setTransitionPipelineId((current) => (current === targetPipelineId ? null : current));
    }
  }
}

interface RunTransitionArgs {
  runId?: string;
  activePipelineRun: DashboardState["runs"][number] | null;
  runs: DashboardState["runs"];
  selectedPipelineId: string | null;
  setTransitionPipelineId: SetPipelineTransitionId;
  setRuns: SetRuns;
  setNotice: (notice: string) => void;
}

export async function stopRunAndRefresh(args: RunTransitionArgs): Promise<void> {
  await executeRunTransitionAction({
    ...args,
    missingNotice: "No active run to stop.",
    successNotice: "Flow run stopped.",
    failureNotice: "Failed to stop run",
    runAction: stopRun
  });
}

export async function pauseRunAndRefresh(args: RunTransitionArgs): Promise<void> {
  await executeRunTransitionAction({
    ...args,
    missingNotice: "No active run to pause.",
    successNotice: "Flow run paused.",
    failureNotice: "Failed to pause run",
    runAction: pauseRun
  });
}

export async function resumeRunAndRefresh(args: RunTransitionArgs): Promise<void> {
  await executeRunTransitionAction({
    ...args,
    missingNotice: "No paused run to resume.",
    successNotice: "Flow run resumed.",
    failureNotice: "Failed to resume run",
    runAction: resumeRun
  });
}

interface ResolveRunApprovalArgs {
  runId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  note?: string;
  setResolvingApprovalId: SetPipelineTransitionId;
  setRuns: SetRuns;
  setNotice: (notice: string) => void;
}

export async function resolveRunApprovalAndRefresh({
  runId,
  approvalId,
  decision,
  note,
  setResolvingApprovalId,
  setRuns,
  setNotice
}: ResolveRunApprovalArgs): Promise<void> {
  setResolvingApprovalId(approvalId);

  try {
    const response = await resolveRunApproval(runId, approvalId, decision, note);
    setRuns((current) => current.map((run) => (run.id === response.run.id ? response.run : run)));
    setNotice(decision === "approved" ? "Manual approval granted." : "Manual approval rejected.");

    const refreshed = await listRuns(40);
    setRuns(refreshed.runs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve manual approval";
    setNotice(message);
  } finally {
    setResolvingApprovalId((current) => (current === approvalId ? null : current));
  }
}

type StopRunHandler = (runId?: string) => Promise<void>;
type StartRunHandler = (
  task: string,
  inputs?: Record<string, string>,
  options?: HandleStartRunOptions
) => Promise<void>;

interface ConfirmRunInputModalArgs {
  runInputModal: RunInputModalContext | null;
  submittedValues: Record<string, string>;
  runs: DashboardState["runs"];
  selectedPipelineId: string | null;
  persistRunDraftInputs: (task: string, inputs: Record<string, string>) => void;
  setRunInputModal: Dispatch<SetStateAction<RunInputModalContext | null>>;
  setProcessingRunInputModal: Dispatch<SetStateAction<boolean>>;
  handleStopRun: StopRunHandler;
  handleStartRun: StartRunHandler;
}

export async function confirmRunInputModalAndRestart({
  runInputModal,
  submittedValues,
  runs,
  selectedPipelineId,
  persistRunDraftInputs,
  setRunInputModal,
  setProcessingRunInputModal,
  handleStopRun,
  handleStartRun
}: ConfirmRunInputModalArgs): Promise<void> {
  if (!runInputModal) {
    return;
  }

  const mergedInputs = normalizeSmartRunInputs({
    ...runInputModal.inputs,
    ...submittedValues
  });
  persistRunDraftInputs(runInputModal.task, mergedInputs);
  setProcessingRunInputModal(true);

  try {
    const modalContext = runInputModal;
    setRunInputModal(null);

    const secureInputsToSave = collectSecretInputsToSave(modalContext.requests, mergedInputs);

    if (Object.keys(secureInputsToSave).length > 0) {
      await savePipelineSecureInputs(modalContext.pipelineId, secureInputsToSave);
    }

    if (modalContext.source === "runtime" && modalContext.runId) {
      const run = runs.find((entry) => entry.id === modalContext.runId);
      if (run && isActiveRunStatus(run.status)) {
        await handleStopRun(modalContext.runId);
      }
    }

    await handleStartRun(modalContext.task, mergedInputs, {
      pipelineId: modalContext.pipelineId,
      source: modalContext.source,
      runId: modalContext.runId,
      skipAutosaveCheck: modalContext.pipelineId !== selectedPipelineId
    });
  } finally {
    setProcessingRunInputModal(false);
  }
}
