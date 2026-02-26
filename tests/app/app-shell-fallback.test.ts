import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "../../src/app/AppShell";

describe("AppShell fallback", () => {
  it("renders recovery actions when backend state is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        state: {
          initialStateLoading: false,
          notice: "Remote backend rejected current API token.",
          providers: null,
          storageConfig: null,
          settingsOpen: false,
          debugEnabled: false,
          desktopNotifications: {
            enabled: false,
            inputRequired: false,
            runFailed: false,
            runCompleted: false
          },
          themePreference: "system",
          providerOauthStatuses: {},
          providerOauthMessages: {},
          setSettingsOpen: vi.fn(),
          setDebugEnabled: vi.fn(),
          setDesktopNotifications: vi.fn(),
          setTheme: vi.fn(),
          handleProviderOauthStatusChange: vi.fn(),
          handleProviderOauthMessageChange: vi.fn(),
          handleSaveProvider: vi.fn()
        } as unknown,
        navigation: {
          activePanel: null
        } as unknown
      })
    );

    expect(html).toContain("Remote backend rejected current API token.");
    expect(html).toContain("Open Settings");
    expect(html).toContain("Settings");
  });

  it("shows default recovery text when notice is empty", () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        state: {
          initialStateLoading: false,
          notice: "",
          providers: null,
          storageConfig: null,
          settingsOpen: false,
          debugEnabled: false,
          desktopNotifications: {
            enabled: false,
            inputRequired: false,
            runFailed: false,
            runCompleted: false
          },
          themePreference: "system",
          providerOauthStatuses: {},
          providerOauthMessages: {},
          setSettingsOpen: vi.fn(),
          setDebugEnabled: vi.fn(),
          setDesktopNotifications: vi.fn(),
          setTheme: vi.fn(),
          handleProviderOauthStatusChange: vi.fn(),
          handleProviderOauthMessageChange: vi.fn(),
          handleSaveProvider: vi.fn()
        } as unknown,
        navigation: {
          activePanel: null
        } as unknown
      })
    );

    expect(html).toContain("Backend is not available. Open Settings \u203A Remote to configure connection.");
  });

  it("shows neutral loading copy while initial state is still loading", () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        state: {
          initialStateLoading: true,
          notice: "",
          providers: null,
          storageConfig: null,
          settingsOpen: false,
          debugEnabled: false,
          desktopNotifications: {
            enabled: false,
            inputRequired: false,
            runFailed: false,
            runCompleted: false
          },
          themePreference: "system",
          providerOauthStatuses: {},
          providerOauthMessages: {},
          setSettingsOpen: vi.fn(),
          setDebugEnabled: vi.fn(),
          setDesktopNotifications: vi.fn(),
          setTheme: vi.fn(),
          handleProviderOauthStatusChange: vi.fn(),
          handleProviderOauthMessageChange: vi.fn(),
          handleSaveProvider: vi.fn()
        } as unknown,
        navigation: {
          activePanel: null
        } as unknown
      })
    );

    expect(html).toContain("Connecting\u2026");
    expect(html).not.toContain("Backend is not available.");
  });
});
