import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProviderOAuthStatus,
  startProviderOAuthLogin,
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
  oauthStatusLine,
  shouldAutoSwitchToOAuth
} from "./provider-settings/validation";

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

  useEffect(() => {
    setDrafts(providers);
  }, [providers]);

  const loadOAuthStatus = useCallback(
    async (
      providerId: ProviderId,
      options?: {
        includeRuntimeProbe?: boolean;
      }
    ): Promise<ProviderOAuthStatus | null> => {
      try {
        const response = await getProviderOAuthStatus(providerId, options);
        onOAuthStatusChange(providerId, response.status);
        onOAuthMessageChange(providerId, response.status.message);
        return response.status;
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
        const status = await loadOAuthStatus(providerId);
        if (status?.loggedIn) {
          return status;
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, 1800);
        });
      }

      return loadOAuthStatus(providerId);
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

  const handleStartOAuthLogin = useCallback(
    async (providerId: ProviderId) => {
      setOauthBusyId(providerId);
      try {
        const response = await startProviderOAuthLogin(providerId);
        onOAuthMessageChange(providerId, response.result.message);
        await pollOAuthStatus(providerId);
        await loadOAuthStatus(providerId, { includeRuntimeProbe: true });
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
        await onSaveProvider(providerId, provider);
        await loadOAuthStatus(providerId);
      } finally {
        setSavingId(null);
      }
    },
    [drafts, loadOAuthStatus, onSaveProvider]
  );

  const busy = useMemo(() => savingId !== null || oauthBusyId !== null, [oauthBusyId, savingId]);

  return (
    <div>
      {PROVIDER_ORDER.map((providerId, providerIndex) => {
        const provider = drafts[providerId];

        return (
          <ProviderSettingsSection
            key={providerId}
            providerId={providerId}
            providerIndex={providerIndex}
            provider={provider}
            status={oauthStatuses[providerId]}
            oauthStatusText={buildOAuthStatusText(providerId)}
            busy={busy}
            saving={savingId === providerId}
            onAuthModeChange={handleAuthModeChange}
            onCredentialChange={handleCredentialChange}
            onBaseUrlChange={handleBaseUrlChange}
            onDefaultModelChange={handleDefaultModelChange}
            onConnect={handleStartOAuthLogin}
            onImportToken={handleSyncOAuthToken}
            onRefresh={handleRefreshOAuthStatus}
            onSave={handleSaveProvider}
          />
        );
      })}
    </div>
  );
}
