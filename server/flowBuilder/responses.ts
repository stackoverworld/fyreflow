import type { PipelineInput } from "../types.js";
import type { FlowBuilderAction } from "./contracts.js";

export function defaultMessageForAction(
  action: FlowBuilderAction,
  draft?: PipelineInput
): string {
  if (action === "answer") {
    return "Answered without changing the current flow.";
  }

  if (!draft) {
    return action === "update_current_flow"
      ? "Updated the current flow."
      : "Created a new flow.";
  }

  if (action === "update_current_flow") {
    return `Updated current flow: ${draft.steps.length} step(s), ${(draft.links ?? []).length} link(s).`;
  }

  return `Created a new flow: ${draft.steps.length} step(s), ${(draft.links ?? []).length} link(s).`;
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
