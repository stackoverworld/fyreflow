import { type CSSProperties, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, Loader2, Settings2, WifiOff } from "lucide-react";

import { type useAppState } from "./useAppState";
import { type useNavigationState } from "./useNavigationState";
import { AppShellLayout } from "./shell/AppShellLayout";
import { AppShellProviders } from "./shell/AppShellProviders";
import { useAppShellActions } from "./shell/useAppShellActions";
import { SettingsModal } from "@/components/dashboard/SettingsModal";
import { RemotePairingSettings } from "@/components/dashboard/RemotePairingSettings";
import { UpdatesSettings } from "@/components/dashboard/UpdatesSettings";
import { ProviderSettings } from "@/components/dashboard/ProviderSettings";
import { Button } from "@/components/optics/button";

interface AppShellProps {
  state: ReturnType<typeof useAppState>;
  navigation: ReturnType<typeof useNavigationState>;
}

function extractFirstUrl(input: string): string {
  const match = input.match(/https?:\/\/\S+/);
  return match?.[0] ?? "";
}

const LOADING_REVEAL_MS = 400;

const easeSnap = [0.16, 1, 0.3, 1] as const;

function FallbackShell({ state }: { state: AppShellProps["state"] }) {
  const { notice } = state;
  const isLoading = state.initialStateLoading;

  /* Delay showing the loading indicator so fast connections never see it */
  const [showLoader, setShowLoader] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setShowLoader(false);
      return;
    }
    const id = window.setTimeout(() => setShowLoader(true), LOADING_REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  const errorMessage =
    notice.trim().length > 0
      ? notice
      : "Backend is not available. Open Settings \u203A Remote to configure connection.";
  const downloadUrl = extractFirstUrl(errorMessage);

  return (
    <div className="flex h-screen flex-col bg-canvas text-sm text-ink-300">
      {/* Titlebar */}
      <div className="glass-panel-dense flex h-[38px] shrink-0 items-center justify-between border-b border-ink-700/40 pl-[78px] pr-2">
        <div style={{ WebkitAppRegion: "drag" } as CSSProperties} className="h-full flex-1" />
        {!isLoading && (
          <Button variant="secondary" size="sm" onClick={() => state.setSettingsOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" />
            Settings
          </Button>
        )}
      </div>

      {/* Center content — animated switch between loading and error */}
      <div className="flex flex-1 items-center justify-center px-4">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: showLoader ? 1 : 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: easeSnap as unknown as number[] }}
              className="flex flex-col items-center gap-4"
            >
              <Loader2 className="h-6 w-6 animate-spin text-ember-500/70" />
              <p className="font-body text-xs text-ink-500">Connecting\u2026</p>
            </motion.div>
          ) : (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: easeSnap as unknown as number[] }}
              className="w-full max-w-[480px] rounded-2xl border border-[var(--card-border)] bg-[var(--card-surface)] px-5 py-5 shadow-panel"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ember-500/10">
                  <WifiOff className="h-4 w-4 text-ember-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold text-ink-100">Unable to connect</h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-400">{errorMessage}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {downloadUrl ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => window.open(downloadUrl, "_blank", "noopener,noreferrer")}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Update
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => state.setSettingsOpen(true)}>
                  <Settings2 className="h-3.5 w-3.5" />
                  Open Settings
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <SettingsModal
        open={state.settingsOpen}
        onClose={() => state.setSettingsOpen(false)}
        debugEnabled={state.debugEnabled}
        onDebugEnabledChange={state.setDebugEnabled}
        desktopNotifications={state.desktopNotifications}
        onDesktopNotificationsChange={state.setDesktopNotifications}
        desktopNotificationsAvailable={typeof window !== "undefined" && window.desktop?.isElectron === true}
        themePreference={state.themePreference}
        onThemeChange={state.setTheme}
        providerSettingsSlot={
          state.providers ? (
            <ProviderSettings
              providers={state.providers}
              oauthStatuses={state.providerOauthStatuses}
              oauthMessages={state.providerOauthMessages}
              onOAuthStatusChange={state.handleProviderOauthStatusChange}
              onOAuthMessageChange={state.handleProviderOauthMessageChange}
              onSaveProvider={async (providerId, patch) => {
                await state.handleSaveProvider(providerId, patch);
              }}
            />
          ) : (
            <p className="text-xs text-ink-500">Provider configuration is unavailable until backend access is restored.</p>
          )
        }
        remoteSettingsSlot={<RemotePairingSettings />}
        updatesSettingsSlot={<UpdatesSettings />}
      />
    </div>
  );
}

export function AppShell({
  state,
  navigation
}: AppShellProps) {
  const { providers, storageConfig } = state;
  const actions = useAppShellActions(state);

  if (!providers || !storageConfig) {
    return <FallbackShell state={state} />;
  }

  return (
    <AppShellProviders>
      <AppShellLayout state={state} navigation={navigation} actions={actions} />
    </AppShellProviders>
  );
}
