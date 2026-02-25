import type { CSSProperties } from "react";
import { Settings2 } from "lucide-react";

import { type useAppState } from "./useAppState";
import { type useNavigationState } from "./useNavigationState";
import { AppShellLayout } from "./shell/AppShellLayout";
import { AppShellProviders } from "./shell/AppShellProviders";
import { useAppShellActions } from "./shell/useAppShellActions";
import { SettingsModal } from "@/components/dashboard/SettingsModal";
import { RemotePairingSettings } from "@/components/dashboard/RemotePairingSettings";
import { UpdatesSettings } from "@/components/dashboard/UpdatesSettings";
import { ProviderSettings } from "@/components/dashboard/ProviderSettings";

interface AppShellProps {
  state: ReturnType<typeof useAppState>;
  navigation: ReturnType<typeof useNavigationState>;
}

function extractFirstUrl(input: string): string {
  const match = input.match(/https?:\/\/\S+/);
  return match?.[0] ?? "";
}

export function AppShell({
  state,
  navigation
}: AppShellProps) {
  const { notice, providers, storageConfig } = state;
  const fallbackNotice =
    notice.trim().length > 0
      ? notice
      : state.initialStateLoading
        ? "Connecting to backend..."
        : "Backend is not available. Open Settings > Remote to configure connection.";
  const downloadUrl = extractFirstUrl(fallbackNotice);
  const actions = useAppShellActions(state);

  if (!providers || !storageConfig) {
    return (
      <div className="flex h-screen flex-col bg-canvas text-sm text-ink-300">
        <div className="glass-panel-dense flex h-[38px] shrink-0 items-center justify-between border-b border-ink-700/40 pl-[78px] pr-2">
          <div style={{ WebkitAppRegion: "drag" } as CSSProperties} className="h-full flex-1" />
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700/50 bg-ink-900/60 px-2.5 py-1 text-xs text-ink-200 transition-colors hover:bg-ink-800"
            onClick={() => state.setSettingsOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Settings
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-[520px] rounded-xl border border-ink-800 bg-ink-900/90 px-5 py-4 shadow-panel">
            <p>{fallbackNotice}</p>
            <div className="mt-3">
              {downloadUrl ? (
                <button
                  type="button"
                  className="mr-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700/50 bg-ink-900/60 px-3 py-1.5 text-xs text-ink-200 transition-colors hover:bg-ink-800"
                  onClick={() => {
                    window.open(downloadUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  Download Update
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-700/50 bg-ink-900/60 px-3 py-1.5 text-xs text-ink-200 transition-colors hover:bg-ink-800"
                onClick={() => state.setSettingsOpen(true)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Open Settings
              </button>
            </div>
          </div>
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

  return (
    <AppShellProviders>
      <AppShellLayout state={state} navigation={navigation} actions={actions} />
    </AppShellProviders>
  );
}
