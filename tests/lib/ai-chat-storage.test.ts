import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAiChatPendingRequest,
  loadAiChatHistory,
  loadAiChatHistoryPage,
  loadAiChatPendingRequest,
  moveAiChatHistory,
  saveAiChatHistory,
  saveAiChatPendingRequest
} from "../../src/lib/aiChatStorage";
import type { AiChatMessage, FlowBuilderRequest } from "../../src/lib/types";

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

function createMessage(index: number): AiChatMessage {
  return {
    id: `msg-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
    timestamp: index
  };
}

describe("aiChatStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns paginated history slices from newest to oldest", () => {
    const history = Array.from({ length: 8 }, (_, index) => createMessage(index));
    saveAiChatHistory("wf-1", history);

    const latestPage = loadAiChatHistoryPage("wf-1", { limit: 3 });
    expect(latestPage.total).toBe(8);
    expect(latestPage.hasMore).toBe(true);
    expect(latestPage.messages.map((entry) => entry.id)).toEqual(["msg-5", "msg-6", "msg-7"]);

    const middlePage = loadAiChatHistoryPage("wf-1", { offset: 3, limit: 3 });
    expect(middlePage.hasMore).toBe(true);
    expect(middlePage.messages.map((entry) => entry.id)).toEqual(["msg-2", "msg-3", "msg-4"]);

    const oldestPage = loadAiChatHistoryPage("wf-1", { offset: 6, limit: 3 });
    expect(oldestPage.hasMore).toBe(false);
    expect(oldestPage.messages.map((entry) => entry.id)).toEqual(["msg-0", "msg-1"]);
  });

  it("clamps invalid paging arguments", () => {
    saveAiChatHistory("wf-2", [createMessage(0), createMessage(1), createMessage(2)]);

    const emptyPage = loadAiChatHistoryPage("wf-2", { offset: 999, limit: 5 });
    expect(emptyPage.messages).toHaveLength(0);
    expect(emptyPage.hasMore).toBe(false);

    const minimumLimitPage = loadAiChatHistoryPage("wf-2", { offset: -10, limit: 0 });
    expect(minimumLimitPage.messages).toHaveLength(1);
    expect(minimumLimitPage.messages[0]?.id).toBe("msg-2");
  });

  it("moves history between workflows while preserving message order", () => {
    saveAiChatHistory("wf-source", [createMessage(10), createMessage(11)]);
    saveAiChatHistory("wf-target", [createMessage(20)]);

    moveAiChatHistory("wf-source", "wf-target");

    const targetHistory = loadAiChatHistory("wf-target");
    expect(targetHistory.map((entry) => entry.id)).toEqual(["msg-20", "msg-10", "msg-11"]);
    expect(loadAiChatHistory("wf-source")).toEqual([]);
  });

  it("persists and restores pending flow-builder request payload", () => {
    const pendingPayload: FlowBuilderRequest = {
      requestId: "req-1",
      prompt: "Generate a flow",
      providerId: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "high",
      history: [{ role: "user", content: "Generate a flow" }]
    };

    saveAiChatPendingRequest("wf-pending", {
      requestId: "req-1",
      payload: pendingPayload,
      startedAt: 123456,
      mode: "build"
    });

    const restored = loadAiChatPendingRequest("wf-pending");
    expect(restored).not.toBeNull();
    expect(restored?.requestId).toBe("req-1");
    expect(restored?.payload.requestId).toBe("req-1");
    expect(restored?.payload.prompt).toBe("Generate a flow");
    expect(restored?.startedAt).toBe(123456);
    expect(restored?.mode).toBe("build");

    clearAiChatPendingRequest("wf-pending");
    expect(loadAiChatPendingRequest("wf-pending")).toBeNull();
  });

  it("restores request ids on chat history entries", () => {
    saveAiChatHistory("wf-req", [
      {
        id: "assistant-1",
        requestId: "req-history-1",
        role: "assistant",
        content: "Generated",
        timestamp: 1
      }
    ]);

    const restored = loadAiChatHistory("wf-req");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.requestId).toBe("req-history-1");
  });

  it("ignores malformed pending flow-builder requests", () => {
    window.localStorage.setItem(
      "fyreflow:ai-chat-pending-request:wf-invalid",
      JSON.stringify({
        requestId: "req-invalid",
        payload: {
          requestId: "req-invalid",
          prompt: "",
          providerId: "claude",
          model: "claude-sonnet-4-6"
        }
      })
    );

    expect(loadAiChatPendingRequest("wf-invalid")).toBeNull();
  });
});
