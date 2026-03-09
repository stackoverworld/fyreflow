import { collectJsonCandidates } from "./jsonCandidates.js";
import {
  flowDecisionSchema,
  generatedFlowSchema
} from "./schemas.js";
import type { FlowDecision, GeneratedFlowSpec } from "./schemas.js";
import { isRecord, normalizeAction, normalizeFlowDecision, normalizeGeneratedFlow } from "./normalizers.js";

export { flowDecisionSchema, generatedFlowSchema };
export type { FlowDecision, GeneratedFlowSpec };

export interface RecoveredFlowDecisionEnvelope {
  action?: FlowDecision["action"];
  message?: string;
  flow?: GeneratedFlowSpec;
}

function parseGeneratedFlowValue(raw: unknown): GeneratedFlowSpec | null {
  const validated = generatedFlowSchema.safeParse(normalizeGeneratedFlow(raw));
  return validated.success ? validated.data : null;
}

export function parseGeneratedFlow(rawOutput: string): GeneratedFlowSpec | null {
  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = parseGeneratedFlowValue(parsed);
      if (validated) {
        return validated;
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

export function recoverFlowDecisionEnvelope(rawOutput: string): RecoveredFlowDecisionEnvelope | null {
  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const normalized = normalizeFlowDecision(parsed);
      if (!isRecord(normalized)) {
        continue;
      }

      const action = normalizeAction(normalized.action);
      const message =
        typeof normalized.message === "string" && normalized.message.trim().length > 0
          ? normalized.message.trim()
          : undefined;
      const flow = normalized.flow !== undefined ? parseGeneratedFlowValue(normalized.flow) : undefined;

      if (action || message || flow) {
        return {
          action,
          message,
          flow
        };
      }
    } catch {
      // continue
    }
  }

  return null;
}
