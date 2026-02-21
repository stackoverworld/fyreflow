import {
  executeProviderStep
} from "../providers.js";
import {
  buildVerifierContext,
  buildVerifierPrompt
} from "./reporting.js";
import type {
  DashboardState,
  Pipeline,
  PipelineStep,
  RunInputRequest,
  RunStartupBlocker
} from "../types.js";
import type { RunInputs } from "../runInputs.js";
import { parseModelStartupResult } from "./checkContracts.js";
import { type ParsedModelStartupResult } from "./types.js";

function resolveVerifierStep(pipeline: Pipeline): PipelineStep | null {
  if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) {
    return null;
  }

  const orchestrator = pipeline.steps.find((step) => step.role === "orchestrator");
  return orchestrator ?? pipeline.steps[0] ?? null;
}

export async function runModelStartupCheck(
  pipeline: Pipeline,
  state: DashboardState,
  task: string,
  runInputs: RunInputs,
  deterministicRequests: RunInputRequest[],
  deterministicBlockers: RunStartupBlocker[]
): Promise<ParsedModelStartupResult | null> {
  const verifierBaseStep = resolveVerifierStep(pipeline);
  if (!verifierBaseStep) {
    return null;
  }

  const provider = state.providers[verifierBaseStep.providerId];
  if (!provider) {
    return null;
  }

  const step: PipelineStep = {
    ...verifierBaseStep,
    prompt: buildVerifierPrompt(),
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: []
  };

  const context = buildVerifierContext(pipeline, task, runInputs, deterministicRequests, deterministicBlockers);
  const output = await executeProviderStep({
    provider,
    step,
    context,
    task: task || `Startup check for ${pipeline.name}`,
    outputMode: "json"
  });

  return parseModelStartupResult(output);
}
