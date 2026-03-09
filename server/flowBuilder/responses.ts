import {
  defaultFlowBuilderMessage,
  resolveFlowBuilderMessage as resolveSharedFlowBuilderMessage,
  type FlowBuilderDraftMetrics,
  type SharedFlowBuilderAction
} from "../../packages/shared/src/flowBuilder/rules.js";
import type { PipelineInput } from "../types.js";
import type { FlowBuilderAction } from "./contracts.js";

function toDraftMetrics(draft?: PipelineInput): FlowBuilderDraftMetrics | undefined {
  if (!draft) {
    return undefined;
  }

  return {
    stepCount: draft.steps.length,
    linkCount: (draft.links ?? []).length
  };
}

export function defaultMessageForAction(
  action: FlowBuilderAction,
  draft?: PipelineInput
): string {
  return defaultFlowBuilderMessage(action as SharedFlowBuilderAction, toDraftMetrics(draft));
}

export function resolveFlowBuilderMessage(
  action: FlowBuilderAction,
  message: string | undefined,
  draft?: PipelineInput
): string {
  return resolveSharedFlowBuilderMessage(action as SharedFlowBuilderAction, message, toDraftMetrics(draft));
}

export function mergeRawOutputs(
  rawOutput: string,
  repairedOutput?: string,
  regeneratedOutput?: string
): string {
  return [
    rawOutput,
    repairedOutput ? `[repair-pass-output]\n${repairedOutput}` : "",
    regeneratedOutput ? `[regeneration-pass-output]\n${regeneratedOutput}` : ""
  ]
    .filter((entry) => entry.length > 0)
    .join("\n\n");
}
