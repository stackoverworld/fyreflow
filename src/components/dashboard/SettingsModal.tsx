import { Bug, Monitor, Moon, Settings2, ShieldCheck, Sun, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Switch } from "@/components/optics/switch";
import { cn } from "@/lib/cn";
import type { DesktopNotificationSettings, ThemePreference } from "@/lib/appSettingsStorage";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  debugEnabled: boolean;
  onDebugEnabledChange: (enabled: boolean) => void;
  desktopNotifications: DesktopNotificationSettings;
  onDesktopNotificationsChange: (settings: DesktopNotificationSettings) => void;
  desktopNotificationsAvailable: boolean;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  providerSettingsSlot: ReactNode;
}

type SettingsTab = "general" | "providers";

const TABS: { id: SettingsTab; label: string; icon: typeof Settings2 }[] = [
  { id: "general", label: "General", icon: Bug },
  { id: "providers", label: "Provider Auth", icon: ShieldCheck }
];

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Monitor }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon }
];

export function SettingsModal({
  open,
  onClose,
  debugEnabled,
  onDebugEnabledChange,
  desktopNotifications,
  onDesktopNotificationsChange,
  desktopNotificationsAvailable,
  themePreference,
  onThemeChange,
  providerSettingsSlot
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const updateDesktopNotifications = (patch: Partial<DesktopNotificationSettings>) => {
    onDesktopNotificationsChange({
      ...desktopNotifications,
      ...patch
    });
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-ink-950/80 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="fixed inset-0 z-[95] flex items-center justify-center p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={onClose}
          >
            <div
              className="glass-panel-dense flex w-full max-w-[640px] rounded-2xl border border-ink-700/40"
              style={{ height: "min(520px, 75vh)" }}
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Left sidebar ── */}
              <nav className="flex w-[180px] shrink-0 flex-col overflow-hidden rounded-l-2xl border-r border-ink-800 bg-ink-950/40">
                <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
                  <Settings2 className="h-4 w-4 text-ink-400" />
                  <h2 className="text-sm font-semibold text-ink-100">Settings</h2>
                </header>

                <div className="flex-1 space-y-0.5 p-2">
                  {TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer",
                          isActive
                            ? "bg-ink-800/70 text-ink-50"
                            : "text-ink-400 hover:bg-ink-800/40 hover:text-ink-200"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* ── Right content ── */}
              <div className="flex flex-1 flex-col min-w-0">
                <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                    {TABS.find((t) => t.id === activeTab)?.label}
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100 cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto p-4">
                  {activeTab === "general" && (
                    <div className="space-y-4">
                      {/* ── Appearance ── */}
                      <div className="rounded-xl border border-ink-800 bg-ink-950/55 px-3 py-2.5">
                        <p className="text-xs text-ink-100 mb-2">Appearance</p>
                        <div className="flex gap-1 rounded-lg bg-ink-900/60 p-1">
                          {THEME_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const isActive = themePreference === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => onThemeChange(option.value)}
                                className={cn(
                                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors cursor-pointer",
                                  isActive
                                    ? "bg-ink-800 text-ink-50 shadow-sm"
                                    : "text-ink-500 hover:text-ink-300"
                                )}
                              >
                                <Icon className="h-3 w-3" />
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* ── Debug mode ── */}
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-950/55 px-3 py-2.5">
                        <div>
                          <p className="text-xs text-ink-100">Debug mode</p>
                          <p className="text-[11px] text-ink-500">Show debug panel with runtime trace, live logs and step timeline.</p>
                        </div>
                        <Switch checked={debugEnabled} onChange={onDebugEnabledChange} />
                      </div>

                      {/* ── Desktop notifications ── */}
                      <div className="rounded-xl border border-ink-800 bg-ink-950/55">
                        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                          <div>
                            <p className="text-xs text-ink-100">Desktop notifications</p>
                            <p className="text-[11px] text-ink-500">
                              {desktopNotificationsAvailable
                                ? "Send system notifications for run events."
                                : "Available in Electron desktop mode."}
                            </p>
                          </div>
                          <Switch
                            checked={desktopNotifications.enabled}
                            onChange={(enabled) => updateDesktopNotifications({ enabled })}
                          />
                        </div>

                        <div className="h-px bg-ink-800/60" />

                        <div className="space-y-0">
                          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div>
                              <p className="text-xs text-ink-100">Input required</p>
                              <p className="text-[11px] text-ink-500">Notify when a run needs more input and opens a modal.</p>
                            </div>
                            <Switch
                              checked={desktopNotifications.inputRequired}
                              onChange={(inputRequired) => updateDesktopNotifications({ inputRequired })}
                              disabled={!desktopNotifications.enabled}
                            />
                          </div>

                          <div className="h-px bg-ink-800/60" />

                          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div>
                              <p className="text-xs text-ink-100">Run failed</p>
                              <p className="text-[11px] text-ink-500">Notify when a flow run finishes with failure.</p>
                            </div>
                            <Switch
                              checked={desktopNotifications.runFailed}
                              onChange={(runFailed) => updateDesktopNotifications({ runFailed })}
                              disabled={!desktopNotifications.enabled}
                            />
                          </div>

                          <div className="h-px bg-ink-800/60" />

                          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div>
                              <p className="text-xs text-ink-100">Run completed</p>
                              <p className="text-[11px] text-ink-500">Notify when a flow run completes successfully.</p>
                            </div>
                            <Switch
                              checked={desktopNotifications.runCompleted}
                              onChange={(runCompleted) => updateDesktopNotifications({ runCompleted })}
                              disabled={!desktopNotifications.enabled}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "providers" && providerSettingsSlot}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
