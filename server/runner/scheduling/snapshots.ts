import fs from "node:fs/promises";
import path from "node:path";
import type { LocalStore } from "../../storage.js";
import type { Pipeline, StorageConfig } from "../../types.js";
import { safeStorageSegment } from "../context.js";
import { nowIso } from "./time.js";

export function resolveRunRootPath(storage: StorageConfig, runId: string): string {
  return path.join(storage.rootPath, storage.runsFolder, safeStorageSegment(runId));
}

export async function persistPipelineSnapshot(runRootPath: string, pipeline: Pipeline): Promise<void> {
  await fs.mkdir(runRootPath, { recursive: true });
  const snapshotPath = path.join(runRootPath, "pipeline-snapshot.json");
  const payload = {
    capturedAt: nowIso(),
    pipeline
  };
  await fs.writeFile(snapshotPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function persistRunStateSnapshot(store: LocalStore, runId: string, runRootPath: string): Promise<void> {
  const run = store.getRun(runId);
  if (!run) {
    return;
  }

  await fs.mkdir(runRootPath, { recursive: true });
  const snapshot = {
    runId: run.id,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    task: run.task,
    inputs: run.inputs,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    generatedAt: nowIso(),
    logs: run.logs,
    approvals: run.approvals.map((approval) => ({
      id: approval.id,
      gateId: approval.gateId,
      gateName: approval.gateName,
      stepId: approval.stepId,
      stepName: approval.stepName,
      status: approval.status,
      blocking: approval.blocking,
      message: approval.message,
      requestedAt: approval.requestedAt,
      resolvedAt: approval.resolvedAt,
      note: approval.note
    })),
    steps: run.steps.map((step) => ({
      stepId: step.stepId,
      stepName: step.stepName,
      status: step.status,
      attempts: step.attempts,
      workflowOutcome: step.workflowOutcome,
      qualityGateResults: step.qualityGateResults,
      error: step.error
    }))
  };

  await fs.writeFile(path.join(runRootPath, "state.json"), JSON.stringify(snapshot, null, 2), "utf8");
}
