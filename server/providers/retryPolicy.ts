import { isAbortError } from "../abort.js";
import type { PipelineStep } from "../types.js";
import type { ProviderExecutionInput } from "./types.js";

const CLAUDE_CLI_BASE_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_BASE_TIMEOUT_MS ?? "300000", 10);
  if (!Number.isFinite(raw)) {
    return 300_000;
  }
  return Math.max(60_000, Math.min(1_200_000, raw));
})();

const CLAUDE_CLI_HEAVY_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_HEAVY_TIMEOUT_MS ?? "420000", 10);
  if (!Number.isFinite(raw)) {
    return 420_000;
  }
  return Math.max(120_000, Math.min(1_200_000, raw));
})();

const CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS ?? "180000", 10);
  if (!Number.isFinite(raw)) {
    return 180_000;
  }
  return Math.max(60_000, Math.min(900_000, raw));
})();

export const CLAUDE_CLI_FALLBACK_MODEL = (process.env.CLAUDE_CLI_FALLBACK_MODEL ?? "claude-sonnet-4-6").trim();

export function buildClaudeTimeoutFallbackInput(input: ProviderExecutionInput): ProviderExecutionInput {
  const currentModel = (input.step.model || input.provider.defaultModel || "").trim();
  const shouldSwitchToFallbackModel = currentModel.length === 0 || currentModel.toLowerCase().includes("opus");
  const nextModel =
    shouldSwitchToFallbackModel && CLAUDE_CLI_FALLBACK_MODEL.length > 0 ? CLAUDE_CLI_FALLBACK_MODEL : currentModel;
  const maxChars = input.step.role === "orchestrator" ? 120_000 : 220_000;

  return {
    ...input,
    context: trimContextForRetry(input.context, maxChars),
    step: {
      ...input.step,
      model: nextModel,
      fastMode: true,
      reasoningEffort: "low",
      use1MContext: false,
      contextWindowTokens: Math.min(input.step.contextWindowTokens, 220_000)
    }
  };
}

export function resolveClaudeCliAttemptTimeoutMs(step: PipelineStep, providerDefaultModel: string): number {
  const model = (step.model || providerDefaultModel || "").toLowerCase();
  if (step.role === "orchestrator") {
    return CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS;
  }
  if (step.use1MContext || step.contextWindowTokens >= 500_000 || model.includes("opus")) {
    return CLAUDE_CLI_HEAVY_TIMEOUT_MS;
  }
  return CLAUDE_CLI_BASE_TIMEOUT_MS;
}

export function shouldTryClaudeTimeoutFallback(input: ProviderExecutionInput, error: unknown): boolean {
  if (input.provider.id !== "claude") {
    return false;
  }
  if (input.signal?.aborted) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (!(isAbortError(error) || /\btimed?\s*out\b|etimedout|timeout/i.test(message))) {
    return false;
  }

  const model = (input.step.model || input.provider.defaultModel || "").toLowerCase();
  const alreadyFast =
    input.step.fastMode &&
    (input.step.reasoningEffort === "low" || input.step.reasoningEffort === "minimal") &&
    !input.step.use1MContext &&
    !model.includes("opus");
  return !alreadyFast;
}

function trimContextForRetry(context: string, maxChars: number): string {
  if (context.length <= maxChars) {
    return context;
  }

  const lead = Math.floor(maxChars * 0.65);
  const trail = Math.floor(maxChars * 0.3);
  const head = context.slice(0, lead);
  const tail = context.slice(context.length - trail);
  return `${head}\n\n[Context trimmed for timeout fallback]\n\n${tail}`;
}
