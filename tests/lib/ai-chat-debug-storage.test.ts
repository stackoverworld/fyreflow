import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAiChatDebugEvent,
  clearAiChatDebugEvents,
  formatAiChatDebugEvent,
  loadAiChatDebugEvents,
  subscribeAiChatDebug,
  type AiChatDebugEvent
} from "../../src/lib/aiChatDebugStorage";

function createLocalStorageMock(): Storage {
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
      store.set(key, String(value));
    }
  };
}

describe("aiChatDebugStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends and loads debug events for a workflow", () => {
    appendAiChatDebugEvent("wf-1", {
      level: "info",
      event: "request_start",
      message: "Started",
      meta: {
        providerId: "claude",
        model: "claude-sonnet-4-6"
      }
    });

    const events = loadAiChatDebugEvents("wf-1");
    expect(events.length).toBe(1);
    expect(events[0]?.event).toBe("request_start");
    expect(events[0]?.message).toBe("Started");
    expect(events[0]?.meta?.providerId).toBe("claude");
  });

  it("notifies subscribers on new events and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiChatDebug("wf-2", listener);

    appendAiChatDebugEvent("wf-2", {
      level: "info",
      event: "request_start",
      message: "Started"
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    appendAiChatDebugEvent("wf-2", {
      level: "error",
      event: "request_error",
      message: "Failed"
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("formats debug events with level, event, message and details", () => {
    const event: AiChatDebugEvent = {
      id: "evt-1",
      timestamp: new Date("2026-02-22T03:29:58.000Z").getTime(),
      level: "error",
      event: "request_error",
      message: "AI Builder chat request failed",
      meta: {
        requestId: "req-1",
        model: "claude-sonnet-4-6"
      },
      details: "Network error (POST /api/flow-builder/generate): Failed to fetch"
    };

    const formatted = formatAiChatDebugEvent(event);
    expect(formatted).toContain("ERROR request_error");
    expect(formatted).toContain("AI Builder chat request failed");
    expect(formatted).toContain("requestId=req-1");
    expect(formatted).toContain("details:");
  });

  it("clears debug events for workflow", () => {
    appendAiChatDebugEvent("wf-3", {
      level: "info",
      event: "request_start",
      message: "Started"
    });
    expect(loadAiChatDebugEvents("wf-3").length).toBe(1);

    clearAiChatDebugEvents("wf-3");
    expect(loadAiChatDebugEvents("wf-3").length).toBe(0);
  });
});
