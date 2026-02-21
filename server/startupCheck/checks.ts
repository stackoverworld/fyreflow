import type { DashboardState, Pipeline, RunInputRequest, RunStartupBlocker, SmartRunField } from "../types.js";
import type { RunInputs } from "../runInputs.js";
import { hasInputValue as hasInputValueInternal } from "./checkEnvironment.js";
import { dedupeBlockers as dedupeBlockersInternal } from "./checkPersistence.js";
import { mergeRequests as mergeRequestsInternal, missingFieldRequest as missingFieldRequestInternal } from "./checkEnvironment.js";
import { parseModelStartupResult as parseModelStartupResultInternal } from "./checkContracts.js";
import { runModelStartupCheck as runModelStartupCheckInternal } from "./checkNetwork.js";
import { type ParsedModelStartupResult } from "./types.js";

export function parseModelStartupResult(rawOutput: string): ParsedModelStartupResult | null {
  return parseModelStartupResultInternal(rawOutput);
}

export function missingFieldRequest(field: SmartRunField): RunInputRequest {
  return missingFieldRequestInternal(field);
}

export function hasInputValue(runInputs: RunInputs, key: string): boolean {
  return hasInputValueInternal(runInputs, key);
}

export function mergeRequests(
  deterministic: RunInputRequest[],
  model: RunInputRequest[],
  runInputs: RunInputs
): RunInputRequest[] {
  return mergeRequestsInternal(deterministic, model, runInputs);
}

export function dedupeBlockers(blockers: RunStartupBlocker[]): RunStartupBlocker[] {
  return dedupeBlockersInternal(blockers);
}

export async function runModelStartupCheck(
  pipeline: Pipeline,
  state: DashboardState,
  task: string,
  runInputs: RunInputs,
  deterministicRequests: RunInputRequest[],
  deterministicBlockers: RunStartupBlocker[]
): Promise<ParsedModelStartupResult | null> {
  return runModelStartupCheckInternal(
    pipeline,
    state,
    task,
    runInputs,
    deterministicRequests,
    deterministicBlockers
  );
}
