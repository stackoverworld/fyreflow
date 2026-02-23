import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readPersistedJsonState,
  writePersistedJsonState
} from "../../src/components/dashboard/usePersistedJsonState";

interface MockStorageOptions {
  throwOnSet?: boolean;
}

function createLocalStorageMock(options: MockStorageOptions = {}): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      if (options.throwOnSet) {
        throw new Error("storage quota");
      }
      store.set(key, String(value));
    }
  };
}

describe("usePersistedJsonState storage helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns default when localStorage is unavailable", () => {
    const defaultValue = { enabled: false };
    const value = readPersistedJsonState("fyreflow:test-missing-storage", defaultValue);
    expect(value).toEqual(defaultValue);
  });

  it("reads parsed json when stored value is valid", () => {
    const storage = createLocalStorageMock();
    storage.setItem("fyreflow:test", JSON.stringify({ collapsed: true }));
    vi.stubGlobal("localStorage", storage);

    const value = readPersistedJsonState(
      "fyreflow:test",
      { collapsed: false },
      (entry): entry is { collapsed: boolean } =>
        !!entry && typeof entry === "object" && typeof (entry as { collapsed?: unknown }).collapsed === "boolean"
    );

    expect(value).toEqual({ collapsed: true });
  });

  it("falls back to default when stored json is invalid", () => {
    const storage = createLocalStorageMock();
    storage.setItem("fyreflow:test-invalid", "{not-json");
    vi.stubGlobal("localStorage", storage);

    const value = readPersistedJsonState("fyreflow:test-invalid", { collapsed: false });
    expect(value).toEqual({ collapsed: false });
  });

  it("falls back to default when validator rejects parsed value", () => {
    const storage = createLocalStorageMock();
    storage.setItem("fyreflow:test-validator", JSON.stringify({ collapsed: "nope" }));
    vi.stubGlobal("localStorage", storage);

    const value = readPersistedJsonState(
      "fyreflow:test-validator",
      { collapsed: false },
      (entry): entry is { collapsed: boolean } =>
        !!entry && typeof entry === "object" && typeof (entry as { collapsed?: unknown }).collapsed === "boolean"
    );

    expect(value).toEqual({ collapsed: false });
  });

  it("writes serialized json into localStorage", () => {
    const storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);

    writePersistedJsonState("fyreflow:test-write", { expanded: ["trace", "step"] });

    expect(storage.getItem("fyreflow:test-write")).toBe("{\"expanded\":[\"trace\",\"step\"]}");
  });

  it("ignores storage write errors", () => {
    const storage = createLocalStorageMock({ throwOnSet: true });
    vi.stubGlobal("localStorage", storage);

    expect(() => {
      writePersistedJsonState("fyreflow:test-write-error", { value: true });
    }).not.toThrow();
  });
});
