import type { ProviderId, ReasoningEffort } from "./types.js";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  providerId: ProviderId;
  source: "codex-local" | "claude-local" | "manual";
  contextWindowTokens: number;
  reasoningEfforts: ReasoningEffort[];
  supportsFastMode: boolean;
  supports1MContext: boolean;
  notes?: string;
}

const codexXHigh: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const codexClassic: ReasoningEffort[] = ["low", "medium", "high"];
const codexMini: ReasoningEffort[] = ["medium", "high"];
const codexGpt5: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const claudeEffort: ReasoningEffort[] = ["low", "medium", "high"];

const codexModels: ModelCatalogEntry[] = [
  {
    id: "gpt-5.3-codex",
    label: "gpt-5.3-codex",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5.2-codex",
    label: "gpt-5.2-codex",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5.1-codex-max",
    label: "gpt-5.1-codex-max",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5.1-codex",
    label: "gpt-5.1-codex",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexClassic,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5.2",
    label: "gpt-5.2",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5.1",
    label: "gpt-5.1",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexClassic,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5-codex",
    label: "gpt-5-codex",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexClassic,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5",
    label: "gpt-5",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexGpt5,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5.1-codex-mini",
    label: "gpt-5.1-codex-mini",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexMini,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5-codex-mini",
    label: "gpt-5-codex-mini",
    providerId: "openai",
    source: "codex-local",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexMini,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "gpt-5.2-spark",
    label: "gpt-5.2-spark",
    providerId: "openai",
    source: "manual",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false,
    notes: "Manual alias added per local workflow preference."
  },
  {
    id: "gpt-5.2-codex-sonic",
    label: "gpt-5.2-codex-sonic",
    providerId: "openai",
    source: "manual",
    contextWindowTokens: 272_000,
    reasoningEfforts: codexXHigh,
    supportsFastMode: false,
    supports1MContext: false,
    notes: "Seen in local codex rate-limit metadata."
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
    supportsFastMode: true,
    supports1MContext: true,
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
    notes: "Opus 4.6 and fast mode referenced in local CHANGELOG. 1M context is optional via toggle."
  },
  {
    id: "claude-sonnet-4-5-20250929",
    label: "claude-sonnet-4-5-20250929",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "claude-opus-4-5-20251101",
    label: "claude-opus-4-5-20251101",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "claude-haiku-4-5-20251001",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false
  },
  {
    id: "sonnet",
    label: "sonnet (alias)",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: true,
    supports1MContext: true
  },
  {
    id: "opus",
    label: "opus (alias)",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: true,
    supports1MContext: true
  },
  {
    id: "haiku",
    label: "haiku (alias)",
    providerId: "claude",
    source: "claude-local",
    contextWindowTokens: 200_000,
    reasoningEfforts: claudeEffort,
    supportsFastMode: false,
    supports1MContext: false
  }
];

export const MODEL_CATALOG: Record<ProviderId, ModelCatalogEntry[]> = {
  openai: codexModels,
  claude: claudeModels
};

export function modelCatalogForProvider(providerId: ProviderId): ModelCatalogEntry[] {
  return MODEL_CATALOG[providerId];
}

export function getModelEntry(providerId: ProviderId, modelId: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[providerId].find((entry) => entry.id === modelId);
}

export function resolveDefaultModel(providerId: ProviderId): string {
  if (providerId === "claude") {
    return "claude-sonnet-4-6";
  }
  return "gpt-5.3-codex";
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
