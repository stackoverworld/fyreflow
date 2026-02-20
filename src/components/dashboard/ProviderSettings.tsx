import { CheckCircle2, KeyRound, Link2, LockKeyhole, RefreshCw, Save, Settings2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProviderOAuthStatus,
  startProviderOAuthLogin,
  syncProviderOAuthToken
} from "@/lib/api";
import type { AuthMode, ProviderConfig, ProviderId, ProviderOAuthStatus } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Badge } from "@/components/optics/badge";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";

interface ProviderSettingsProps {
  providers: Record<ProviderId, ProviderConfig>;
  oauthStatuses: StatusMap;
  oauthMessages: MessageMap;
  onOAuthStatusChange: (providerId: ProviderId, status: ProviderOAuthStatus | null) => void;
  onOAuthMessageChange: (providerId: ProviderId, message: string) => void;
  onSaveProvider: (providerId: ProviderId, patch: Partial<ProviderConfig>) => Promise<void>;
}

type StatusMap = Record<ProviderId, ProviderOAuthStatus | null>;
type MessageMap = Record<ProviderId, string>;
const PROVIDER_ORDER: ProviderId[] = ["openai", "claude"];

export function ProviderSettings({
  providers,
  oauthStatuses,
  oauthMessages,
  onOAuthStatusChange,
  onOAuthMessageChange,
  onSaveProvider
}: ProviderSettingsProps) {
  const [drafts, setDrafts] = useState(providers);
  const [savingId, setSavingId] = useState<ProviderId | null>(null);
  const [oauthBusyId, setOauthBusyId] = useState<ProviderId | null>(null);
  const autoSwitchedProvidersRef = useRef<Set<ProviderId>>(new Set());
  const oauthBootstrapLoadingRef = useRef<Set<ProviderId>>(new Set());

  useEffect(() => {
    setDrafts(providers);
  }, [providers]);

  const loadOAuthStatus = useCallback(async (providerId: ProviderId): Promise<ProviderOAuthStatus | null> => {
    try {
      const response = await getProviderOAuthStatus(providerId);
      onOAuthStatusChange(providerId, response.status);
      onOAuthMessageChange(providerId, response.status.message);
      return response.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load OAuth status";
      onOAuthMessageChange(providerId, message);
      return null;
    }
  }, [onOAuthMessageChange, onOAuthStatusChange]);

  const pollOAuthStatus = useCallback(async (providerId: ProviderId, attempts = 18): Promise<ProviderOAuthStatus | null> => {
    for (let index = 0; index < attempts; index += 1) {
      const status = await loadOAuthStatus(providerId);
      if (status?.loggedIn) {
        return status;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 1800);
      });
    }

    return loadOAuthStatus(providerId);
  }, [loadOAuthStatus]);

  useEffect(() => {
    for (const providerId of PROVIDER_ORDER) {
      if (oauthStatuses[providerId] || oauthMessages[providerId] || oauthBootstrapLoadingRef.current.has(providerId)) {
        continue;
      }

      oauthBootstrapLoadingRef.current.add(providerId);
      void loadOAuthStatus(providerId).finally(() => {
        oauthBootstrapLoadingRef.current.delete(providerId);
      });
    }
  }, [loadOAuthStatus, oauthMessages, oauthStatuses]);

  useEffect(() => {
    for (const providerId of PROVIDER_ORDER) {
      const status = oauthStatuses[providerId];
      const provider = drafts[providerId];

      if (!status || !provider) {
        continue;
      }

      if (!status.loggedIn) {
        autoSwitchedProvidersRef.current.delete(providerId);
        continue;
      }

      if (provider.authMode === "oauth") {
        autoSwitchedProvidersRef.current.delete(providerId);
        continue;
      }

      const hasApiKey = provider.apiKey.trim().length > 0;
      if (hasApiKey || autoSwitchedProvidersRef.current.has(providerId)) {
        continue;
      }

      autoSwitchedProvidersRef.current.add(providerId);

      setDrafts((current) => ({
        ...current,
        [providerId]: {
          ...current[providerId],
          authMode: "oauth"
        }
      }));

      void onSaveProvider(providerId, { authMode: "oauth" })
        .then(() => {
          onOAuthMessageChange(providerId, "OAuth was detected and enabled automatically.");
        })
        .catch((error) => {
          autoSwitchedProvidersRef.current.delete(providerId);
          const message = error instanceof Error ? error.message : "Failed to enable OAuth mode automatically";
          onOAuthMessageChange(providerId, message);
        });
    }
  }, [drafts, oauthStatuses, onOAuthMessageChange, onSaveProvider]);

  const oauthStatusLine = useMemo(() => {
    return (providerId: ProviderId) => {
      const status = oauthStatuses[providerId];
      if (!status) {
        return oauthMessages[providerId] || "Checking status...";
      }

      return `${status.message} Last checked ${new Date(status.checkedAt).toLocaleTimeString()}.`;
    };
  }, [oauthMessages, oauthStatuses]);

  return (
    <div>
      {PROVIDER_ORDER.map((providerId, providerIndex) => {
        const provider = drafts[providerId];
        const authMode: AuthMode = provider.authMode;
        const busy = savingId !== null || oauthBusyId !== null;
        const status = oauthStatuses[providerId];
        const isLoggedIn = status?.loggedIn === true;
        const canUseCli = status?.canUseCli === true;
        const showOauthTokenInput = authMode !== "oauth" || providerId === "openai";

        return (
          <div key={providerId}>
            {providerIndex > 0 ? <div className="my-5 h-px bg-ink-800/60" /> : null}

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-ink-400">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">{provider.label}</span>
                </div>
                <span className="text-[11px] text-ink-600">{new Date(provider.updatedAt).toLocaleString()}</span>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-ink-400">Auth mode</span>
                <Select
                  value={authMode}
                  onValueChange={(next) => {
                    setDrafts((current) => ({
                      ...current,
                      [providerId]: {
                        ...current[providerId],
                        authMode: next as AuthMode
                      }
                    }));
                  }}
                  options={[
                    { value: "api_key", label: "API key" },
                    { value: "oauth", label: isLoggedIn ? "OAuth (connected)" : "OAuth" }
                  ]}
                />
                {authMode === "api_key" && isLoggedIn && provider.apiKey.trim().length === 0 ? (
                  <p className="text-[11px] text-ink-500">
                    OAuth is already connected via CLI. This provider will switch to OAuth automatically.
                  </p>
                ) : null}
              </div>

              {showOauthTokenInput ? (
                <label className="space-y-1">
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                    {authMode === "oauth" ? <LockKeyhole className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
                    {authMode === "oauth" ? "OAuth token (optional)" : "API key"}
                  </span>
                  <Input
                    type="password"
                    value={authMode === "oauth" ? provider.oauthToken : provider.apiKey}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDrafts((current) => ({
                        ...current,
                        [providerId]: {
                          ...current[providerId],
                          oauthToken: authMode === "oauth" ? value : current[providerId].oauthToken,
                          apiKey: authMode === "api_key" ? value : current[providerId].apiKey
                        }
                      }));
                    }}
                    placeholder={authMode === "oauth" ? "Auto-managed or paste token" : "sk-..."}
                  />
                </label>
              ) : (
                <div className="space-y-1">
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                    <LockKeyhole className="h-3 w-3" />
                    OAuth managed by CLI
                  </span>
                  <p className="text-xs text-ink-500">
                    Claude stores OAuth credentials internally. No token will appear in this panel.
                  </p>
                </div>
              )}

              {authMode === "oauth" ? (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {isLoggedIn ? (
                      <Badge variant="success">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                      </Badge>
                    ) : (
                      <Badge variant="danger">
                        <XCircle className="mr-1 h-3 w-3" /> Not connected
                      </Badge>
                    )}
                    {canUseCli ? (
                      <Badge variant="running">CLI ready</Badge>
                    ) : (
                      <Badge variant="warning">CLI unavailable</Badge>
                    )}
                  </div>

                  <p className="text-xs text-ink-500">{oauthStatusLine(providerId)}</p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        setOauthBusyId(providerId);
                        try {
                          const response = await startProviderOAuthLogin(providerId);
                          onOAuthMessageChange(providerId, response.result.message);
                          await pollOAuthStatus(providerId);
                        } finally {
                          setOauthBusyId(null);
                        }
                      }}
                    >
                      <Link2 className="mr-1 h-4 w-4" /> {isLoggedIn ? "Reconnect" : "Connect"}
                    </Button>

                    {providerId === "openai" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={async () => {
                          setOauthBusyId(providerId);
                          try {
                            const response = await syncProviderOAuthToken(providerId);
                            setDrafts((current) => ({
                              ...current,
                              [providerId]: response.provider
                            }));
                            onOAuthMessageChange(providerId, response.result.message);
                            await onSaveProvider(providerId, {
                              authMode: "oauth"
                            });
                            await loadOAuthStatus(providerId);
                          } finally {
                            setOauthBusyId(null);
                          }
                        }}
                      >
                        Import token
                      </Button>
                    ) : null}

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setOauthBusyId(providerId);
                        try {
                          await loadOAuthStatus(providerId);
                        } finally {
                          setOauthBusyId(null);
                        }
                      }}
                    >
                      <RefreshCw className="mr-1 h-4 w-4" /> Refresh
                    </Button>
                  </div>

                  {providerId === "claude" ? (
                    <p className="text-xs text-ink-500">
                      In OAuth mode the dashboard uses Claude CLI auth automatically when no token is set.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Base URL</span>
                <Input
                  value={provider.baseUrl}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [providerId]: {
                        ...current[providerId],
                        baseUrl: event.target.value
                      }
                    }))
                  }
                  placeholder="https://api.openai.com/v1"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Default model</span>
                <Input
                  value={provider.defaultModel}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [providerId]: {
                        ...current[providerId],
                        defaultModel: event.target.value
                      }
                    }))
                  }
                  placeholder={providerId === "openai" ? "gpt-5.3-codex" : "claude-sonnet-4-6"}
                />
              </label>

              <Button
                variant="secondary"
                onClick={async () => {
                  setSavingId(providerId);
                  try {
                    await onSaveProvider(providerId, provider);
                    await loadOAuthStatus(providerId);
                  } finally {
                    setSavingId(null);
                  }
                }}
                disabled={busy}
              >
                <Save className="mr-2 h-4 w-4" /> {savingId === providerId ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
