import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyUpdaterUpdate,
  approvePairingSession,
  cancelPairingSession,
  checkUpdaterStatus,
  claimPairingSession,
  createPairingSession,
  generateFlowDraft,
  getPairingSession,
  getUpdaterStatus,
  rollbackUpdaterUpdate,
  subscribePairingSessionStatus,
  subscribeRunEvents
} from "../../src/lib/api";
import { setConnectionSettings } from "../../src/lib/connectionSettingsStorage";
import type {
  FlowBuilderRequest,
  FlowBuilderResponse,
  PairingSessionCreated,
  PairingSessionSummary,
  UpdateServiceStatus
} from "../../src/lib/types";

const originalFetch = global.fetch;
const originalWebSocket = globalThis.WebSocket;
const globalWithWindow = globalThis as typeof globalThis & { window?: Window };
const originalWindow = globalWithWindow.window;

const flowBuilderRequest: FlowBuilderRequest = {
  prompt: "Draft a simple QA workflow.",
  providerId: "claude",
  model: "claude-sonnet-4-6"
};

function buildPairingSummary(status: PairingSessionSummary["status"]): PairingSessionSummary {
  return {
    id: "pair-session-1",
    status,
    clientName: "FyreFlow Desktop",
    platform: "macos",
    label: status === "approved" ? "Workstation" : "",
    createdAt: "2026-02-24T10:00:00.000Z",
    updatedAt: "2026-02-24T10:00:05.000Z",
    expiresAt: "2026-02-24T10:10:00.000Z"
  };
}

afterEach(() => {
  global.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  if (typeof originalWindow === "undefined") {
    delete globalWithWindow.window;
  } else {
    globalWithWindow.window = originalWindow;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sentMessages: string[] = [];
  readyState = 0;
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  emitOpen(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  emitMessage(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.emit("message", {
      data
    });
  }

  emitError(): void {
    this.emit("error", {});
  }

  emitClose(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  private emit(type: string, event: unknown): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }
}

describe("generateFlowDraft", () => {
  it("retries once when the first attempt fails with a network error", async () => {
    const responsePayload: FlowBuilderResponse = {
      action: "answer",
      message: "Draft ready",
      source: "model",
      notes: []
    };

    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      ) as typeof fetch;

    await expect(generateFlowDraft(flowBuilderRequest)).resolves.toEqual(responsePayload);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the server responds with an HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    await expect(generateFlowDraft(flowBuilderRequest)).rejects.toThrow("Service unavailable");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails with timeout when flow builder request exceeds deadline", async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn().mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("Missing abort signal"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("Aborted"));
          },
          { once: true }
        );
      });
    }) as typeof fetch;

    const requestPromise = generateFlowDraft(flowBuilderRequest);
    void requestPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(480_000);

    await expect(requestPromise).rejects.toThrow(
      "Network timeout (POST /api/flow-builder/generate): Request timed out after 480000ms"
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("updater API client", () => {
  const statusPayload: UpdateServiceStatus = {
    channel: "stable",
    currentTag: "1.0.0",
    currentVersion: "1.0.0",
    latestTag: "1.0.1",
    updateAvailable: true,
    rollbackAvailable: true,
    busy: false
  };

  it("uses custom updater URL and token for status check", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: statusPayload }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    const response = await getUpdaterStatus({
      baseUrl: "https://updates.example.com",
      authToken: "updater-token"
    });

    expect(response.status.latestTag).toBe("1.0.1");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [requestUrl, requestInit] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit
    ];
    expect(requestUrl).toBe("https://updates.example.com/api/updates/status");
    const headers = requestInit.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer updater-token");
  });

  it("sends POST requests for check/apply/rollback", async () => {
    global.fetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ status: statusPayload }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    await checkUpdaterStatus({ baseUrl: "http://localhost:8788" });
    await applyUpdaterUpdate({ baseUrl: "http://localhost:8788" }, "1.0.1");
    await rollbackUpdaterUpdate({ baseUrl: "http://localhost:8788" });

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(3);
    expect(calls[0]?.[0]).toBe("http://localhost:8788/api/updates/check");
    expect(calls[0]?.[1].method).toBe("POST");
    expect(calls[1]?.[0]).toBe("http://localhost:8788/api/updates/apply");
    expect(calls[1]?.[1].method).toBe("POST");
    expect(calls[2]?.[0]).toBe("http://localhost:8788/api/updates/rollback");
    expect(calls[2]?.[1].method).toBe("POST");
  });
});

describe("subscribeRunEvents", () => {
  it("preserves api base pathname when building realtime websocket url", () => {
    globalWithWindow.window = createMockWindow();
    setConnectionSettings({
      mode: "remote",
      localApiBaseUrl: "http://localhost:8787",
      remoteApiBaseUrl: "https://remote.example.com/fyreflow",
      apiToken: "",
      realtimePath: "/api/ws",
      deviceToken: ""
    });
    global.fetch = vi.fn() as typeof fetch;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const unsubscribe = subscribeRunEvents("run-1", {
      onEvent: vi.fn()
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(socket.url).toBe("wss://remote.example.com/fyreflow/api/ws");

    unsubscribe();
  });

  it("uses websocket transport and maps messages to legacy stream events", () => {
    global.fetch = vi.fn() as typeof fetch;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const onOpen = vi.fn();
    const onError = vi.fn();
    const onEvent = vi.fn();

    const unsubscribe = subscribeRunEvents("run-1", {
      cursor: 0,
      onOpen,
      onError,
      onEvent
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket.emitOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);

    const subscribeMessage = JSON.parse(socket.sentMessages[0] ?? "{}") as {
      type?: string;
      runId?: string;
      cursor?: number;
    };
    expect(subscribeMessage).toEqual({
      type: "subscribe_run",
      runId: "run-1",
      cursor: 0
    });

    socket.emitMessage({ type: "subscribed", runId: "run-1", cursor: 0, status: "running" });
    socket.emitMessage({ type: "run_log", runId: "run-1", cursor: 1, message: "Hello", status: "running" });
    socket.emitMessage({ type: "run_status", runId: "run-1", status: "completed" });

    const events = onEvent.mock.calls.map(([entry]) => entry.event as string);
    expect(events).toContain("ready");
    expect(events).toContain("log");
    expect(events).toContain("status");
    expect(events).toContain("complete");
    expect(onError).not.toHaveBeenCalled();

    const logEvent = onEvent.mock.calls.find(([entry]) => entry.event === "log")?.[0] as {
      data: { logIndex: number; message: string };
    };
    expect(logEvent.data.logIndex).toBe(0);
    expect(logEvent.data.message).toBe("Hello");

    unsubscribe();
    expect(socket.readyState).toBe(3);
  });

  it("falls back to SSE when websocket is unavailable", async () => {
    globalThis.WebSocket = undefined as unknown as typeof WebSocket;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: ready\ndata: {"runId":"run-1","cursor":2,"status":"running"}\n\n'));
        controller.enqueue(encoder.encode('event: log\ndata: {"runId":"run-1","logIndex":2,"message":"from-sse","status":"running"}\n\n'));
        controller.enqueue(encoder.encode('event: complete\ndata: {"runId":"run-1","status":"completed"}\n\n'));
        controller.close();
      }
    });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as typeof fetch;

    const onOpen = vi.fn();
    const onEvent = vi.fn();
    const onError = vi.fn();

    subscribeRunEvents("run-1", {
      cursor: 2,
      onOpen,
      onEvent,
      onError
    });

    await vi.waitFor(() => {
      expect(onEvent.mock.calls.some(([entry]) => entry.event === "complete")).toBe(true);
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [fetchUrl] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(fetchUrl).toContain("/api/runs/run-1/events?cursor=2");
  });

  it("falls back to SSE when websocket closes before opening", async () => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: log\ndata: {"runId":"run-1","logIndex":5,"message":"fallback-log","status":"running"}\n\n'));
        controller.close();
      }
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as typeof fetch;

    const onEvent = vi.fn();
    subscribeRunEvents("run-1", {
      cursor: 5,
      onEvent
    });

    const socket = FakeWebSocket.instances[0];
    socket.emitClose();

    await vi.waitFor(() => {
      expect(onEvent.mock.calls.some(([entry]) => entry.event === "log")).toBe(true);
    });

    const [fetchUrl] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(fetchUrl).toContain("/api/runs/run-1/events?cursor=5");
  });

  it("closes websocket when abort signal fires", () => {
    global.fetch = vi.fn() as typeof fetch;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const onError = vi.fn();
    const controller = new AbortController();

    subscribeRunEvents("run-1", {
      signal: controller.signal,
      onEvent: vi.fn(),
      onError
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket.emitOpen();

    controller.abort("component-unmount");

    expect(socket.readyState).toBe(3);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("pairing API helpers", () => {
  it("uses active remote connection settings for request base url and auth token", async () => {
    globalWithWindow.window = createMockWindow();
    setConnectionSettings({
      mode: "remote",
      localApiBaseUrl: "http://localhost:8787",
      remoteApiBaseUrl: "https://remote.example.com",
      apiToken: "remote-token",
      realtimePath: "/api/ws",
      deviceToken: ""
    });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session: {
            ...buildPairingSummary("pending"),
            code: "123456",
            realtimePath: "/api/ws"
          }
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" }
        }
      )
    ) as typeof fetch;

    await createPairingSession();

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe("https://remote.example.com/api/pairing/sessions");
    expect((requestInit.headers as Headers).get("authorization")).toBe("Bearer remote-token");
  });

  it("performs create/get/approve/claim/cancel requests", async () => {
    const createdSession: PairingSessionCreated = {
      ...buildPairingSummary("pending"),
      code: "123456",
      realtimePath: "/api/ws"
    };

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: createdSession }), {
          status: 201,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: { ...buildPairingSummary("pending"), realtimePath: "/api/ws" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: buildPairingSummary("approved") }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session: { ...buildPairingSummary("claimed"), claimedAt: "2026-02-24T10:00:10.000Z" },
            deviceToken: "token-123"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: buildPairingSummary("cancelled") }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      ) as typeof fetch;

    await expect(createPairingSession({ clientName: "Desktop", platform: "macos" })).resolves.toEqual({
      session: createdSession
    });
    await expect(getPairingSession("pair-session-1")).resolves.toMatchObject({
      session: {
        id: "pair-session-1",
        realtimePath: "/api/ws"
      }
    });
    await expect(approvePairingSession("pair-session-1", "123456", "Workstation")).resolves.toEqual({
      session: buildPairingSummary("approved")
    });
    await expect(claimPairingSession("pair-session-1", "123456")).resolves.toEqual({
      session: { ...buildPairingSummary("claimed"), claimedAt: "2026-02-24T10:00:10.000Z" },
      deviceToken: "token-123"
    });
    await expect(cancelPairingSession("pair-session-1")).resolves.toEqual({
      session: buildPairingSummary("cancelled")
    });

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(5);
    expect(calls[0]?.[0]).toContain("/api/pairing/sessions");
    expect(calls[1]?.[0]).toContain("/api/pairing/sessions/pair-session-1");
    expect(calls[2]?.[0]).toContain("/api/pairing/sessions/pair-session-1/approve");
    expect(calls[3]?.[0]).toContain("/api/pairing/sessions/pair-session-1/claim");
    expect(calls[4]?.[0]).toContain("/api/pairing/sessions/pair-session-1/cancel");
  });
});

describe("subscribePairingSessionStatus", () => {
  it("subscribes over websocket and emits pairing status events", () => {
    global.fetch = vi.fn() as typeof fetch;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const onOpen = vi.fn();
    const onError = vi.fn();
    const onEvent = vi.fn();

    const unsubscribe = subscribePairingSessionStatus("pair-session-1", {
      onOpen,
      onError,
      onEvent
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket.emitOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);

    const subscribeMessage = JSON.parse(socket.sentMessages[0] ?? "{}") as {
      type?: string;
      sessionId?: string;
    };
    expect(subscribeMessage).toEqual({
      type: "subscribe_pairing",
      sessionId: "pair-session-1"
    });

    socket.emitMessage({
      type: "pairing_subscribed",
      sessionId: "pair-session-1"
    });
    socket.emitMessage({
      type: "pairing_status",
      session: buildPairingSummary("approved")
    });

    const events = onEvent.mock.calls.map(([entry]) => entry.event as string);
    expect(events).toContain("subscribed");
    expect(events).toContain("status");
    expect(onError).not.toHaveBeenCalled();

    unsubscribe();
    expect(socket.readyState).toBe(3);
  });

  it("closes websocket when abort signal fires", () => {
    global.fetch = vi.fn() as typeof fetch;
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const onError = vi.fn();
    const controller = new AbortController();

    subscribePairingSessionStatus("pair-session-1", {
      signal: controller.signal,
      onEvent: vi.fn(),
      onError
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket.emitOpen();

    controller.abort("component-unmount");

    expect(socket.readyState).toBe(3);
    expect(onError).not.toHaveBeenCalled();
  });
});
