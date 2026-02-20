import { HardDrive, Plus, Save, Server, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { McpServerConfig, McpServerPayload, StorageConfig } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";

interface McpSettingsProps {
  mcpServers: McpServerConfig[];
  storage: StorageConfig;
  onCreateServer: (payload: McpServerPayload) => Promise<void>;
  onUpdateServer: (serverId: string, payload: Partial<McpServerPayload>) => Promise<void>;
  onDeleteServer: (serverId: string) => Promise<void>;
  onSaveStorage: (payload: Partial<StorageConfig>) => Promise<void>;
}

interface McpDraft {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
  toolAllowlist: string;
  health: "unknown" | "healthy" | "degraded" | "down";
}

function toServerDraft(server: McpServerConfig): McpDraft {
  return {
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    env: server.env,
    headers: server.headers,
    toolAllowlist: server.toolAllowlist,
    health: server.health
  };
}

function createNewServerDraft(): McpDraft {
  return {
    name: "",
    enabled: true,
    transport: "http",
    command: "",
    args: "",
    url: "",
    env: "",
    headers: "",
    toolAllowlist: "",
    health: "unknown"
  };
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

  return (
    <div>
      {/* ── Storage section ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <HardDrive className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Shared Storage</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink-100">Enable centralized storage</p>
            <p className="text-xs text-ink-500">Used by agents with shared storage enabled.</p>
          </div>
          <Switch
            checked={storageDraft.enabled}
            onChange={(checked) => setStorageDraft((current) => ({ ...current, enabled: checked }))}
          />
        </div>

        <label className="space-y-1">
          <span className="text-xs text-ink-500">Root path</span>
          <Input
            value={storageDraft.rootPath}
            onChange={(event) => setStorageDraft((current) => ({ ...current, rootPath: event.target.value }))}
            placeholder="data/agent-storage"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-xs text-ink-500">Shared folder</span>
            <Input
              value={storageDraft.sharedFolder}
              onChange={(event) => setStorageDraft((current) => ({ ...current, sharedFolder: event.target.value }))}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-ink-500">Isolated folder</span>
            <Input
              value={storageDraft.isolatedFolder}
              onChange={(event) => setStorageDraft((current) => ({ ...current, isolatedFolder: event.target.value }))}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-ink-500">Runs folder</span>
            <Input
              value={storageDraft.runsFolder}
              onChange={(event) => setStorageDraft((current) => ({ ...current, runsFolder: event.target.value }))}
            />
          </label>
        </div>

        <Button
          size="sm"
          variant="secondary"
          disabled={savingStorage || !storageChanged}
          onClick={async () => {
            setSavingStorage(true);
            try {
              await onSaveStorage(storageDraft);
            } finally {
              setSavingStorage(false);
            }
          }}
        >
          <Save className="h-3.5 w-3.5" /> {savingStorage ? "Saving..." : "Save storage"}
        </Button>
      </section>

      <div className="my-5 h-px bg-ink-800/60" />

      {/* ── MCP Servers section ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <Server className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">MCP Servers</span>
        </div>

        {mcpServers.length === 0 && (
          <p className="text-sm text-ink-500">No MCP servers configured.</p>
        )}

        {mcpServers.map((server) => {
          const draft = serverDrafts[server.id] ?? toServerDraft(server);
          const isExpanded = expandedServerId === server.id;

          return (
            <div key={server.id} className="rounded-xl border border-ink-800 bg-ink-950/55">
              <button
                type="button"
                onClick={() => setExpandedServerId(isExpanded ? null : server.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-100">{server.name}</p>
                  <p className="text-[11px] text-ink-500">
                    {draft.transport} · {draft.enabled ? "enabled" : "disabled"}
                  </p>
                </div>

                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={draft.enabled}
                    onChange={(checked) =>
                      setServerDrafts((current) => ({
                        ...current,
                        [server.id]: { ...draft, enabled: checked }
                      }))
                    }
                  />

                  <button
                    type="button"
                    className="rounded-md p-1.5 text-ink-600 transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                    onClick={async (e) => {
                      e.stopPropagation();
                      setBusyServerId(server.id);
                      try {
                        await onDeleteServer(server.id);
                      } finally {
                        setBusyServerId(null);
                      }
                    }}
                    aria-label="Delete MCP server"
                    disabled={busyServerId === server.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </button>

              {isExpanded && (
                <div className="space-y-3 border-t border-ink-800 px-3 py-3">
                  <label className="space-y-1">
                    <span className="text-xs text-ink-500">Name</span>
                    <Input
                      value={draft.name}
                      onChange={(event) =>
                        setServerDrafts((current) => ({
                          ...current,
                          [server.id]: { ...draft, name: event.target.value }
                        }))
                      }
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs text-ink-500">Transport</span>
                      <Select
                        value={draft.transport}
                        onValueChange={(value) =>
                          setServerDrafts((current) => ({
                            ...current,
                            [server.id]: { ...draft, transport: value as McpDraft["transport"] }
                          }))
                        }
                        options={[
                          { value: "http", label: "http" },
                          { value: "sse", label: "sse" },
                          { value: "stdio", label: "stdio" }
                        ]}
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-xs text-ink-500">Health</span>
                      <Select
                        value={draft.health}
                        onValueChange={(value) =>
                          setServerDrafts((current) => ({
                            ...current,
                            [server.id]: { ...draft, health: value as McpDraft["health"] }
                          }))
                        }
                        options={[
                          { value: "unknown", label: "unknown" },
                          { value: "healthy", label: "healthy" },
                          { value: "degraded", label: "degraded" },
                          { value: "down", label: "down" }
                        ]}
                      />
                    </label>
                  </div>

                  <label className="space-y-1">
                    <span className="text-xs text-ink-500">URL (for http/sse)</span>
                    <Input
                      value={draft.url}
                      onChange={(event) =>
                        setServerDrafts((current) => ({
                          ...current,
                          [server.id]: { ...draft, url: event.target.value }
                        }))
                      }
                      placeholder="http://localhost:3010"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs text-ink-500">Command (stdio)</span>
                      <Input
                        value={draft.command}
                        onChange={(event) =>
                          setServerDrafts((current) => ({
                            ...current,
                            [server.id]: { ...draft, command: event.target.value }
                          }))
                        }
                        placeholder="npx -y ..."
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-xs text-ink-500">Args</span>
                      <Input
                        value={draft.args}
                        onChange={(event) =>
                          setServerDrafts((current) => ({
                            ...current,
                            [server.id]: { ...draft, args: event.target.value }
                          }))
                        }
                        placeholder="--port 3010"
                      />
                    </label>
                  </div>

                  <label className="space-y-1">
                    <span className="text-xs text-ink-500">Env bindings</span>
                    <Textarea
                      className="min-h-[56px]"
                      value={draft.env}
                      onChange={(event) =>
                        setServerDrafts((current) => ({
                          ...current,
                          [server.id]: { ...draft, env: event.target.value }
                        }))
                      }
                      placeholder={"FIGMA_TOKEN=${secrets.figma_token}"}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-ink-500">Headers</span>
                    <Textarea
                      className="min-h-[56px]"
                      value={draft.headers}
                      onChange={(event) =>
                        setServerDrafts((current) => ({
                          ...current,
                          [server.id]: { ...draft, headers: event.target.value }
                        }))
                      }
                      placeholder={"Authorization: Bearer ${secrets.token}"}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-ink-500">Tool allowlist (comma separated)</span>
                    <Input
                      value={draft.toolAllowlist}
                      onChange={(event) =>
                        setServerDrafts((current) => ({
                          ...current,
                          [server.id]: { ...draft, toolAllowlist: event.target.value }
                        }))
                      }
                      placeholder="get_file,get_nodes,get_styles"
                    />
                  </label>

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyServerId === server.id || draft.name.trim().length < 2}
                    onClick={async () => {
                      setBusyServerId(server.id);
                      try {
                        await onUpdateServer(server.id, draft);
                      } finally {
                        setBusyServerId(null);
                      }
                    }}
                  >
                    <Save className="h-3.5 w-3.5" /> {busyServerId === server.id ? "Saving..." : "Save"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Add new server ── */}
        <div className="space-y-3 pt-1">
          <p className="text-xs font-medium text-ink-300">Add new server</p>

          <label className="space-y-1">
            <span className="text-xs text-ink-500">Name</span>
            <Input
              value={newServer.name}
              onChange={(event) => setNewServer((current) => ({ ...current, name: event.target.value }))}
              placeholder="Figma MCP"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-ink-500">Transport</span>
            <Select
              value={newServer.transport}
              onValueChange={(value) =>
                setNewServer((current) => ({ ...current, transport: value as McpDraft["transport"] }))
              }
              options={[
                { value: "http", label: "http" },
                { value: "sse", label: "sse" },
                { value: "stdio", label: "stdio" }
              ]}
            />
          </label>

          <div className="flex items-center justify-between gap-3 px-1 py-1">
            <div>
              <p className="text-[13px] text-ink-100">Enabled</p>
              <p className="text-[11px] text-ink-500">Server will be available to agents.</p>
            </div>
            <Switch
              checked={newServer.enabled}
              onChange={(checked) => setNewServer((current) => ({ ...current, enabled: checked }))}
            />
          </div>

          <label className="space-y-1">
            <span className="text-xs text-ink-500">URL</span>
            <Input
              value={newServer.url}
              onChange={(event) => setNewServer((current) => ({ ...current, url: event.target.value }))}
              placeholder="http://localhost:3010"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-ink-500">Command</span>
            <Input
              value={newServer.command}
              onChange={(event) => setNewServer((current) => ({ ...current, command: event.target.value }))}
              placeholder="npx -y @modelcontextprotocol/server-figma"
            />
          </label>

          <Button
            size="sm"
            disabled={creatingServer || newServer.name.trim().length < 2}
            onClick={async () => {
              setCreatingServer(true);
              try {
                await onCreateServer(newServer);
                setNewServer(createNewServerDraft());
              } finally {
                setCreatingServer(false);
              }
            }}
          >
            <Plus className="h-3.5 w-3.5" /> {creatingServer ? "Creating..." : "Create server"}
          </Button>
        </div>
      </section>
    </div>
  );
}
