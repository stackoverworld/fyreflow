import { useEffect, useMemo, useState } from "react";
import type { McpServerConfig, McpServerPayload, StorageConfig } from "@/lib/types";
import { McpSettingsForm, createNewServerDraft, toServerDraft, type McpDraft } from "@/components/dashboard/panels/mcp/McpSettingsForm";

interface McpSettingsProps {
  mcpServers: McpServerConfig[];
  storage: StorageConfig;
  onCreateServer: (payload: McpServerPayload) => Promise<void>;
  onUpdateServer: (serverId: string, payload: Partial<McpServerPayload>) => Promise<void>;
  onDeleteServer: (serverId: string) => Promise<void>;
  onSaveStorage: (payload: Partial<StorageConfig>) => Promise<void>;
}

export function McpSettings({
  mcpServers,
  storage,
  onCreateServer,
  onUpdateServer,
  onDeleteServer,
  onSaveStorage
}: McpSettingsProps) {
  const [storageDraft, setStorageDraft] = useState(storage);
  const [serverDrafts, setServerDrafts] = useState<Record<string, McpDraft>>({});
  const [newServer, setNewServer] = useState<McpDraft>(createNewServerDraft());
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [savingStorage, setSavingStorage] = useState(false);
  const [creatingServer, setCreatingServer] = useState(false);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    setStorageDraft(storage);
  }, [storage]);

  useEffect(() => {
    setServerDrafts((current) => {
      const next: Record<string, McpDraft> = {};

      for (const server of mcpServers) {
        next[server.id] = current[server.id] ?? toServerDraft(server);
      }

      return next;
    });
  }, [mcpServers]);

  const storageChanged = useMemo(
    () => JSON.stringify(storageDraft) !== JSON.stringify(storage),
    [storage, storageDraft]
  );

  const handleSaveStorage = async () => {
    setSavingStorage(true);
    try {
      await onSaveStorage(storageDraft);
    } finally {
      setSavingStorage(false);
    }
  };

  const handleUpdateServer = async (serverId: string, payload: Partial<McpServerPayload>) => {
    setBusyServerId(serverId);
    try {
      await onUpdateServer(serverId, payload);
    } finally {
      setBusyServerId(null);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    setBusyServerId(serverId);
    try {
      await onDeleteServer(serverId);
    } finally {
      setBusyServerId(null);
    }
  };

  const handleCreateServer = async () => {
    setCreatingServer(true);
    try {
      await onCreateServer(newServer);
      setNewServer(createNewServerDraft());
      setSelectedTemplateId(null);
      setShowAddForm(false);
    } finally {
      setCreatingServer(false);
    }
  };

  return (
    <McpSettingsForm
      mcpServers={mcpServers}
      storageDraft={storageDraft}
      storageChanged={storageChanged}
      savingStorage={savingStorage}
      setStorageDraft={setStorageDraft}
      onSaveStorage={handleSaveStorage}
      serverDrafts={serverDrafts}
      setServerDrafts={setServerDrafts}
      busyServerId={busyServerId}
      onUpdateServer={handleUpdateServer}
      onDeleteServer={handleDeleteServer}
      newServer={newServer}
      setNewServer={setNewServer}
      creatingServer={creatingServer}
      onCreateServer={handleCreateServer}
      expandedServerId={expandedServerId}
      setExpandedServerId={setExpandedServerId}
      showAddForm={showAddForm}
      setShowAddForm={setShowAddForm}
      selectedTemplateId={selectedTemplateId}
      setSelectedTemplateId={setSelectedTemplateId}
    />
  );
}
