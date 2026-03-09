import {
  hasMutationIntent as sharedHasMutationIntent,
  hasReplaceIntent as sharedHasReplaceIntent
} from "../../packages/shared/src/flowBuilder/rules.js";

export function isReplaceIntent(prompt: string): boolean {
  return sharedHasReplaceIntent(prompt);
}

export function isMutationIntent(prompt: string): boolean {
  return sharedHasMutationIntent(prompt);
}
