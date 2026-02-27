import { useCallback, useEffect, useRef, useState } from "react";
import {
  getProviderOAuthStatus,
  startProviderOAuthLogin,
  submitProviderOAuthCode,
  syncProviderOAuthToken
} from "@/lib/api";
import type { AuthMode, ProviderConfig, ProviderId, ProviderOAuthStatus } from "@/lib/types";
import { ProviderSettingsSection } from "./provider-settings/sections";
import {
  PROVIDER_ORDER,
  setProviderAuthMode,
  setProviderCredential,
  setProviderField
} from "./provider-settings/mappers";
import {
  hasProviderDraftChanges,
  isLikelyClaudeSetupToken,
  oauthStatusLine,
  shouldAutoSwitchToOAuth
} from "./provider-settings/validation";
import { getActiveConnectionSettings } from "@/lib/connectionSettingsStorage";
import {
  buildProviderOAuthStartErrorMessage,
  buildProviderOAuthStartMessage,
  shouldOpenProviderOAuthBrowser
} from "./providerOauthConnectModel";

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
  const runtimeProbeBootstrapRef = useRef<Set<ProviderId>>(new Set());
  const oauthStatusesRef = useRef(oauthStatuses);

  useEffect(() => {
    setDrafts(providers);
  }, [providers]);

  useEffect(() => {
    oauthStatusesRef.current = oauthStatuses;
  }, [oauthStatuses]);

  const loadOAuthStatus = useCallback(
    async (
      providerId: ProviderId,
      options?: {
        includeRuntimeProbe?: boolean;
        preserveMessage?: boolean;
      }
    ): Promise<ProviderOAuthStatus | null> => {
      try {
        const response = await getProviderOAuthStatus(providerId, options);
        const previousStatus = oauthStatusesRef.current[providerId];
        const nextStatus = !response.status.runtimeProbe && previousStatus?.runtimeProbe
          ? {
              ...response.status,
              runtimeProbe: previousStatus?.runtimeProbe
            }
          : response.status;

        onOAuthStatusChange(providerId, nextStatus);
        if (!options?.preserveMessage) {
          onOAuthMessageChange(providerId, nextStatus.message);
        }
        return nextStatus;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load OAuth status";
        onOAuthMessageChange(providerId, message);
        return null;
      }
    },
    [onOAuthMessageChange, onOAuthStatusChange]
  );

  const pollOAuthStatus = useCallback(
    async (providerId: ProviderId, attempts = 18): Promise<ProviderOAuthStatus | null> => {
      for (let index = 0; index < attempts; index += 1) {
        const status = await loadOAuthStatus(providerId, { preserveMessage: true });
        if (status?.loggedIn) {
          return status;
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, 1800);
        });
      }

      return loadOAuthStatus(providerId, { preserveMessage: true });
    },
    [loadOAuthStatus]
  );

  const handleAuthModeChange = useCallback(
    (providerId: ProviderId, next: AuthMode) => {
      setDrafts((current) => setProviderAuthMode(current, providerId, next));
    },
    []
  );

  const handleCredentialChange = useCallback((providerId: ProviderId, value: string) => {
    setDrafts((current) => setProviderCredential(current, providerId, current[providerId].authMode, value));
  }, []);

  const handleBaseUrlChange = useCallback((providerId: ProviderId, value: string) => {
    setDrafts((current) => setProviderField(current, providerId, "baseUrl", value));
  }, []);

  const handleDefaultModelChange = useCallback((providerId: ProviderId, value: string) => {
    setDrafts((current) => setProviderField(current, providerId, "defaultModel", value));
  }, []);

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
      const provider = drafts[providerId];
      const status = oauthStatuses[providerId];

      if (!provider || provider.authMode !== "oauth") {
        runtimeProbeBootstrapRef.current.delete(providerId);
        continue;
      }

      if (!status || status.runtimeProbe || oauthBusyId !== null || runtimeProbeBootstrapRef.current.has(providerId)) {
        continue;
      }

      runtimeProbeBootstrapRef.current.add(providerId);
      void loadOAuthStatus(providerId, { includeRuntimeProbe: true }).finally(() => {
        runtimeProbeBootstrapRef.current.delete(providerId);
      });
    }
  }, [drafts, loadOAuthStatus, oauthBusyId, oauthStatuses]);

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

      if (!shouldAutoSwitchToOAuth({
        provider,
        status,
        hasAlreadyAutoSwitched: autoSwitchedProvidersRef.current.has(providerId)
      })) {
        continue;
      }

      autoSwitchedProvidersRef.current.add(providerId);

      setDrafts((current) =>
        setProviderAuthMode(current, providerId, "oauth")
      );

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

  const buildOAuthStatusText = useCallback(
    (providerId: ProviderId) => {
      const status = oauthStatuses[providerId];
      return oauthStatusLine(status, oauthMessages[providerId]);
    },
    [oauthMessages, oauthStatuses]
  );
  const connectionMode = getActiveConnectionSettings().mode;

  const handleStartOAuthLogin = useCallback(
    async (providerId: ProviderId) => {
      const connection = getActiveConnectionSettings();
      const shouldOpenBrowser = shouldOpenProviderOAuthBrowser(connection.mode);
      const isElectronDesktop = window.desktop?.isElectron === true;
      let pendingWindow: Window | null = null;
      const closePendingWindow = () => {
        if (!pendingWindow || pendingWindow.closed) {
          return;
        }

        try {
          pendingWindow.close();
        } catch {
          // Ignore close errors from strict popup blockers.
        } finally {
          pendingWindow = null;
        }
      };

      const openBrowserUrl = (url: string) => {
        if (url.trim().length === 0) {
          return;
        }

        if (pendingWindow && !pendingWindow.closed) {
          try {
            pendingWindow.location.href = url;
            return;
          } catch {
            // Ignore and fallback to a new window attempt.
          }
        }

        const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
        pendingWindow = openedWindow;
        if (!openedWindow && !isElectronDesktop) {
          // Fallback for environments that block window.open but still allow synthetic anchor navigation.
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
      };

      if (shouldOpenBrowser) {
        pendingWindow = window.open("about:blank", "_blank");
      }

      setOauthBusyId(providerId);

      try {
        const response = await startProviderOAuthLogin(providerId);
        const loginUrl = (response.result.authUrl ?? "").trim();
        if (shouldOpenBrowser && loginUrl.length > 0) {
          openBrowserUrl(loginUrl);
        } else if (shouldOpenBrowser) {
          closePendingWindow();
        }

        onOAuthMessageChange(
          providerId,
          buildProviderOAuthStartMessage({
            connectionMode: connection.mode,
            providerId,
            apiMessage: response.result.message,
            command: response.result.command,
            authUrl: response.result.authUrl,
            authCode: response.result.authCode
          })
        );
        void (async () => {
          await pollOAuthStatus(providerId);
          await loadOAuthStatus(providerId, {
            includeRuntimeProbe: true,
            preserveMessage: true
          });
        })().catch(() => {
          // Keep connect flow resilient; user can refresh status manually.
        });
      } catch (error) {
        onOAuthMessageChange(
          providerId,
          buildProviderOAuthStartErrorMessage({
            connectionMode: connection.mode,
            providerId,
            errorMessage: error instanceof Error ? error.message : "Failed to start OAuth login."
          })
        );
        closePendingWindow();
        await loadOAuthStatus(providerId, { preserveMessage: true });
      } finally {
        setOauthBusyId(null);
      }
    },
    [loadOAuthStatus, onOAuthMessageChange, pollOAuthStatus]
  );

  const handleSyncOAuthToken = useCallback(
    async (providerId: ProviderId) => {
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
    },
    [loadOAuthStatus, onOAuthMessageChange, onSaveProvider]
  );

  const handleRefreshOAuthStatus = useCallback(
    async (providerId: ProviderId) => {
      setOauthBusyId(providerId);
      try {
        await loadOAuthStatus(providerId, { includeRuntimeProbe: true });
      } finally {
        setOauthBusyId(null);
      }
    },
    [loadOAuthStatus]
  );

  const handleSaveProvider = useCallback(
    async (providerId: ProviderId) => {
      const provider = drafts[providerId];
      setSavingId(providerId);
      try {
        const oauthValue = provider.authMode === "oauth" ? provider.oauthToken.trim() : "";
        const shouldSubmitClaudeBrowserCode =
          providerId === "claude" &&
          provider.authMode === "oauth" &&
          oauthValue.length > 0 &&
          !isLikelyClaudeSetupToken(oauthValue);

        if (shouldSubmitClaudeBrowserCode) {
          const response = await submitProviderOAuthCode(providerId, oauthValue);
          onOAuthMessageChange(providerId, response.result.message);
          setDrafts((current) => setProviderCredential(current, providerId, "oauth", ""));
          await loadOAuthStatus(providerId, {
            includeRuntimeProbe: true,
            preserveMessage: true
          });
          return;
        }

        await onSaveProvider(providerId, provider);
        await loadOAuthStatus(providerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save provider";
        onOAuthMessageChange(providerId, message);
      } finally {
        setSavingId(null);
      }
    },
    [drafts, loadOAuthStatus, onOAuthMessageChange, onSaveProvider]
  );
  const isProviderBusy = useCallback(
    (providerId: ProviderId) => savingId === providerId || oauthBusyId === providerId,
    [oauthBusyId, savingId]
  );

  return (
    <div>
      {PROVIDER_ORDER.map((providerId, providerIndex) => {
        const provider = drafts[providerId];
        const savedProvider = providers[providerId];
        const hasUnsavedChanges =
          provider && savedProvider ? hasProviderDraftChanges(provider, savedProvider) : false;

        return (
          <ProviderSettingsSection
            key={providerId}
            providerId={providerId}
            providerIndex={providerIndex}
            provider={provider}
            status={oauthStatuses[providerId]}
            oauthStatusText={buildOAuthStatusText(providerId)}
            hasUnsavedChanges={hasUnsavedChanges}
            busy={isProviderBusy(providerId)}
            saving={savingId === providerId}
            onAuthModeChange={handleAuthModeChange}
            onCredentialChange={handleCredentialChange}
            onBaseUrlChange={handleBaseUrlChange}
            onDefaultModelChange={handleDefaultModelChange}
            onConnect={handleStartOAuthLogin}
            connectionMode={connectionMode}
            onImportToken={handleSyncOAuthToken}
            onRefresh={handleRefreshOAuthStatus}
            onSave={handleSaveProvider}
          />
        );
      })}
    </div>
  );
}
