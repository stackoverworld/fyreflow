import { MASK_VALUE } from "../secureInputs.js";
import type {
  DashboardState,
  McpServerConfig,
  ProviderConfig,
  ProviderId
} from "../types.js";

function maskIfPresent(value: string): string {
  return value.trim().length > 0 ? MASK_VALUE : "";
}

function sanitizeProviderConfig(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: maskIfPresent(provider.apiKey),
    oauthToken: maskIfPresent(provider.oauthToken)
  };
}

function sanitizeProviderMap(
  providers: DashboardState["providers"]
): Record<ProviderId, ProviderConfig> {
  return {
    openai: sanitizeProviderConfig(providers.openai),
    claude: sanitizeProviderConfig(providers.claude)
  };
}

function sanitizeMcpServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: maskIfPresent(server.env),
    headers: maskIfPresent(server.headers)
  };
}

export function sanitizeDashboardState(state: DashboardState): DashboardState {
  return {
    ...state,
    providers: sanitizeProviderMap(state.providers),
    mcpServers: state.mcpServers.map((server) => sanitizeMcpServer(server))
  };
}
