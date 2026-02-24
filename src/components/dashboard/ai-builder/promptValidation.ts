export const FLOW_BUILDER_PROMPT_MIN_CHARS = 2;
export const FLOW_BUILDER_PROMPT_MAX_CHARS = 64_000;

export function normalizeFlowBuilderPrompt(prompt: string): string {
  return prompt.trim();
}

export function isFlowBuilderPromptTooLong(prompt: string): boolean {
  return normalizeFlowBuilderPrompt(prompt).length > FLOW_BUILDER_PROMPT_MAX_CHARS;
}

export function getFlowBuilderPromptLength(normalizedPrompt: string): number {
  return normalizedPrompt.length;
}
