import type { ProviderId, ReasoningEffort } from "./types";

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

export const MODEL_CATALOG: Record<ProviderId, ModelCatalogEntry[]> = {
  openai: [
    {
      id: "gpt-5.3-codex",
      label: "gpt-5.3-codex",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexXHigh,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5.2-codex",
      label: "gpt-5.2-codex",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexXHigh,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5.1-codex-max",
      label: "gpt-5.1-codex-max",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexXHigh,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5.1-codex",
      label: "gpt-5.1-codex",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexClassic,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5.2",
      label: "gpt-5.2",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexXHigh,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5.1",
      label: "gpt-5.1",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexClassic,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5-codex",
      label: "gpt-5-codex",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexClassic,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5",
      label: "gpt-5",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexGpt5,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5.1-codex-mini",
      label: "gpt-5.1-codex-mini",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexMini,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5-codex-mini",
      label: "gpt-5-codex-mini",
      providerId: "openai",
      source: "codex-local",
      contextWindowTokens: 272000,
      reasoningEfforts: codexMini,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "gpt-5.2-spark",
      label: "gpt-5.2-spark",
      providerId: "openai",
      source: "manual",
      contextWindowTokens: 272000,
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
      contextWindowTokens: 272000,
      reasoningEfforts: codexXHigh,
      supportsFastMode: false,
      supports1MContext: false,
      notes: "Seen in local codex rate-limit metadata."
    }
  ],
  claude: [
    {
      id: "claude-sonnet-4-6",
      label: "claude-sonnet-4-6",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: true,
      supports1MContext: true
    },
    {
      id: "claude-opus-4-6",
      label: "claude-opus-4-6",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: true,
      supports1MContext: true
    },
    {
      id: "claude-sonnet-4-5-20250929",
      label: "claude-sonnet-4-5-20250929",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "claude-opus-4-5-20251101",
      label: "claude-opus-4-5-20251101",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "claude-haiku-4-5-20251001",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: false,
      supports1MContext: false
    },
    {
      id: "sonnet",
      label: "sonnet (alias)",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: true,
      supports1MContext: true
    },
    {
      id: "opus",
      label: "opus (alias)",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: true,
      supports1MContext: true
    },
    {
      id: "haiku",
      label: "haiku (alias)",
      providerId: "claude",
      source: "claude-local",
      contextWindowTokens: 200000,
      reasoningEfforts: claudeEffort,
      supportsFastMode: false,
      supports1MContext: false
    }
  ]
};

export function getDefaultModelForProvider(providerId: ProviderId): string {
  if (providerId === "claude") {
    return "claude-sonnet-4-6";
  }
  return "gpt-5.3-codex";
}

export function getModelEntry(providerId: ProviderId, model: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[providerId].find((entry) => entry.id === model);
}

export function getDefaultContextWindowForModel(providerId: ProviderId, model: string): number {
  const found = getModelEntry(providerId, model);
  if (found) {
    return found.contextWindowTokens;
  }
  return providerId === "claude" ? 200000 : 272000;
}
