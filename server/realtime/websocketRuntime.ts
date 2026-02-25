import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";

import type { PairingService } from "../pairing/service.js";
import type { LocalStore } from "../storage.js";
import { encodeSocketFrame, tryDecodeSocketFrame } from "./socketFrames.js";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_WS_PATH = "/api/ws";
const DEFAULT_RUN_POLL_INTERVAL_MS = 400;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

interface ClientRunSubscription {
  cursor: number;
  lastStatus: string | null;
}

interface ClientPairingSubscription {
  lastSignature: string | null;
}

interface RealtimeClientState {
  id: string;
  socket: Socket;
  buffer: Buffer;
  subscriptions: Map<string, ClientRunSubscription>;
  pairingSubscriptions: Map<string, ClientPairingSubscription>;
}

export interface RealtimeRuntimeOptions {
  store: LocalStore;
  pairingService?: PairingService;
  apiAuthToken: string;
  isAdditionalTokenValid?: (token: string) => boolean;
  path?: string;
  runPollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export interface RealtimeRuntime {
  attachServer: (server: HttpServer) => void;
  dispose: () => void;
  getClientCount: () => number;
}

function makeWebSocketAcceptKey(key: string): string {
  return createHash("sha1").update(`${key}${WS_MAGIC_GUID}`).digest("base64");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function extractBearerToken(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const match = trimmed.match(/^bearer\s+(.+)$/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  return trimmed;
}

function isAuthorizedRequest(
  request: IncomingMessage,
  apiAuthToken: string,
  url: URL,
  isAdditionalTokenValid?: (token: string) => boolean
): boolean {
  const expected = apiAuthToken.trim();
  if (expected.length === 0) {
    return true;
  }

  const authorizationHeader =
    typeof request.headers.authorization === "string" ? request.headers.authorization : undefined;
  const xApiTokenHeader =
    typeof request.headers["x-api-token"] === "string" ? request.headers["x-api-token"] : undefined;
  const queryToken = url.searchParams.get("api_token")?.trim() ?? "";
  const bearer = extractBearerToken(authorizationHeader);
  const candidate = bearer || (xApiTokenHeader?.trim() ?? "") || queryToken;

  if (candidate.length === 0) {
    return false;
  }

  if (constantTimeEquals(candidate, expected)) {
    return true;
  }

  return typeof isAdditionalTokenValid === "function" && isAdditionalTokenValid(candidate);
}

function writeUpgradeError(socket: Socket, statusCode: number, message: string): void {
  if (socket.destroyed) {
    return;
  }

  const body = `${message}\n`;
  const response = [
    `HTTP/1.1 ${statusCode} ${message}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body
  ].join("\r\n");
  socket.write(response);
  socket.destroy();
}

function sendJson(socket: Socket, payload: unknown): void {
  if (socket.destroyed) {
    return;
  }

  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  socket.write(encodeSocketFrame(raw, 0x1));
}

function sendPong(socket: Socket, payload: Buffer): void {
  if (socket.destroyed) {
    return;
  }

  socket.write(encodeSocketFrame(payload, 0x0a));
}

function sendClose(socket: Socket): void {
  if (socket.destroyed) {
    return;
  }

  socket.end(encodeSocketFrame(Buffer.alloc(0), 0x08));
}

function normalizeCursor(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return fallback;
}

function createClientId(nextId: number): string {
  return `client-${nextId.toString(36)}`;
}

export function createRealtimeRuntime(options: RealtimeRuntimeOptions): RealtimeRuntime {
  const path = options.path ?? DEFAULT_WS_PATH;
  const runPollIntervalMs = Math.max(100, options.runPollIntervalMs ?? DEFAULT_RUN_POLL_INTERVAL_MS);
  const heartbeatIntervalMs = Math.max(1000, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);

  let serverRef: HttpServer | null = null;
  let nextClientNumericId = 1;
  const clients = new Map<Socket, RealtimeClientState>();

  function removeClient(state: RealtimeClientState): void {
    clients.delete(state.socket);
    if (!state.socket.destroyed) {
      state.socket.destroy();
    }
  }

  function pushRunUpdates(state: RealtimeClientState): void {
    for (const [runId, subscription] of state.subscriptions) {
      const run = options.store.getRun(runId);
      if (!run) {
        sendJson(state.socket, {
          type: "run_not_found",
          runId
        });
        state.subscriptions.delete(runId);
        continue;
      }

      const startCursor = Math.min(subscription.cursor, run.logs.length);
      for (let index = startCursor; index < run.logs.length; index += 1) {
        sendJson(state.socket, {
          type: "run_log",
          runId,
          cursor: index + 1,
          message: run.logs[index],
          status: run.status
        });
      }
      subscription.cursor = run.logs.length;

      if (subscription.lastStatus !== run.status) {
        subscription.lastStatus = run.status;
        sendJson(state.socket, {
          type: "run_status",
          runId,
          status: run.status
        });
      }
    }
  }

  function pushPairingUpdates(state: RealtimeClientState): void {
    const pairingService = options.pairingService;
    if (!pairingService) {
      return;
    }

    for (const [sessionId, subscription] of state.pairingSubscriptions.entries()) {
      const session = pairingService.getSession(sessionId);
      if (!session) {
        sendJson(state.socket, {
          type: "pairing_not_found",
          sessionId
        });
        state.pairingSubscriptions.delete(sessionId);
        continue;
      }

      const signature = [
        session.status,
        session.updatedAt,
        session.expiresAt,
        session.approvedAt ?? "",
        session.claimedAt ?? "",
        session.label
      ].join("|");

      if (subscription.lastSignature === signature) {
        continue;
      }

      subscription.lastSignature = signature;
      sendJson(state.socket, {
        type: "pairing_status",
        session
      });
    }
  }

  function handleClientMessage(state: RealtimeClientState, raw: Buffer): void {
    try {
      const message = JSON.parse(raw.toString("utf8")) as {
        type?: string;
        runId?: string;
        sessionId?: string;
        cursor?: number;
      };

      if (message.type === "ping") {
        sendJson(state.socket, {
          type: "pong",
          now: new Date().toISOString()
        });
        return;
      }

      if (message.type === "subscribe_run") {
        const runId = typeof message.runId === "string" ? message.runId.trim() : "";
        if (runId.length === 0) {
          sendJson(state.socket, {
            type: "error",
            code: "invalid_request",
            message: "runId is required for subscribe_run."
          });
          return;
        }

        const run = options.store.getRun(runId);
        if (!run) {
          sendJson(state.socket, {
            type: "run_not_found",
            runId
          });
          return;
        }

        const cursor = Math.min(normalizeCursor(message.cursor, 0), run.logs.length);
        state.subscriptions.set(runId, {
          cursor,
          lastStatus: null
        });
        sendJson(state.socket, {
          type: "subscribed",
          runId,
          cursor,
          status: run.status
        });
        pushRunUpdates(state);
        return;
      }

      if (message.type === "unsubscribe_run") {
        const runId = typeof message.runId === "string" ? message.runId.trim() : "";
        if (runId.length === 0) {
          return;
        }

        if (state.subscriptions.delete(runId)) {
          sendJson(state.socket, {
            type: "unsubscribed",
            runId
          });
        }
        return;
      }

      if (message.type === "subscribe_pairing") {
        const sessionId = typeof message.sessionId === "string" ? message.sessionId.trim() : "";
        if (sessionId.length === 0) {
          sendJson(state.socket, {
            type: "error",
            code: "invalid_request",
            message: "sessionId is required for subscribe_pairing."
          });
          return;
        }

        if (!options.pairingService) {
          sendJson(state.socket, {
            type: "error",
            code: "pairing_unavailable",
            message: "Pairing service is unavailable."
          });
          return;
        }

        const session = options.pairingService.getSession(sessionId);
        if (!session) {
          sendJson(state.socket, {
            type: "pairing_not_found",
            sessionId
          });
          return;
        }

        state.pairingSubscriptions.set(sessionId, {
          lastSignature: null
        });
        sendJson(state.socket, {
          type: "pairing_subscribed",
          sessionId
        });
        pushPairingUpdates(state);
        return;
      }

      if (message.type === "unsubscribe_pairing") {
        const sessionId = typeof message.sessionId === "string" ? message.sessionId.trim() : "";
        if (sessionId.length === 0) {
          return;
        }

        if (state.pairingSubscriptions.delete(sessionId)) {
          sendJson(state.socket, {
            type: "pairing_unsubscribed",
            sessionId
          });
        }
        return;
      }

      sendJson(state.socket, {
        type: "error",
        code: "unsupported_message_type",
        message: "Unsupported message type."
      });
    } catch {
      sendJson(state.socket, {
        type: "error",
        code: "invalid_json",
        message: "Invalid JSON payload."
      });
    }
  }

  function handleSocketData(state: RealtimeClientState, chunk: Buffer): void {
    state.buffer = Buffer.concat([state.buffer, chunk]);

    while (state.buffer.length > 0) {
      let frame;
      try {
        frame = tryDecodeSocketFrame(state.buffer);
      } catch (error) {
        sendJson(state.socket, {
          type: "error",
          code: "invalid_frame",
          message: error instanceof Error ? error.message : "Invalid websocket frame."
        });
        sendClose(state.socket);
        removeClient(state);
        return;
      }

      if (!frame) {
        return;
      }

      state.buffer = state.buffer.subarray(frame.byteLength);

      if (!frame.fin) {
        sendJson(state.socket, {
          type: "error",
          code: "fragmented_frames_not_supported",
          message: "Fragmented frames are not supported."
        });
        continue;
      }

      if (frame.opcode === 0x8) {
        removeClient(state);
        return;
      }

      if (frame.opcode === 0x9) {
        sendPong(state.socket, frame.payload);
        continue;
      }

      if (frame.opcode === 0x1) {
        handleClientMessage(state, frame.payload);
      }
    }
  }

  function handleUpgrade(request: IncomingMessage, socket: Socket): void {
    const requestUrl = request.url ?? "/";
    const url = new URL(requestUrl, "http://localhost");

    if (url.pathname !== path) {
      writeUpgradeError(socket, 404, "Not Found");
      return;
    }

    if (!isAuthorizedRequest(request, options.apiAuthToken, url, options.isAdditionalTokenValid)) {
      writeUpgradeError(socket, 401, "Unauthorized");
      return;
    }

    const upgradeHeader = typeof request.headers.upgrade === "string" ? request.headers.upgrade.toLowerCase() : "";
    if (upgradeHeader !== "websocket") {
      writeUpgradeError(socket, 400, "Bad Request");
      return;
    }

    const key = typeof request.headers["sec-websocket-key"] === "string" ? request.headers["sec-websocket-key"] : "";
    if (key.trim().length === 0) {
      writeUpgradeError(socket, 400, "Bad Request");
      return;
    }

    const accept = makeWebSocketAcceptKey(key.trim());
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n");
    socket.write(responseHeaders);

    const state: RealtimeClientState = {
      id: createClientId(nextClientNumericId),
      socket,
      buffer: Buffer.alloc(0),
      subscriptions: new Map<string, ClientRunSubscription>(),
      pairingSubscriptions: new Map<string, ClientPairingSubscription>()
    };
    nextClientNumericId += 1;
    clients.set(socket, state);

    sendJson(socket, {
      type: "hello",
      protocol: "fyreflow.realtime.v1",
      clientId: state.id,
      now: new Date().toISOString()
    });

    socket.on("data", (chunk: Buffer) => {
      handleSocketData(state, chunk);
    });
    socket.on("error", () => {
      removeClient(state);
    });
    socket.on("close", () => {
      clients.delete(socket);
    });
  }

  const runPollHandle = setInterval(() => {
    for (const state of clients.values()) {
      pushRunUpdates(state);
      pushPairingUpdates(state);
    }
  }, runPollIntervalMs);
  if (typeof runPollHandle.unref === "function") {
    runPollHandle.unref();
  }

  const heartbeatHandle = setInterval(() => {
    const now = new Date().toISOString();
    for (const state of clients.values()) {
      sendJson(state.socket, {
        type: "heartbeat",
        now
      });
    }
  }, heartbeatIntervalMs);
  if (typeof heartbeatHandle.unref === "function") {
    heartbeatHandle.unref();
  }

  return {
    attachServer(server: HttpServer) {
      if (serverRef) {
        if (serverRef === server) {
          return;
        }
        throw new Error("Realtime runtime already attached to a different server.");
      }

      serverRef = server;
      server.on("upgrade", handleUpgrade);
    },
    dispose() {
      clearInterval(runPollHandle);
      clearInterval(heartbeatHandle);

      if (serverRef) {
        serverRef.off("upgrade", handleUpgrade);
        serverRef = null;
      }

      for (const state of clients.values()) {
        if (!state.socket.destroyed) {
          state.socket.destroy();
        }
      }
      clients.clear();
    },
    getClientCount() {
      return clients.size;
    }
  };
}
