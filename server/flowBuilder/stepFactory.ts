import { nanoid } from "nanoid";
import {
  resolveDefaultContextWindow,
  resolveReasoning
} from "../modelCatalog.js";
import type { PipelineStep } from "../types.js";
import type { FlowBuilderRequest } from "./contracts.js";

export function isSimulatedProviderOutput(rawOutput: string): boolean {
  return rawOutput.trimStart().startsWith("[Simulated ");
}

export function createGeneratorStep(
  request: FlowBuilderRequest,
  name: string,
  prompt: string
): PipelineStep {
  const use1MContext =
    request.providerId === "claude" && request.use1MContext === true;
  const baseContext = resolveDefaultContextWindow(
    request.providerId,
    request.model
  );

  return {
    id: nanoid(),
    name,
    role: "planner",
    prompt,
    providerId: request.providerId,
    model: request.model,
    reasoningEffort: resolveReasoning(
      request.providerId,
      request.reasoningEffort,
      request.model,
      "medium"
    ),
    fastMode: request.providerId === "claude" ? request.fastMode === true : false,
    use1MContext,
    contextWindowTokens: use1MContext ? Math.max(baseContext, 1_000_000) : baseContext,
    position: { x: 80, y: 120 },
    contextTemplate: "Task:\n{{task}}\n\nContext:\n{{previous_output}}",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: []
  };
}
