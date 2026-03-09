import type { ProviderConfig, ProviderId, ProviderOAuthStatus, ReasoningEffort } from "./types";

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

export interface ProviderRuntimeCapabilities {
  canUseApi: boolean;
  canUseCli: boolean;
  hasActiveApiCredential: boolean;
}

export interface SelectableModelCatalogOptions {
  provider?: ProviderConfig | null;
  oauthStatus?: ProviderOAuthStatus | null;
  currentModelId?: string;
  includeLegacy?: boolean;
}

export interface SelectableModelCatalogRecordOptions {
  providers?: Partial<Record<ProviderId, ProviderConfig | null | undefined>>;
  oauthStatuses?: Partial<Record<ProviderId, ProviderOAuthStatus | null | undefined>>;
  currentModelIds?: Partial<Record<ProviderId, string | undefined>>;
  includeLegacy?: boolean;
}

export const ONE_MILLION_CONTEXT_TOKENS = 1_000_000;
export const GPT_5_4_CONTEXT_WINDOW_TOKENS = 1_050_000;
export const MAX_CONTEXT_WINDOW_TOKENS = GPT_5_4_CONTEXT_WINDOW_TOKENS;
const MASKED_SECRET_PLACEHOLDER = "[secure]";

const codexXHigh: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const codexClassic: ReasoningEffort[] = ["low", "medium", "high"];
const codexMini: ReasoningEffort[] = ["medium", "high"];
const codexProXHigh: ReasoningEffort[] = ["medium", "high", "xhigh"];
const claudeEffort: ReasoningEffort[] = ["low", "medium", "high"];

const fullRuntime: ModelRuntimeAvailability = "api_and_cli";
const apiOnlyRuntime: ModelRuntimeAvailability = "api_only";
const currentLifecycle: ModelLifecycle = "current";
const legacyLifecycle: ModelLifecycle = "legacy";

export const MODEL_CATALOG: Record<ProviderId, ModelCatalogEntry[]> = {
  openai: [
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
  ],
  claude: [
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
      lifecycle: currentLifecycle
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
      lifecycle: currentLifecycle
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
    }
  ]
};

export function getDefaultModelForProvider(providerId: ProviderId): string {
  if (providerId === "claude") {
    return "claude-sonnet-4-6";
  }
  return "gpt-5.4";
}

export function getModelEntry(providerId: ProviderId, model: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[providerId].find((entry) => entry.id === model);
}

export function getDefaultContextWindowForModel(providerId: ProviderId, model: string): number {
  const found = getModelEntry(providerId, model);
  if (found) {
    return found.contextWindowTokens;
  }
  return providerId === "claude" ? 200_000 : 272_000;
}

export function modelUsesExtendedContextByDefault(entry: ModelCatalogEntry | undefined): boolean {
  return (entry?.contextWindowTokens ?? 0) >= ONE_MILLION_CONTEXT_TOKENS;
}

export function resolve1MContextEnabled(providerId: ProviderId, model: string, requested: boolean): boolean {
  const entry = getModelEntry(providerId, model);
  if (!entry) {
    return requested;
  }

  return modelUsesExtendedContextByDefault(entry) || (requested && entry.supports1MContext === true);
}

export function resolveMinimumContextWindowForModel(
  providerId: ProviderId,
  model: string,
  use1MContext: boolean
): number {
  const entry = getModelEntry(providerId, model);
  const baseContextWindow = getDefaultContextWindowForModel(providerId, model);
  if (modelUsesExtendedContextByDefault(entry)) {
    return baseContextWindow;
  }

  if (use1MContext) {
    return Math.max(baseContextWindow, ONE_MILLION_CONTEXT_TOKENS);
  }

  return baseContextWindow;
}

export function resolveProviderRuntimeCapabilities(
  provider: ProviderConfig | null | undefined,
  oauthStatus: ProviderOAuthStatus | null | undefined
): ProviderRuntimeCapabilities {
  if (!provider) {
    return {
      canUseApi: true,
      canUseCli: true,
      hasActiveApiCredential: true
    };
  }

  if (provider.authMode === "api_key") {
    const hasActiveApiCredential = provider.apiKey.trim().length > 0;
    return {
      canUseApi: hasActiveApiCredential,
      canUseCli: true,
      hasActiveApiCredential
    };
  }

  const normalizedOauthToken = provider.oauthToken.trim();
  const hasVisibleOauthToken =
    normalizedOauthToken.length > 0 && normalizedOauthToken !== MASKED_SECRET_PLACEHOLDER;
  const hasVerifiedApiCapability =
    oauthStatus?.canUseApi === true && oauthStatus.runtimeProbe?.status === "pass";
  const hasActiveApiCredential = hasVerifiedApiCapability || hasVisibleOauthToken;
  return {
    canUseApi: hasActiveApiCredential,
    canUseCli: true,
    hasActiveApiCredential
  };
}

export function isModelSelectableForRuntime(
  entry: ModelCatalogEntry,
  runtime: ProviderRuntimeCapabilities,
  includeLegacy = false
): boolean {
  if (!includeLegacy && entry.lifecycle === "legacy") {
    return false;
  }

  if (entry.runtimeAvailability === "api_only") {
    return runtime.hasActiveApiCredential;
  }

  return runtime.canUseApi || runtime.canUseCli;
}

export function getSelectableModelsForProvider(
  providerId: ProviderId,
  options: SelectableModelCatalogOptions = {}
): ModelCatalogEntry[] {
  const runtime = resolveProviderRuntimeCapabilities(options.provider, options.oauthStatus);

  return MODEL_CATALOG[providerId].filter((entry) => {
    if (entry.id === options.currentModelId) {
      return true;
    }

    return isModelSelectableForRuntime(entry, runtime, options.includeLegacy === true);
  });
}

export function getSelectableModelCatalog(
  options: SelectableModelCatalogRecordOptions = {}
): Record<ProviderId, ModelCatalogEntry[]> {
  return {
    openai: getSelectableModelsForProvider("openai", {
      provider: options.providers?.openai,
      oauthStatus: options.oauthStatuses?.openai,
      currentModelId: options.currentModelIds?.openai,
      includeLegacy: options.includeLegacy
    }),
    claude: getSelectableModelsForProvider("claude", {
      provider: options.providers?.claude,
      oauthStatus: options.oauthStatuses?.claude,
      currentModelId: options.currentModelIds?.claude,
      includeLegacy: options.includeLegacy
    })
  };
}
