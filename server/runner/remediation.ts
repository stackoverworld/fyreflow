import { createAbortError } from "../abort.js";
import type { LocalStore } from "../storage.js";
import { normalizeStepLabel } from "../stepLabel.js";
import type { PipelineQualityGate, PipelineStep, StepQualityGateResult } from "../types.js";
import { hasPendingApprovals, sleep, RUN_CONTROL_POLL_MS } from "./scheduling.js";

function createManualApprovalId(gateId: string, stepId: string, attempt: number): string {
  return `${gateId}:${stepId}:attempt:${attempt}`;
}

function listManualApprovalGates(step: PipelineStep, qualityGates: PipelineQualityGate[]): PipelineQualityGate[] {
  return qualityGates.filter(
    (gate) => gate.kind === "manual_approval" && (gate.targetStepId === "any_step" || gate.targetStepId === step.id)
  );
}

function ensureManualApprovalsRequested(
  store: LocalStore,
  runId: string,
  step: PipelineStep,
  gates: PipelineQualityGate[],
  attempt: number
): string[] {
  const stepLabel = normalizeStepLabel(step.name, step.id);
  const approvalIds = gates.map((gate) => createManualApprovalId(gate.id, step.id, attempt));

  store.updateRun(runId, (run) => {
    const approvals = [...run.approvals];
    const addedNames: string[] = [];

    for (const [index, gate] of gates.entries()) {
      const approvalId = approvalIds[index];
      const existing = approvals.find((entry) => entry.id === approvalId);
      if (existing) {
        continue;
      }

      approvals.push({
        id: approvalId,
        gateId: gate.id,
        gateName: gate.name,
        stepId: step.id,
        stepName: stepLabel,
        status: "pending",
        blocking: gate.blocking,
        message:
          typeof gate.message === "string" && gate.message.trim().length > 0
            ? gate.message.trim()
            : `Manual approval required for "${gate.name}".`,
        requestedAt: new Date().toISOString()
      });
      addedNames.push(gate.name);
    }

    const hasPendingCurrent = approvalIds.some((approvalId) => {
      const entry = approvals.find((approval) => approval.id === approvalId);
      return entry?.status === "pending";
    });

    const nextStatus = run.status === "paused" || run.status === "completed" || run.status === "failed" || run.status === "cancelled"
      ? run.status
      : hasPendingCurrent
        ? "awaiting_approval"
        : run.status;

    return {
      ...run,
      status: nextStatus,
      approvals,
      logs:
        addedNames.length > 0
          ? [...run.logs, `${stepLabel} is waiting for manual approval: ${addedNames.join(", ")}`]
          : run.logs
    };
  });

  return approvalIds;
}

export function formatBlockingGateFailures(results: StepQualityGateResult[]): string {
  const failures = results.filter((result) => result.status === "fail" && result.blocking);
  if (failures.length === 0) {
    return "";
  }

  const lines = failures.map(
    (result, index) => `${index + 1}. ${result.gateName}: ${result.message}${result.details ? ` (${result.details})` : ""}`
  );
  return `QUALITY_GATES_BLOCKED:\n${lines.join("\n")}`;
}

export async function waitForManualApprovals(
  store: LocalStore,
  runId: string,
  step: PipelineStep,
  gates: PipelineQualityGate[],
  attempt: number,
  abortSignal?: AbortSignal
): Promise<StepQualityGateResult[]> {
  if (gates.length === 0) {
    return [];
  }

  const stepLabel = normalizeStepLabel(step.name, step.id);
  const approvalIds = ensureManualApprovalsRequested(store, runId, step, gates, attempt);

  while (true) {
    if (abortSignal?.aborted) {
      throw createAbortError("Run stopped by user");
    }

    const run = store.getRun(runId);
    if (!run) {
      throw createAbortError("Run not found");
    }

    if (run.status === "cancelled") {
      throw createAbortError("Run stopped by user");
    }

    if (run.status === "failed") {
      throw createAbortError("Run failed while waiting for manual approval");
    }

    if (run.status === "completed") {
      throw createAbortError("Run completed unexpectedly while waiting for manual approval");
    }

    const approvalsById = new Map(run.approvals.map((entry) => [entry.id, entry]));
    const hasPending = approvalIds.some((approvalId) => {
      const approval = approvalsById.get(approvalId);
      return !approval || approval.status === "pending";
    });

    if (!hasPending) {
      if (run.status === "paused") {
        await sleep(RUN_CONTROL_POLL_MS);
        continue;
      }

      store.updateRun(runId, (current) => {
        if (current.status !== "awaiting_approval") {
          return current;
        }

        if (hasPendingApprovals(current)) {
          return current;
        }

        return {
          ...current,
          status: "running",
          logs: [...current.logs, `${stepLabel} manual approvals resolved; resuming execution.`]
        };
      });
      break;
    }

    if (run.status !== "paused" && run.status !== "awaiting_approval") {
      store.updateRun(runId, (current) => {
        if (current.status === "completed" || current.status === "failed" || current.status === "cancelled" || current.status === "paused" || current.status === "awaiting_approval") {
          return current;
        }

        return {
          ...current,
          status: "awaiting_approval"
        };
      });
    }

    await sleep(RUN_CONTROL_POLL_MS);
  }

  const resolvedRun = store.getRun(runId);
  const approvalsById = new Map((resolvedRun?.approvals ?? []).map((entry) => [entry.id, entry]));

  return gates.map((gate, index) => {
    const approval = approvalsById.get(approvalIds[index]);
    const approved = approval?.status === "approved";

    return {
      gateId: gate.id,
      gateName: gate.name,
      kind: "manual_approval",
      status: approved ? "pass" : "fail",
      blocking: gate.blocking,
      message:
        gate.message && gate.message.trim().length > 0
          ? gate.message
          : approved
            ? `Manual approval granted for "${gate.name}".`
            : `Manual approval rejected for "${gate.name}".`,
      details: approval
        ? `decision=${approval.status}${approval.note ? ` note=${approval.note}` : ""}`
        : "Manual approval record missing."
    };
  });
}

export { listManualApprovalGates };
