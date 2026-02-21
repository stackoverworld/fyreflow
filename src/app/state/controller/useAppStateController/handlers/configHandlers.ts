import { useCallback } from "react";
import type { ProviderOAuthMessageMap, ProviderOAuthStatusMap } from "@/lib/pipelineDraft";
import type {
  DashboardState,
  McpServerPayload,
  ProviderConfig,
  ProviderId,
  ProviderOAuthStatus,
  StorageConfigPayload
} from "@/lib/types";
import { createAppStateConfigMutations } from "../../../appStateConfigMutations";
import type { AppStateSetState } from "../../types";
import { handleProviderOauthMessageChangeAction, handleProviderOauthStatusChangeAction } from "../dispatchers";

export type SaveProviderPatch = Partial<ProviderConfig>;

export interface ConfigHandlersArgs {
  setProviders: AppStateSetState<DashboardState["providers"] | null>;
  setMcpServers: AppStateSetState<DashboardState["mcpServers"]>;
  setStorageConfig: AppStateSetState<DashboardState["storage"] | null>;
  setNotice: AppStateSetState<string>;
  setProviderOauthStatuses: AppStateSetState<ProviderOAuthStatusMap>;
  setProviderOauthMessages: AppStateSetState<ProviderOAuthMessageMap>;
}

export interface ConfigHandlersResult {
  handleSaveProvider: (providerId: ProviderId, patch: SaveProviderPatch) => Promise<void>;
  handleCreateMcpServer: (payload: McpServerPayload) => Promise<void>;
  handleUpdateMcpServer: (serverId: string, payload: Partial<McpServerPayload>) => Promise<void>;
  handleDeleteMcpServer: (serverId: string) => Promise<void>;
  handleSaveStorageConfig: (payload: StorageConfigPayload) => Promise<void>;
  handleProviderOauthStatusChange: (providerId: ProviderId, status: ProviderOAuthStatus | null) => void;
  handleProviderOauthMessageChange: (providerId: ProviderId, message: string) => void;
}

export function useConfigHandlers(args: ConfigHandlersArgs): ConfigHandlersResult {
  const {
    setProviders,
    setMcpServers,
    setStorageConfig,
    setNotice,
    setProviderOauthStatuses,
    setProviderOauthMessages
  } = args;

  const {
    handleSaveProvider,
    handleCreateMcpServer,
    handleUpdateMcpServer,
    handleDeleteMcpServer,
    handleSaveStorageConfig
  } = createAppStateConfigMutations({
    setProviders,
    setMcpServers,
    setStorageConfig,
    setNotice
  });

  const handleProviderOauthStatusChange = useCallback((providerId: ProviderId, status: ProviderOAuthStatus | null) => {
    handleProviderOauthStatusChangeAction(providerId, status, {
      setProviderOauthStatuses
    });
  }, []);

  const handleProviderOauthMessageChange = useCallback((providerId: ProviderId, message: string) => {
    handleProviderOauthMessageChangeAction(providerId, message, {
      setProviderOauthMessages
    });
  }, []);

  return {
    handleSaveProvider,
    handleCreateMcpServer,
    handleUpdateMcpServer,
    handleDeleteMcpServer,
    handleSaveStorageConfig,
    handleProviderOauthStatusChange,
    handleProviderOauthMessageChange
  };
}
