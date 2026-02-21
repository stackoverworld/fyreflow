import { normalizeRunInputs } from "./runInputs.js";
import { buildSmartRunPlan } from "./smartRun.js";
import type {
  DashboardState,
  Pipeline,
  RunStartupBlocker,
  RunStartupCheck
} from "./types.js";
import {
  dedupeBlockers,
  hasInputValue,
  mergeRequests,
  missingFieldRequest,
  runModelStartupCheck
} from "./startupCheck/checks.js";
import { summarizeStatus } from "./startupCheck/reporting.js";
import type { BuildStartupCheckInput } from "./startupCheck/types.js";

export async function buildRunStartupCheck(
  pipeline: Pipeline,
  state: DashboardState,
  input: BuildStartupCheckInput = {}
): Promise<RunStartupCheck> {
  const runInputs = normalizeRunInputs(input.inputs);
  const task = typeof input.task === "string" ? input.task.trim() : "";
  const smartPlan = await buildSmartRunPlan(pipeline, state, runInputs);

  const deterministicRequests = smartPlan.fields
    .filter((field) => field.required && !hasInputValue(runInputs, field.key))
    .map((field) => missingFieldRequest(field));

  const deterministicBlockers: RunStartupBlocker[] = smartPlan.checks
    .filter((check) => check.status === "fail" && !check.id.startsWith("input:"))
    .map((check) => ({
      id: check.id,
      title: check.title,
      message: check.message,
      details: check.details
    }));

  let modelResult = null;
  const notes: string[] = [];

  try {
    modelResult = await runModelStartupCheck(pipeline, state, task, runInputs, deterministicRequests, deterministicBlockers);
    if (!modelResult) {
      notes.push("AI startup-check unavailable. Used deterministic checks.");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "startup-check provider error";
    notes.push(`AI startup-check failed: ${reason}`);
  }

  const mergedRequests = mergeRequests(deterministicRequests, modelResult?.requests ?? [], runInputs);
  const mergedBlockers = dedupeBlockers([...(deterministicBlockers ?? []), ...(modelResult?.blockers ?? [])]);

  let status: RunStartupCheck["status"] = "pass";
  if (mergedBlockers.length > 0 || modelResult?.status === "blocked") {
    status = "blocked";
  } else if (mergedRequests.length > 0 || modelResult?.status === "needs_input") {
    status = "needs_input";
  }

  const summary = summarizeStatus(status, mergedRequests, mergedBlockers, modelResult?.summary);

  let source: RunStartupCheck["source"] = "deterministic";
  if (modelResult) {
    source = deterministicRequests.length > 0 || deterministicBlockers.length > 0 ? "merged" : "model";
  }

  return {
    status,
    summary,
    requests: mergedRequests,
    blockers: mergedBlockers,
    source,
    notes: [...(modelResult?.notes ?? []), ...notes]
  };
}
