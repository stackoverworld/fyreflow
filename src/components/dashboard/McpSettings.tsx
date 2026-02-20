import { ChevronDown, ExternalLink, HardDrive, Plus, Save, Server, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { McpServerConfig, McpServerPayload, StorageConfig } from "@/lib/types";
import { MCP_SERVER_TEMPLATES, type McpServerTemplate } from "@/lib/mcpTemplates";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";
import { cn } from "@/lib/cn";

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

function toDraftFromTemplate(template: McpServerTemplate): McpDraft {
  return {
    ...createNewServerDraft(),
    ...template.draft,
    enabled: true,
    health: "unknown"
  };
}

/* ── Transport-aware field set ── */
function ServerFields({
  draft,
  onChange
}: {
  draft: McpDraft;
  onChange: (next: McpDraft) => void;
}) {
  const isNetwork = draft.transport === "http" || draft.transport === "sse";
  const isStdio = draft.transport === "stdio";

  return (
    <div className="space-y-3">
      {isNetwork && (
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">URL</span>
          <Input
            value={draft.url}
            onChange={(e) => onChange({ ...draft, url: e.target.value })}
            placeholder={draft.transport === "sse" ? "http://localhost:3010/sse" : "http://localhost:3010"}
          />
        </label>
      )}

      {isStdio && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Command</span>
            <Input
              value={draft.command}
              onChange={(e) => onChange({ ...draft, command: e.target.value })}
              placeholder="npx"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Args</span>
            <Input
              value={draft.args}
              onChange={(e) => onChange({ ...draft, args: e.target.value })}
              placeholder="-y package-name --stdio"
            />
          </label>
        </div>
      )}

      {isNetwork && (
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Headers</span>
          <Textarea
            className="min-h-[48px]"
            value={draft.headers}
            onChange={(e) => onChange({ ...draft, headers: e.target.value })}
            placeholder="Authorization: Bearer ..."
          />
        </label>
      )}

      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Environment variables</span>
        <Textarea
          className="min-h-[48px]"
          value={draft.env}
          onChange={(e) => onChange({ ...draft, env: e.target.value })}
          placeholder={isStdio ? "FIGMA_TOKEN=..." : "API_KEY=..."}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Tool allowlist</span>
        <Input
          value={draft.toolAllowlist}
          onChange={(e) => onChange({ ...draft, toolAllowlist: e.target.value })}
          placeholder="Leave empty to allow all tools"
        />
      </label>
    </div>
  );
}

const HEALTH_DOT: Record<McpDraft["health"], string> = {
  unknown: "bg-ink-600",
  healthy: "bg-emerald-500",
  degraded: "bg-amber-400",
  down: "bg-red-500"
};

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
  const selectedTemplate = useMemo(
    () => MCP_SERVER_TEMPLATES.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId]
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

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Root path</span>
          <Input
            value={storageDraft.rootPath}
            onChange={(event) => setStorageDraft((current) => ({ ...current, rootPath: event.target.value }))}
            placeholder="data/agent-storage"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Shared folder</span>
            <Input
              value={storageDraft.sharedFolder}
              onChange={(event) => setStorageDraft((current) => ({ ...current, sharedFolder: event.target.value }))}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Isolated folder</span>
            <Input
              value={storageDraft.isolatedFolder}
              onChange={(event) => setStorageDraft((current) => ({ ...current, isolatedFolder: event.target.value }))}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Runs folder</span>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-ink-400">
            <Server className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">MCP Servers</span>
          </div>
          <span className="text-[11px] text-ink-600">{mcpServers.length} configured</span>
        </div>

        {/* ── Existing servers ── */}
        {mcpServers.length === 0 && !showAddForm && (
          <div className="rounded-xl border border-dashed border-ink-800 px-4 py-5 text-center">
            <p className="text-xs text-ink-500">No MCP servers configured yet.</p>
            <p className="mt-1 text-[11px] text-ink-600">Add a server to give agents access to external tools.</p>
          </div>
        )}

        {mcpServers.map((server) => {
          const draft = serverDrafts[server.id] ?? toServerDraft(server);
          const isExpanded = expandedServerId === server.id;
          const changed = JSON.stringify(draft) !== JSON.stringify(toServerDraft(server));

          return (
            <div key={server.id} className="rounded-xl border border-ink-800 bg-ink-950/55">
              <button
                type="button"
                onClick={() => setExpandedServerId(isExpanded ? null : server.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[draft.health])} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-100">{server.name}</p>
                    <p className="text-[11px] text-ink-500">{draft.transport}{draft.url ? ` · ${draft.url}` : draft.command ? ` · ${draft.command}` : ""}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={draft.enabled}
                      onChange={(checked) =>
                        setServerDrafts((current) => ({
                          ...current,
                          [server.id]: { ...draft, enabled: checked }
                        }))
                      }
                    />
                  </div>
                  <ChevronDown className={cn("h-3.5 w-3.5 text-ink-500 transition-transform", isExpanded && "rotate-180")} />
                </div>
              </button>

              {isExpanded && (
                <div className="space-y-4 border-t border-ink-800 px-3 py-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Name</span>
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
                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Transport</span>
                      <Select
                        value={draft.transport}
                        onValueChange={(value) =>
                          setServerDrafts((current) => ({
                            ...current,
                            [server.id]: { ...draft, transport: value as McpDraft["transport"] }
                          }))
                        }
                        options={[
                          { value: "http", label: "HTTP" },
                          { value: "sse", label: "SSE" },
                          { value: "stdio", label: "Stdio" }
                        ]}
                      />
                    </label>
                  </div>

                  <ServerFields
                    draft={draft}
                    onChange={(next) =>
                      setServerDrafts((current) => ({
                        ...current,
                        [server.id]: next
                      }))
                    }
                  />

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyServerId === server.id || draft.name.trim().length < 2 || !changed}
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
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-ink-600 transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                      onClick={async () => {
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
                </div>
              )}
            </div>
          );
        })}

        {/* ── Add new server ── */}
        {!showAddForm ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Add MCP server
          </Button>
        ) : (
          <div className="rounded-xl border border-ink-800 bg-ink-950/55">
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewServer(createNewServerDraft());
                setSelectedTemplateId(null);
              }}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left cursor-pointer"
            >
              <p className="text-sm font-medium text-ink-100">New server</p>
              <ChevronDown className="h-3.5 w-3.5 text-ink-500 rotate-180" />
            </button>

            <div className="space-y-4 border-t border-ink-800 px-3 py-3">
              {/* Templates */}
              <div className="space-y-2">
                <p className="text-[11px] text-ink-500">Quick start from template</p>
                <div className="flex gap-2">
                  {MCP_SERVER_TEMPLATES.map((template) => {
                    const active = selectedTemplateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplateId(active ? null : template.id);
                          setNewServer(active ? createNewServerDraft() : toDraftFromTemplate(template));
                        }}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
                          active
                            ? "border-ember-500/50 bg-ember-500/8 text-ink-100"
                            : "border-ink-800 bg-ink-900/25 text-ink-300 hover:border-ink-700 hover:text-ink-100"
                        )}
                      >
                        <img
                          src={template.iconSrc}
                          alt={template.label}
                          className={cn("h-3.5 w-3.5 object-contain", template.iconClassName)}
                        />
                        {template.label}
                      </button>
                    );
                  })}
                </div>
                {selectedTemplate ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-ink-500">{selectedTemplate.setupHint}</p>
                    <a
                      href={selectedTemplate.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-500 transition-colors hover:text-ink-200"
                    >
                      Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="h-px bg-ink-800/60" />

              {/* Form fields */}
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Name</span>
                  <Input
                    value={newServer.name}
                    onChange={(e) => setNewServer((c) => ({ ...c, name: e.target.value }))}
                    placeholder="My MCP Server"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Transport</span>
                  <Select
                    value={newServer.transport}
                    onValueChange={(value) =>
                      setNewServer((c) => ({ ...c, transport: value as McpDraft["transport"] }))
                    }
                    options={[
                      { value: "http", label: "HTTP" },
                      { value: "sse", label: "SSE" },
                      { value: "stdio", label: "Stdio" }
                    ]}
                  />
                </label>
              </div>

              <ServerFields
                draft={newServer}
                onChange={setNewServer}
              />

              <div className="flex items-center justify-between gap-3 rounded-lg bg-ink-800/20 px-2.5 py-2">
                <div>
                  <p className="text-xs text-ink-100">Enabled</p>
                  <p className="text-[11px] text-ink-500">Available to agents on create.</p>
                </div>
                <Switch
                  checked={newServer.enabled}
                  onChange={(checked) => setNewServer((c) => ({ ...c, enabled: checked }))}
                />
              </div>

              <Button
                size="sm"
                disabled={creatingServer || newServer.name.trim().length < 2}
                onClick={async () => {
                  setCreatingServer(true);
                  try {
                    await onCreateServer(newServer);
                    setNewServer(createNewServerDraft());
                    setSelectedTemplateId(null);
                    setShowAddForm(false);
                  } finally {
                    setCreatingServer(false);
                  }
                }}
              >
                <Plus className="h-3.5 w-3.5" /> {creatingServer ? "Creating..." : "Create server"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
