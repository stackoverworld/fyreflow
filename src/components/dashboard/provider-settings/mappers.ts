import { MODEL_CATALOG } from "@/lib/modelCatalog";
import type { AuthMode, ProviderConfig, ProviderId } from "@/lib/types";

export type ProviderDrafts = Record<ProviderId, ProviderConfig>;

export const PROVIDER_ORDER: ProviderId[] = ["openai", "claude"];

export const PROVIDER_DISPLAY_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI / Codex",
  claude: "Anthropic"
};

export function getProviderModelOptions(providerId: ProviderId) {
  return MODEL_CATALOG[providerId].map((entry) => ({
    value: entry.id,
    label: entry.label
  }));
}

export function setProviderAuthMode(
  currentDrafts: ProviderDrafts,
  providerId: ProviderId,
  authMode: AuthMode
): ProviderDrafts {
  return {
    ...currentDrafts,
    [providerId]: {
      ...currentDrafts[providerId],
      authMode
    }
  };
}

export function setProviderCredential(
  currentDrafts: ProviderDrafts,
  providerId: ProviderId,
  authMode: AuthMode,
  value: string
): ProviderDrafts {
  return {
    ...currentDrafts,
    [providerId]: {
      ...currentDrafts[providerId],
      oauthToken: authMode === "oauth" ? value : currentDrafts[providerId].oauthToken,
      apiKey: authMode === "api_key" ? value : currentDrafts[providerId].apiKey
    }
  };
}

export function setProviderField<Value extends keyof ProviderConfig>(
  currentDrafts: ProviderDrafts,
  providerId: ProviderId,
  field: Value,
  value: ProviderConfig[Value]
): ProviderDrafts {
  return {
    ...currentDrafts,
    [providerId]: {
      ...currentDrafts[providerId],
      [field]: value
    }
  };
}
