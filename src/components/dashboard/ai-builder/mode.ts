export type AiBuilderMode = "agent" | "ask";

export const DEFAULT_AI_BUILDER_MODE: AiBuilderMode = "agent";

export const ASK_MODE_MUTATION_BLOCK_MESSAGE =
  "Ask mode is read-only. Switch to Agent mode to request flow changes.";

export const ASK_MODE_MUTATION_BLOCK_NOTICE =
  "Ask mode blocked a flow edit request. Switch to Agent mode to edit the flow.";

const REPLACE_INTENT_PHRASES = [
  "replace flow",
  "replace this flow",
  "from scratch",
  "start over",
  "brand new",
  "recreate",
  "new flow"
] as const;

const MUTATION_INTENT_KEYWORDS = [
  "build",
  "create",
  "generate",
  "make",
  "update",
  "modify",
  "change",
  "edit",
  "add",
  "remove",
  "delete",
  "rework"
] as const;

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase();
}

export function hasReplaceIntent(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return REPLACE_INTENT_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function hasMutationIntent(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return MUTATION_INTENT_KEYWORDS.some((keyword) => normalized.includes(keyword)) || hasReplaceIntent(normalized);
}

export function resolveAiBuilderMode(mode: AiBuilderMode, mutationLocked: boolean): AiBuilderMode {
  if (mutationLocked) {
    return "ask";
  }
  return mode;
}

export function canSendPromptToFlowMutationEndpoint(mode: AiBuilderMode, prompt: string): boolean {
  return !(mode === "ask" && hasMutationIntent(prompt));
}
