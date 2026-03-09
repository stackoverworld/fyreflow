export type SharedFlowBuilderAction = "answer" | "update_current_flow" | "replace_flow";

export interface FlowBuilderDraftMetrics {
  stepCount?: number;
  linkCount?: number;
}

const REPLACE_INTENT_PHRASES = [
  "replace flow",
  "replace this flow",
  "from scratch",
  "start over",
  "brand new",
  "recreate",
  "new flow",
  "с нуля",
  "заново",
  "с чистого листа",
  "пересоздай",
  "пересобери",
  "новый флоу",
  "новый flow",
  "новый пайплайн",
  "new pipeline"
] as const;

const MUTATION_INTENT_KEYWORDS = [
  "build",
  "create",
  "generate",
  "make",
  "fix",
  "update",
  "modify",
  "change",
  "edit",
  "add",
  "remove",
  "delete",
  "rework",
  "исправ",
  "обнов",
  "измени",
  "отредакт",
  "добав",
  "удал",
  "созда",
  "сгенер",
  "постро",
  "сдела",
  "переработ",
  "организ",
  "выстро",
  "настро",
  "перепиш",
  "собер"
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

export function isMutationAction(action: SharedFlowBuilderAction): action is "update_current_flow" | "replace_flow" {
  return action === "update_current_flow" || action === "replace_flow";
}

export function defaultFlowBuilderMessage(
  action: SharedFlowBuilderAction,
  draftMetrics?: FlowBuilderDraftMetrics
): string {
  if (action === "answer") {
    return "Answered without changing the flow.";
  }

  const stepCount = draftMetrics?.stepCount ?? 0;
  const linkCount = draftMetrics?.linkCount ?? 0;

  if (action === "update_current_flow") {
    return `Updated current flow: ${stepCount} step(s), ${linkCount} link(s).`;
  }

  return `Created a new flow: ${stepCount} step(s), ${linkCount} link(s).`;
}

export function isSafeMutationMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 280) {
    return false;
  }

  if (/[\r\n]/.test(trimmed)) {
    return false;
  }

  if (/[{}[\]`]/.test(trimmed) || /"message"\s*:/.test(trimmed)) {
    return false;
  }

  return !/^(looking at|here(?:'|’)s what|applying|let me|i(?:'|’)ll|i will|first,|1\.\s|- )/i.test(trimmed);
}

export function resolveFlowBuilderMessage(
  action: SharedFlowBuilderAction,
  message: string | undefined,
  draftMetrics?: FlowBuilderDraftMetrics
): string {
  const fallback = defaultFlowBuilderMessage(action, draftMetrics);
  const trimmed = message?.trim() ?? "";

  if (action === "answer") {
    return trimmed.length > 0 ? trimmed : fallback;
  }

  if (!isSafeMutationMessage(trimmed)) {
    return fallback;
  }

  return trimmed;
}
