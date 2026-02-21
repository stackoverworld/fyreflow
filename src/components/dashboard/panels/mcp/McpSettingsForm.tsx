import { ChevronDown, ExternalLink, HardDrive, Plus, Save, Server, Trash2 } from "lucide-react";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { McpServerConfig, McpServerPayload, StorageConfig } from "@/lib/types";
import { MCP_SERVER_TEMPLATES } from "@/lib/mcpTemplates";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Switch } from "@/components/optics/switch";
import { cn } from "@/lib/cn";
import { McpAdvancedSection } from "./McpAdvancedSection";
import { McpAuthSection } from "./McpAuthSection";
import { McpConnectionSection } from "./McpConnectionSection";
import {
  createNewServerDraft,
  HEALTH_DOT,
  toDraftFromTemplate,
  type McpDraft
} from "./formSchema";
import { toServerDraft, toMcpServerPayload } from "./mcpSettings.mapping";
import { hasMcpServerDraftChanged, isValidMcpServerName } from "./mcpSettings.validation";

export { createNewServerDraft, toServerDraft, type McpDraft };

interface McpSettingsFormProps {
  mcpServers: McpServerConfig[];
  storageDraft: StorageConfig;
  storageChanged: boolean;
  savingStorage: boolean;
  setStorageDraft: Dispatch<SetStateAction<StorageConfig>>;
  onSaveStorage: () => Promise<void>;

  serverDrafts: Record<string, McpDraft>;
  setServerDrafts: Dispatch<SetStateAction<Record<string, McpDraft>>>;
  busyServerId: string | null;
  onUpdateServer: (serverId: string, draft: Partial<McpServerPayload>) => Promise<void>;
  onDeleteServer: (serverId: string) => Promise<void>;

  newServer: McpDraft;
  setNewServer: Dispatch<SetStateAction<McpDraft>>;
  creatingServer: boolean;
  onCreateServer: () => Promise<void>;

  expandedServerId: string | null;
  setExpandedServerId: Dispatch<SetStateAction<string | null>>;
  showAddForm: boolean;
  setShowAddForm: Dispatch<SetStateAction<boolean>>;
  selectedTemplateId: string | null;
  setSelectedTemplateId: Dispatch<SetStateAction<string | null>>;
}

export function McpSettingsForm({
  mcpServers,
  storageDraft,
  storageChanged,
  savingStorage,
  setStorageDraft,
  onSaveStorage,
  serverDrafts,
  setServerDrafts,
  busyServerId,
  onUpdateServer,
  onDeleteServer,
  newServer,
  setNewServer,
  creatingServer,
  onCreateServer,
  expandedServerId,
  setExpandedServerId,
  showAddForm,
  setShowAddForm,
  selectedTemplateId,
  setSelectedTemplateId
}: McpSettingsFormProps) {
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
          className="whitespace-nowrap shrink-0"
          disabled={savingStorage || !storageChanged}
          onClick={onSaveStorage}
        >
          <Save className="h-3.5 w-3.5" /> {savingStorage ? "Saving..." : "Save storage"}
        </Button>
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

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
          const baseDraft = toServerDraft(server);
          const draft = serverDrafts[server.id] ?? baseDraft;
          const isExpanded = expandedServerId === server.id;
          const changed = hasMcpServerDraftChanged(draft, baseDraft);

          return (
            <div key={server.id} className="rounded-xl border border-ink-800 bg-[var(--surface-inset)]">
              <button
                type="button"
                onClick={() => setExpandedServerId((current) => (current === server.id ? null : server.id))}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[draft.health])} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-100">{server.name}</p>
                    <p className="text-[11px] text-ink-500">
                      {draft.transport}
                      {draft.url ? ` · ${draft.url}` : draft.command ? ` · ${draft.command}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
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
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform",
                      isExpanded && "rotate-180"
                    )}
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="space-y-4 border-t border-ink-800 px-3 py-3">
                  <McpConnectionSection
                    draft={draft}
                    onChange={(next) =>
                      setServerDrafts((current) => ({
                        ...current,
                        [server.id]: next
                      }))
                    }
                  />

                  <McpAuthSection
                    draft={draft}
                    onChange={(next) =>
                      setServerDrafts((current) => ({
                        ...current,
                        [server.id]: next
                      }))
                    }
                  />

                  <McpAdvancedSection
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
                      className="whitespace-nowrap shrink-0"
                      disabled={busyServerId === server.id || !isValidMcpServerName(draft) || !changed}
                      onClick={async () => {
                        await onUpdateServer(server.id, toMcpServerPayload(draft));
                      }}
                    >
                      <Save className="h-3.5 w-3.5" /> {busyServerId === server.id ? "Saving..." : "Save"}
                    </Button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-ink-600 transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                      onClick={async () => {
                        await onDeleteServer(server.id);
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
            className="whitespace-nowrap shrink-0"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Add MCP server
          </Button>
        ) : (
          <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)]">
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

              <div className="h-px bg-[var(--divider)]" />

              {/* Form fields */}
              <McpConnectionSection
                draft={newServer}
                onChange={(next) => setNewServer(next)}
              />
              <McpAuthSection
                draft={newServer}
                onChange={(next) => setNewServer(next)}
              />
              <McpAdvancedSection
                draft={newServer}
                onChange={(next) => setNewServer(next)}
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
                className="whitespace-nowrap shrink-0"
                disabled={creatingServer || !isValidMcpServerName(newServer)}
                onClick={onCreateServer}
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
