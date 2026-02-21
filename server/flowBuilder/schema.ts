import { collectJsonCandidates } from "./jsonCandidates.js";
import {
  flowDecisionSchema,
  generatedFlowSchema
} from "./schemas.js";
import type { FlowDecision, GeneratedFlowSpec } from "./schemas.js";
import { normalizeFlowDecision, normalizeGeneratedFlow } from "./normalizers.js";

export { flowDecisionSchema, generatedFlowSchema };
export type { FlowDecision, GeneratedFlowSpec };

export function parseGeneratedFlow(rawOutput: string): GeneratedFlowSpec | null {
  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = generatedFlowSchema.safeParse(normalizeGeneratedFlow(parsed));
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // continue
    }
  }

  return null;
}

export function parseFlowDecision(rawOutput: string): FlowDecision | null {
  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = flowDecisionSchema.safeParse(normalizeFlowDecision(parsed));
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // continue
    }
  }
  return null;
}
