import { afterEach, describe, expect, it } from "vitest";

import { loadUpdateSettings, saveUpdateSettings } from "../../src/lib/updateSettingsStorage";

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
    }
  } as unknown as Window;
}

afterEach(() => {
  if (typeof originalWindow === "undefined") {
    delete globalWithWindow.window;
  } else {
    globalWithWindow.window = originalWindow;
  }
});

describe("updateSettingsStorage", () => {
  it("returns defaults when storage is empty", () => {
    globalWithWindow.window = createMockWindow();

    const settings = loadUpdateSettings();
    expect(settings).toEqual({
      updaterBaseUrl: "http://localhost:8788",
      updaterAuthToken: ""
    });
  });

  it("normalizes and persists settings", () => {
    globalWithWindow.window = createMockWindow();

    const saved = saveUpdateSettings({
      updaterBaseUrl: " https://updates.example.com/ ",
      updaterAuthToken: " token-1 "
    });

    expect(saved).toEqual({
      updaterBaseUrl: "https://updates.example.com",
      updaterAuthToken: "token-1"
    });

    const loaded = loadUpdateSettings();
    expect(loaded).toEqual(saved);
  });

  it("falls back to defaults when URL is invalid", () => {
    globalWithWindow.window = createMockWindow();

    saveUpdateSettings({
      updaterBaseUrl: "not-a-url",
      updaterAuthToken: "abc"
    });

    const loaded = loadUpdateSettings();
    expect(loaded.updaterBaseUrl).toBe("http://localhost:8788");
    expect(loaded.updaterAuthToken).toBe("abc");
  });
});
