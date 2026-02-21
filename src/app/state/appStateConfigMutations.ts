import { createMcpServer, deleteMcpServer, updateMcpServer, updateProvider, updateStorageConfig } from "@/lib/api";
import type { DashboardState, McpServerPayload, ProviderConfig, ProviderId, StorageConfigPayload } from "@/lib/types";
import type { Dispatch, SetStateAction } from "react";

type SetProviders = Dispatch<SetStateAction<DashboardState["providers"] | null>>;
type SetMcpServers = Dispatch<SetStateAction<DashboardState["mcpServers"]>>;
type SetStorageConfig = Dispatch<SetStateAction<DashboardState["storage"] | null>>;

type SaveProviderPatch = Partial<ProviderConfig>;

interface AppStateConfigMutationsDependencies {
  setProviders: SetProviders;
  setMcpServers: SetMcpServers;
  setStorageConfig: SetStorageConfig;
  setNotice: (notice: string) => void;
}

export function createAppStateConfigMutations({
  setProviders,
  setMcpServers,
  setStorageConfig,
  setNotice
}: AppStateConfigMutationsDependencies) {
  const handleSaveProvider = async (providerId: ProviderId, patch: SaveProviderPatch) => {
    try {
      const response = await updateProvider(providerId, patch);
      setProviders((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          [providerId]: response.provider
        };
      });
      setNotice(`${response.provider.label} settings saved.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save provider";
      setNotice(message);
    }
  };

  const handleCreateMcpServer = async (payload: McpServerPayload) => {
    try {
      const response = await createMcpServer(payload);
      setMcpServers((current) => [response.mcpServer, ...current]);
      setNotice(`MCP server "${response.mcpServer.name}" created.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create MCP server";
      setNotice(message);
    }
  };

  const handleUpdateMcpServer = async (serverId: string, payload: Partial<McpServerPayload>) => {
    try {
      const response = await updateMcpServer(serverId, payload);
      setMcpServers((current) => current.map((entry) => (entry.id === response.mcpServer.id ? response.mcpServer : entry)));
      setNotice(`MCP server "${response.mcpServer.name}" saved.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update MCP server";
      setNotice(message);
    }
  };

  const handleDeleteMcpServer = async (serverId: string) => {
    try {
      await deleteMcpServer(serverId);
      setMcpServers((current) => current.filter((entry) => entry.id !== serverId));
      setNotice("MCP server deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete MCP server";
      setNotice(message);
    }
  };

  const handleSaveStorageConfig = async (payload: StorageConfigPayload) => {
    try {
      const response = await updateStorageConfig(payload);
      setStorageConfig(response.storage);
      setNotice("Storage configuration saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save storage configuration";
      setNotice(message);
    }
  };

  return {
    handleSaveProvider,
    handleCreateMcpServer,
    handleUpdateMcpServer,
    handleDeleteMcpServer,
    handleSaveStorageConfig
  };
}
