import { isAbortError } from "../abort.js";
import { hasActiveClaudeApiKey } from "../providerCapabilities.js";
import type { PipelineStep } from "../types.js";
import type { ProviderExecutionInput } from "./types.js";

const MAX_STAGE_TIMEOUT_MS = 18_000_000; // 5h hard ceiling

const CLAUDE_CLI_BASE_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_BASE_TIMEOUT_MS ?? "360000", 10);
  if (!Number.isFinite(raw)) {
    return 360_000;
  }
  return Math.max(60_000, Math.min(MAX_STAGE_TIMEOUT_MS, raw));
})();

const CLAUDE_CLI_HEAVY_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_HEAVY_TIMEOUT_MS ?? "420000", 10);
  if (!Number.isFinite(raw)) {
    return 420_000;
  }
  return Math.max(120_000, Math.min(MAX_STAGE_TIMEOUT_MS, raw));
})();

const CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS ?? "180000", 10);
  if (!Number.isFinite(raw)) {
    return 180_000;
  }
  return Math.max(60_000, Math.min(MAX_STAGE_TIMEOUT_MS, raw));
})();

const CLAUDE_CLI_STAGE_TIMEOUT_RESERVE_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_STAGE_TIMEOUT_RESERVE_MS ?? "30000", 10);
  if (!Number.isFinite(raw)) {
    return 30_000;
  }
  return Math.max(15_000, Math.min(120_000, raw));
})();

const CLAUDE_CLI_MIN_FALLBACK_WINDOW_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_MIN_FALLBACK_WINDOW_MS ?? "90000", 10);
  if (!Number.isFinite(raw)) {
    return 90_000;
  }
  return Math.max(30_000, Math.min(300_000, raw));
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
      fastMode: hasActiveClaudeApiKey(input.provider),
      reasoningEffort: "low",
      use1MContext: false,
      contextWindowTokens: Math.min(input.step.contextWindowTokens, 220_000)
    }
  };
}

function normalizeStageTimeoutMs(stageTimeoutMs: number | undefined): number | undefined {
  if (typeof stageTimeoutMs !== "number" || !Number.isFinite(stageTimeoutMs)) {
    return undefined;
  }
  return Math.max(60_000, Math.min(MAX_STAGE_TIMEOUT_MS, Math.floor(stageTimeoutMs)));
}

export function resolveClaudeCliAttemptTimeoutMs(
  step: PipelineStep,
  providerDefaultModel: string,
  stageTimeoutMs?: number
): number {
  const model = (step.model || providerDefaultModel || "").toLowerCase();
  let timeoutMs = step.role === "orchestrator" ? CLAUDE_CLI_ORCHESTRATOR_TIMEOUT_MS : CLAUDE_CLI_BASE_TIMEOUT_MS;

  const roleNeedsHeavyTimeout = step.role === "review" || step.role === "tester" || step.role === "executor";
  const effortNeedsHeavyTimeout = step.reasoningEffort === "high" || step.reasoningEffort === "xhigh";
  if (
    roleNeedsHeavyTimeout ||
    effortNeedsHeavyTimeout ||
    step.use1MContext ||
    step.contextWindowTokens >= 500_000 ||
    model.includes("opus")
  ) {
    timeoutMs = Math.max(timeoutMs, CLAUDE_CLI_HEAVY_TIMEOUT_MS);
  }

  const stageBudgetMs = normalizeStageTimeoutMs(stageTimeoutMs);
  if (typeof stageBudgetMs === "number") {
    const reserveMs = Math.max(15_000, Math.min(CLAUDE_CLI_STAGE_TIMEOUT_RESERVE_MS, Math.floor(stageBudgetMs * 0.15)));
    const maxAttemptMs = Math.max(60_000, stageBudgetMs - reserveMs);
    const roleNeedsLongAttempt =
      step.role === "analysis" || step.role === "executor" || step.role === "planner" || step.role === "review" || step.role === "tester";
    const modelNeedsLongAttempt =
      model.includes("opus") ||
      step.reasoningEffort === "high" ||
      step.reasoningEffort === "xhigh" ||
      step.use1MContext ||
      step.contextWindowTokens >= 500_000;

    if (roleNeedsLongAttempt || modelNeedsLongAttempt) {
      const targetFromBudgetMs = Math.floor(stageBudgetMs * 0.8);
      const targetAttemptMs = Math.max(CLAUDE_CLI_HEAVY_TIMEOUT_MS, targetFromBudgetMs);
      timeoutMs = Math.max(timeoutMs, Math.min(targetAttemptMs, maxAttemptMs));
    }

    timeoutMs = Math.min(timeoutMs, maxAttemptMs);
  }

  return Math.min(timeoutMs, MAX_STAGE_TIMEOUT_MS);
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
  if (alreadyFast) {
    return false;
  }

  const stageBudgetMs = normalizeStageTimeoutMs(input.stageTimeoutMs);
  if (typeof stageBudgetMs === "number") {
    const attemptTimeoutMs = resolveClaudeCliAttemptTimeoutMs(input.step, input.provider.defaultModel, input.stageTimeoutMs);
    const remainingBudgetMs = Math.max(0, stageBudgetMs - attemptTimeoutMs);
    if (remainingBudgetMs < CLAUDE_CLI_MIN_FALLBACK_WINDOW_MS) {
      return false;
    }
  }

  return true;
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
