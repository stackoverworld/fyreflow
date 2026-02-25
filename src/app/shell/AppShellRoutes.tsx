import { RunInputRequestModal } from "@/components/dashboard/RunInputRequestModal";
import { RunCompletionModal } from "@/components/dashboard/RunCompletionModal";
import { SettingsModal } from "@/components/dashboard/SettingsModal";
import { RemotePairingSettings } from "@/components/dashboard/RemotePairingSettings";
import { UpdatesSettings } from "@/components/dashboard/UpdatesSettings";
import { ProviderSettings } from "@/components/dashboard/ProviderSettings";
import { type useAppState } from "@/app/useAppState";
import { type useNavigationState } from "@/app/useNavigationState";
import { type AppShellActions } from "./useAppShellActions";
import { canActivatePanel } from "./routes/guards";
import { getPanelTitle } from "./routes/config";
import { getStaticPanelRoute } from "./routes/staticRoutes";
import { getLazyPanelRoute } from "./routes/lazyRoutes";
import { LeftPanelRouteWrapper, RightPanelRouteWrapper, ShellNoticeBanner } from "./routes/routeWrappers";

interface AppShellRoutesProps {
  state: ReturnType<typeof useAppState>;
  navigation: ReturnType<typeof useNavigationState>;
  actions: AppShellActions;
}

export function AppShellRoutes({
  state,
  navigation,
  actions
}: AppShellRoutesProps) {
  const {
    notice,
    runInputModal,
    runCompletionModal,
    processingRunInputModal,
    debugEnabled
  } = state;

  const {
    activePanel,
    setActivePanel
  } = navigation;

  const {
    handleConfirmRunInputModal,
    setRunInputModal,
    setRunCompletionModal,
    setSettingsOpen,
    setTheme,
    setDesktopNotifications,
    setDebugEnabled,
    handleSaveProvider,
    handleProviderOauthStatusChange,
    handleProviderOauthMessageChange
  } = actions;
  const hasLeftPanel = activePanel !== null && activePanel !== "run" && canActivatePanel(activePanel, { debugEnabled });
  const leftPanelRoute = activePanel !== null && activePanel !== "run" ? getStaticPanelRoute(activePanel) : undefined;
  const runPanelRoute = getLazyPanelRoute("run");
  const leftPanelTitle = getPanelTitle(activePanel);

  return (
    <>
      <LeftPanelRouteWrapper open={hasLeftPanel} title={leftPanelTitle} compact={activePanel === "ai" || activePanel === "debug" || activePanel === "contracts" || activePanel === "schedules"} onClose={() => {
        setActivePanel(null);
      }}>
        {leftPanelRoute?.render({ state, actions })}
      </LeftPanelRouteWrapper>

      <RightPanelRouteWrapper open={activePanel === "run"} compact onClose={() => {
        setActivePanel(null);
      }}>
        {runPanelRoute?.render({ state, actions })}
      </RightPanelRouteWrapper>

      <RunInputRequestModal
        open={Boolean(runInputModal)}
        title={runInputModal?.source === "runtime" ? "Runtime input required" : "Run startup input required"}
        summary={runInputModal?.summary}
        requests={runInputModal?.requests ?? []}
        blockers={runInputModal?.blockers ?? []}
        initialValues={runInputModal?.inputs}
        busy={processingRunInputModal}
        confirmLabel={runInputModal?.confirmLabel}
        onClose={() => {
          if (!processingRunInputModal) {
            setRunInputModal(null);
          }
        }}
        onConfirm={handleConfirmRunInputModal}
      />

      <RunCompletionModal
        open={Boolean(runCompletionModal)}
        completion={runCompletionModal}
        storageConfig={state.storageConfig}
        onClose={() => {
          setRunCompletionModal(null);
        }}
        onViewRun={() => {
          setRunCompletionModal(null);
          setActivePanel("run");
        }}
      />

      <SettingsModal
        open={state.settingsOpen}
        onClose={() => setSettingsOpen(false)}
        debugEnabled={debugEnabled}
        onDebugEnabledChange={(enabled) => {
          setDebugEnabled(enabled);
          if (!enabled && activePanel === "debug") {
            setActivePanel(null);
          }
        }}
        desktopNotifications={state.desktopNotifications}
        onDesktopNotificationsChange={setDesktopNotifications}
        desktopNotificationsAvailable={window.desktop?.isElectron === true}
        themePreference={state.themePreference}
        onThemeChange={setTheme}
        providerSettingsSlot={
          state.providers ? (
            <ProviderSettings
              providers={state.providers}
              oauthStatuses={state.providerOauthStatuses}
              oauthMessages={state.providerOauthMessages}
              onOAuthStatusChange={handleProviderOauthStatusChange}
              onOAuthMessageChange={handleProviderOauthMessageChange}
              onSaveProvider={async (providerId, patch) => {
                await handleSaveProvider(providerId, patch);
              }}
            />
          ) : (
            <p className="text-xs text-ink-500">Loading provider configuration...</p>
          )
        }
        remoteSettingsSlot={<RemotePairingSettings />}
        updatesSettingsSlot={<UpdatesSettings />}
      />

      <ShellNoticeBanner notice={notice} />
    </>
  );
}
