import { nanoid } from "nanoid";
import {
  getModelEntry,
  resolve1MContextEnabled,
  resolveMinimumContextWindow,
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
  const modelMeta = getModelEntry(request.providerId, request.model);
  const use1MContext = resolve1MContextEnabled(request.providerId, request.model, request.use1MContext === true);
  const fastMode = request.fastMode === true && modelMeta?.supportsFastMode === true;
  const baseContext = resolveMinimumContextWindow(request.providerId, request.model, use1MContext);

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
    fastMode,
    use1MContext,
    contextWindowTokens: baseContext,
    position: { x: 80, y: 120 },
    contextTemplate: "Task:\n{{task}}\n\nContext:\n{{previous_output}}",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    sandboxMode: "secure",
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: []
  };
}
