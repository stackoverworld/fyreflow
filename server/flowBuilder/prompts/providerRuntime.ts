import type { AuthMode, ProviderId } from "../../types.js";

export interface FlowBuilderProviderRuntimeContext {
  providerId: ProviderId;
  authMode: AuthMode;
  providerFastModeAvailable: boolean;
  fastModeRequested: boolean;
  fastModeEffective: boolean;
  fastModeNote: string;
}

export function formatProviderRuntimeContext(context: FlowBuilderProviderRuntimeContext): string {
  return [
    "Provider runtime profile:",
    `- provider_id: ${context.providerId}`,
    `- auth_mode: ${context.authMode}`,
    `- provider_fast_mode_available: ${context.providerFastModeAvailable ? "yes" : "no"}`,
    `- fast_mode_requested: ${context.fastModeRequested ? "on" : "off"}`,
    `- fast_mode_effective: ${context.fastModeEffective ? "on" : "off"}`,
    `- note: ${context.fastModeNote}`
  ].join("\n");
}
