import type { CSSProperties } from "react";

import { type useAppState } from "./useAppState";
import { type useNavigationState } from "./useNavigationState";
import { AppShellLayout } from "./shell/AppShellLayout";
import { AppShellProviders } from "./shell/AppShellProviders";
import { useAppShellActions } from "./shell/useAppShellActions";

interface AppShellProps {
  state: ReturnType<typeof useAppState>;
  navigation: ReturnType<typeof useNavigationState>;
}

export function AppShell({
  state,
  navigation
}: AppShellProps) {
  const { notice, providers, storageConfig } = state;
  const actions = useAppShellActions(state);

  if (!providers || !storageConfig) {
    return (
      <div className="flex h-screen flex-col bg-canvas text-sm text-ink-300">
        <div
          className="glass-panel-dense flex h-[38px] shrink-0 items-center border-b border-ink-700/40 pl-[78px]"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        />
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="rounded-xl border border-ink-800 bg-ink-900/90 px-5 py-3 shadow-panel">{notice}</div>
        </div>
      </div>
    );
  }

  return (
    <AppShellProviders>
      <AppShellLayout state={state} navigation={navigation} actions={actions} />
    </AppShellProviders>
  );
}
