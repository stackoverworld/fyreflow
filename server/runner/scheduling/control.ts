import type { LocalStore } from "../../storage.js";
import type { PipelineRun } from "../../types.js";
import { RUN_CONTROL_POLL_MS } from "./constants.js";

export function isRunTerminalStatus(status: PipelineRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function hasPendingApprovals(run: PipelineRun): boolean {
  return run.approvals.some((approval) => approval.status === "pending");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForRunToBeRunnable(
  store: LocalStore,
  runId: string,
  abortSignal?: AbortSignal
): Promise<boolean> {
  while (true) {
    if (abortSignal?.aborted) {
      return false;
    }

    const run = store.getRun(runId);
    if (!run) {
      return false;
    }

    if (isRunTerminalStatus(run.status)) {
      return false;
    }

    if (run.status === "awaiting_approval" && !hasPendingApprovals(run)) {
      store.updateRun(runId, (current) => {
        if (current.status !== "awaiting_approval" || hasPendingApprovals(current)) {
          return current;
        }

        return {
          ...current,
          status: "running",
          logs: [...current.logs, "Recovered from awaiting_approval state with no pending approvals."]
        };
      });
      return true;
    }

    if (run.status === "paused" || run.status === "awaiting_approval") {
      await sleep(RUN_CONTROL_POLL_MS);
      continue;
    }

    return true;
  }
}
