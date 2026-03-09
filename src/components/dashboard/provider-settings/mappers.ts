import {
  getSelectableModelsForProvider,
  type ModelCatalogEntry
} from "@/lib/modelCatalog";
import { toModelSelectOption } from "@/lib/modelLabel";
import type { AuthMode, ProviderConfig, ProviderId, ProviderOAuthStatus } from "@/lib/types";

export type ProviderDrafts = Record<ProviderId, ProviderConfig>;

export const PROVIDER_ORDER: ProviderId[] = ["openai", "claude"];

export function getProviderModelOptions(
  providerId: ProviderId,
  provider?: ProviderConfig | null,
  oauthStatus?: ProviderOAuthStatus | null,
  currentModelId?: string
) {
  return getSelectableModelsForProvider(providerId, {
    provider,
    oauthStatus,
    currentModelId
  }).map(toModelSelectOption);
}

export function getProviderSelectableModels(
  providerId: ProviderId,
  provider?: ProviderConfig | null,
  oauthStatus?: ProviderOAuthStatus | null,
  currentModelId?: string
): ModelCatalogEntry[] {
  return getSelectableModelsForProvider(providerId, {
    provider,
    oauthStatus,
    currentModelId
  });
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
