import { hasMutationIntent, hasReplaceIntent } from "@shared/flowBuilder/rules";

export type AiBuilderMode = "agent" | "ask";
export { hasMutationIntent, hasReplaceIntent };

export const DEFAULT_AI_BUILDER_MODE: AiBuilderMode = "agent";

export const ASK_MODE_MUTATION_BLOCK_MESSAGE =
  "Ask mode is read-only. Switch to Agent mode to request flow changes.";

export const ASK_MODE_MUTATION_BLOCK_NOTICE =
  "Ask mode blocked a flow edit request. Switch to Agent mode to edit the flow.";

export function resolveAiBuilderMode(mode: AiBuilderMode, mutationLocked: boolean): AiBuilderMode {
  if (mutationLocked) {
    return "ask";
  }
  return mode;
}

export function canSendPromptToFlowMutationEndpoint(mode: AiBuilderMode, prompt: string): boolean {
  return !(mode === "ask" && hasMutationIntent(prompt));
}
