import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTION_SETTINGS_CHANGED_EVENT,
  getActiveConnectionSettings,
  loadConnectionSettings,
  notifyConnectionSettingsChanged,
  saveConnectionSettings,
  setConnectionSettings
} from "../../src/lib/connectionSettingsStorage";

const globalWithWindow = globalThis as typeof globalThis & { window?: Window };
const originalWindow = globalWithWindow.window;

function createMockWindow() {
  const storage = new Map<string, string>();
  return {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      }
    },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  } as unknown as Window;
}

afterEach(() => {
  if (typeof originalWindow === "undefined") {
    delete globalWithWindow.window;
  } else {
    globalWithWindow.window = originalWindow;
  }
  vi.restoreAllMocks();
});

describe("connection settings storage", () => {
  it("returns sane defaults without window storage", () => {
    delete globalWithWindow.window;
    const settings = loadConnectionSettings();
    expect(settings.mode).toBe("local");
    expect(settings.localApiBaseUrl.length).toBeGreaterThan(0);
    expect(settings.remoteApiBaseUrl.length).toBeGreaterThan(0);

    const active = getActiveConnectionSettings(settings);
    expect(active.mode).toBe("local");
    expect(active.apiBaseUrl).toBe(settings.localApiBaseUrl);
  });

  it("persists and normalizes connection settings", () => {
    globalWithWindow.window = createMockWindow();

    setConnectionSettings({
      mode: "remote",
      localApiBaseUrl: "http://localhost:8787/",
      remoteApiBaseUrl: "https://remote.example.com/",
      apiToken: "  token-1  ",
      realtimePath: "api/ws",
      deviceToken: "device-1"
    });

    const loaded = loadConnectionSettings();
    expect(loaded.mode).toBe("remote");
    expect(loaded.localApiBaseUrl).toBe("http://localhost:8787");
    expect(loaded.remoteApiBaseUrl).toBe("https://remote.example.com");
    expect(loaded.apiToken).toBe("token-1");
    expect(loaded.realtimePath).toBe("/api/ws");
    expect(loaded.deviceToken).toBe("device-1");

    const patched = saveConnectionSettings({
      mode: "local",
      apiToken: "token-2"
    });
    expect(patched.mode).toBe("local");
    expect(patched.apiToken).toBe("token-2");
    expect(getActiveConnectionSettings(patched).apiBaseUrl).toBe("http://localhost:8787");
  });

  it("emits connection changed browser event", () => {
    const mockWindow = createMockWindow();
    globalWithWindow.window = mockWindow;

    notifyConnectionSettingsChanged();
    expect(mockWindow.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = (mockWindow.dispatchEvent as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Event;
    expect(event.type).toBe(CONNECTION_SETTINGS_CHANGED_EVENT);
  });
});
