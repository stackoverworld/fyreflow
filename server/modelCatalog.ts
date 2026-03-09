import type { ProviderId, ReasoningEffort } from "./types.js";

export type ModelRuntimeAvailability = "api_and_cli" | "api_only";
export type ModelLifecycle = "current" | "legacy";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  providerId: ProviderId;
  source: "codex-local" | "claude-local" | "manual";
  contextWindowTokens: number;
  reasoningEfforts: ReasoningEffort[];
  supportsFastMode: boolean;
  supports1MContext: boolean;
  runtimeAvailability: ModelRuntimeAvailability;
  lifecycle: ModelLifecycle;
  notes?: string;
}

export const ONE_MILLION_CONTEXT_TOKENS = 1_000_000;
export const GPT_5_4_CONTEXT_WINDOW_TOKENS = 1_050_000;
export const MAX_CONTEXT_WINDOW_TOKENS = GPT_5_4_CONTEXT_WINDOW_TOKENS;

const codexXHigh: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const codexClassic: ReasoningEffort[] = ["low", "medium", "high"];
const codexMini: ReasoningEffort[] = ["medium", "high"];
const codexProXHigh: ReasoningEffort[] = ["medium", "high", "xhigh"];
const claudeEffort: ReasoningEffort[] = ["low", "medium", "high"];

const fullRuntime: ModelRuntimeAvailability = "api_and_cli";
const apiOnlyRuntime: ModelRuntimeAvailability = "api_only";
const currentLifecycle: ModelLifecycle = "current";
const legacyLifecycle: ModelLifecycle = "legacy";

const codexModels: ModelCatalogEntry[] = [
  {
    id: "gpt-5.4",
    label: "gpt-5.4",
    providerId: "openai",
    source: "manual",
    contextWindowTokens: GPT_5_4_CONTEXT_WINDOW_TOKENS,
    reasoningEfforts: codexXHigh,
    supportsFastMode: true,
    supports1MContext: true,
    runtimeAvailability: fullRuntime,
    lifecycle: currentLifecycle,
    notes:
      "GPT-5.4 default. OpenAI's March 5, 2026 release ships 1,050,000-token default context, fast mode, and full CLI/API overlap."
  },
  {
    id: "gpt-5.4-pro",
    label: "gpt-5.4-pro",
    providerId: "openai",
    source: "manual",
    contextWindowTokens: GPT_5_4_CONTEXT_WINDOW_TOKENS,
    reasoningEfforts: codexProXHigh,
    supportsFastMode: true,
    supports1MContext: true,
    runtimeAvailability: apiOnlyRuntime,
    lifecycle: currentLifecycle,
    notes:
      "GPT-5.4 Pro is Responses API-only. Show it only when OpenAI has an API-capable credential or imported Codex access token."
  },
  {
    id: "gpt-5.3-codex",
    label: "gpt-5.3-codex",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Older Codex-tuned model kept for compatibility; hidden from curated selectors by default."
  },
  {
    id: "gpt-5.2-codex",
    label: "gpt-5.2-codex",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Older Codex-tuned model kept for compatibility; hidden from curated selectors by default."
  },
  {
    id: "gpt-5.1-codex-max",
    label: "gpt-5.1-codex-max",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Older Codex-tuned model kept for compatibility; hidden from curated selectors by default."
  },
  {
    id: "gpt-5.1-codex",
    label: "gpt-5.1-codex",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexClassic,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Older Codex-tuned model kept for compatibility; hidden from curated selectors by default."
  },
  {
    id: "gpt-5.2",
    label: "gpt-5.2",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Still supported, but hidden from curated selectors by default."
  },
  {
    id: "gpt-5.1",
    label: "gpt-5.1",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexClassic,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Still supported, but hidden from curated selectors by default."
  },
  {
    id: "gpt-5.1-codex-mini",
    label: "gpt-5.1-codex-mini",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexMini,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Still supported, but hidden from curated selectors by default."
  }
];

const claudeModels: ModelCatalogEntry[] = [
  {
    id: "claude-sonnet-4-6",
    label: "claude-sonnet-4-6",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: true,
    runtimeAvailability: fullRuntime,
    lifecycle: currentLifecycle,
    notes: "Sonnet 4.6 support referenced in local CHANGELOG. 1M context is optional via toggle."
  },
  {
    id: "claude-opus-4-6",
    label: "claude-opus-4-6",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: true,
    supports1MContext: true,
    runtimeAvailability: fullRuntime,
    lifecycle: currentLifecycle,
    notes: "Opus 4.6 and fast mode referenced in local CHANGELOG. 1M context is optional via toggle."
  },
  {
    id: "claude-haiku-4-5",
    label: "claude-haiku-4-5",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: currentLifecycle,
    notes: "Haiku 4.5 is the low-cost Claude option for lightweight utility steps."
  },
  {
    id: "claude-sonnet-4-5-20250929",
    label: "claude-sonnet-4-5-20250929",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Older Claude generation kept for compatibility; hidden from curated selectors by default."
  },
  {
    id: "claude-opus-4-5-20251101",
    label: "claude-opus-4-5-20251101",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Older Claude generation kept for compatibility; hidden from curated selectors by default."
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "claude-haiku-4-5-20251001",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle,
    notes: "Older Claude generation kept for compatibility; hidden from curated selectors by default."
  },
  {
    id: "sonnet",
    label: "sonnet (alias)",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: true,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle
  },
  {
    id: "opus",
    label: "opus (alias)",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: true,
    supports1MContext: true,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle
  },
  {
    id: "haiku",
    label: "haiku (alias)",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false,
    runtimeAvailability: fullRuntime,
    lifecycle: legacyLifecycle
  }
];

export const MODEL_CATALOG: Record<ProviderId, ModelCatalogEntry[]> = {
  openai: codexModels,
  claude: claudeModels
};

export function getModelEntry(providerId: ProviderId, modelId: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[providerId].find((entry) => entry.id === modelId);
}

export function resolveDefaultModel(providerId: ProviderId): string {
  if (providerId === "claude") {
    return "claude-sonnet-4-6";
  }
  return "gpt-5.4";
}

export function resolveDefaultContextWindow(providerId: ProviderId, modelId?: string): number {
  if (modelId) {
    const entry = getModelEntry(providerId, modelId);
    if (entry) {
      return entry.contextWindowTokens;
    }
  }

  if (providerId === "claude") {
    return 200_000;
  }
  return 272_000;
}

export function modelUsesExtendedContextByDefault(entry: ModelCatalogEntry | undefined): boolean {
  return (entry?.contextWindowTokens ?? 0) >= ONE_MILLION_CONTEXT_TOKENS;
}

export function resolve1MContextEnabled(providerId: ProviderId, modelId: string, requested: boolean): boolean {
  const entry = getModelEntry(providerId, modelId);
  if (!entry) {
    return requested;
  }

  return modelUsesExtendedContextByDefault(entry) || (requested && entry.supports1MContext === true);
}

export function resolveMinimumContextWindow(providerId: ProviderId, modelId: string, use1MContext: boolean): number {
  const entry = getModelEntry(providerId, modelId);
  const baseContextWindow = resolveDefaultContextWindow(providerId, modelId);
  if (modelUsesExtendedContextByDefault(entry)) {
    return baseContextWindow;
  }

  if (use1MContext) {
    return Math.max(baseContextWindow, ONE_MILLION_CONTEXT_TOKENS);
  }

  return baseContextWindow;
}

export function modelRequiresApiCapability(providerId: ProviderId, modelId: string): boolean {
  return getModelEntry(providerId, modelId)?.runtimeAvailability === apiOnlyRuntime;
}

export function resolveReasoning(
  providerId: ProviderId,
  requested: unknown,
  modelId?: string,
  fallback: ReasoningEffort = "medium"
): ReasoningEffort {
  const entry = modelId ? getModelEntry(providerId, modelId) : undefined;
  const supported = entry?.reasoningEfforts ?? ["minimal", "low", "medium", "high", "xhigh"];
  if (requested === "minimal" || requested === "low" || requested === "medium" || requested === "high" || requested === "xhigh") {
    if (supported.includes(requested)) {
      return requested;
    }
  }

  return supported.includes(fallback) ? fallback : supported[0] ?? "medium";
}
