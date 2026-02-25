import { EventEmitter } from "node:events";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { PairingService } from "../../server/pairing/service.js";
import { encodeSocketFrame, tryDecodeSocketFrame } from "../../server/realtime/socketFrames.js";
import { createRealtimeRuntime } from "../../server/realtime/websocketRuntime.js";
import { createTempStore } from "../helpers/tempStore.js";

class FakeServer extends EventEmitter {
  override on(eventName: string, listener: (...args: unknown[]) => void): this {
    return super.on(eventName, listener);
  }

  override off(eventName: string, listener: (...args: unknown[]) => void): this {
    return super.off(eventName, listener);
  }
}

class FakeSocket extends EventEmitter {
  destroyed = false;
  readonly writes: Buffer[] = [];

  write(chunk: string | Buffer): boolean {
    this.writes.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    return true;
  }

  end(chunk?: Buffer): this {
    if (chunk) {
      this.write(chunk);
    }
    this.destroyed = true;
    this.emit("close");
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit("close");
    return this;
  }
}

function createUpgradeRequest(path: string, headers: Record<string, string>): IncomingMessage {
  return {
    url: path,
    headers
  } as IncomingMessage;
}

function buildWsAuthProtocolHeader(token: string): string {
  const encoded = Buffer.from(token, "utf8").toString("base64url");
  return `fyreflow.realtime.v1, fyreflow-auth.${encoded}`;
}

function maskFrameForClient(frame: Buffer): Buffer {
  const firstByte = frame[0];
  const secondByte = frame[1];
  const payloadLengthFlag = secondByte & 0x7f;
  const headerLength = payloadLengthFlag < 126 ? 2 : payloadLengthFlag === 126 ? 4 : 10;
  const payload = frame.subarray(headerLength);
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const maskedPayload = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % 4];
  }

  const secondMaskedByte = secondByte | 0x80;
  if (payloadLengthFlag < 126) {
    return Buffer.concat([Buffer.from([firstByte, secondMaskedByte]), mask, maskedPayload]);
  }

  if (payloadLengthFlag === 126) {
    const rebuilt = Buffer.concat([frame.subarray(0, 2), frame.subarray(2, 4), mask, maskedPayload]);
    rebuilt[1] = secondMaskedByte;
    return rebuilt;
  }

  const rebuilt = Buffer.concat([frame.subarray(0, 2), frame.subarray(2, 10), mask, maskedPayload]);
  rebuilt[1] = secondMaskedByte;
  return rebuilt;
}

function encodeClientJsonMessage(payload: unknown): Buffer {
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  return maskFrameForClient(encodeSocketFrame(raw, 0x1));
}

function decodeServerMessages(socket: FakeSocket): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];

  for (const chunk of socket.writes) {
    if (chunk.toString("utf8").startsWith("HTTP/1.1")) {
      continue;
    }

    const frame = tryDecodeSocketFrame(chunk);
    if (!frame) {
      continue;
    }

    if (frame.opcode !== 0x1) {
      continue;
    }

    const payload = JSON.parse(frame.payload.toString("utf8")) as Record<string, unknown>;
    messages.push(payload);
  }

  return messages;
}

describe("websocket runtime", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  });

  it("streams run updates to subscribed clients after upgrade", async () => {
    const { store, cleanup: cleanupStore } = await createTempStore();
    cleanups.push(cleanupStore);

    const runtime = createRealtimeRuntime({
      store,
      apiAuthToken: "secret-token",
      runPollIntervalMs: 30,
      heartbeatIntervalMs: 60_000
    });
    cleanups.push(() => runtime.dispose());

    const server = new FakeServer();
    runtime.attachServer(server as unknown as HttpServer);

    const pipeline = store.listPipelines()[0];
    const run = store.createRun(pipeline, "WS stream test");
    const socket = new FakeSocket();

    server.emit(
      "upgrade",
      createUpgradeRequest("/api/ws", {
        upgrade: "websocket",
        "sec-websocket-key": "test-key",
        "sec-websocket-protocol": buildWsAuthProtocolHeader("secret-token")
      }),
      socket as unknown as Socket
    );

    socket.emit(
      "data",
      encodeClientJsonMessage({
        type: "subscribe_run",
        runId: run.id,
        cursor: run.logs.length
      })
    );

    store.updateRun(run.id, (current) => ({
      ...current,
      status: "running",
      logs: [...current.logs, "Realtime update: step started"]
    }));

    await new Promise((resolve) => setTimeout(resolve, 190));

    const messages = decodeServerMessages(socket);
    expect(messages.some((payload) => payload.type === "hello")).toBe(true);
    expect(messages.some((payload) => payload.type === "subscribed" && payload.runId === run.id)).toBe(true);
    expect(
      messages.some(
        (payload) =>
          payload.type === "run_log" && payload.runId === run.id && payload.message === "Realtime update: step started"
      )
    ).toBe(true);
    expect(messages.some((payload) => payload.type === "run_status" && payload.runId === run.id && payload.status === "running")).toBe(
      true
    );
  });

  it("rejects unauthorized upgrades when api token is required", async () => {
    const { store, cleanup: cleanupStore } = await createTempStore();
    cleanups.push(cleanupStore);

    const runtime = createRealtimeRuntime({
      store,
      apiAuthToken: "secret-token"
    });
    cleanups.push(() => runtime.dispose());

    const server = new FakeServer();
    runtime.attachServer(server as unknown as HttpServer);

    const socket = new FakeSocket();
    server.emit(
      "upgrade",
      createUpgradeRequest("/api/ws", {
        upgrade: "websocket",
        "sec-websocket-key": "test-key"
      }),
      socket as unknown as Socket
    );

    const combined = Buffer.concat(socket.writes).toString("utf8");
    expect(combined).toContain("401 Unauthorized");
    expect(socket.destroyed).toBe(true);
  });

  it("accepts upgrades authenticated by additional token validator", async () => {
    const { store, cleanup: cleanupStore } = await createTempStore();
    cleanups.push(cleanupStore);

    const runtime = createRealtimeRuntime({
      store,
      apiAuthToken: "secret-token",
      isAdditionalTokenValid: (token) => token === "device-token"
    });
    cleanups.push(() => runtime.dispose());

    const server = new FakeServer();
    runtime.attachServer(server as unknown as HttpServer);

    const socket = new FakeSocket();
    server.emit(
      "upgrade",
      createUpgradeRequest("/api/ws", {
        upgrade: "websocket",
        "sec-websocket-key": "test-key",
        "sec-websocket-protocol": buildWsAuthProtocolHeader("device-token")
      }),
      socket as unknown as Socket
    );

    const combined = Buffer.concat(socket.writes).toString("utf8");
    expect(combined).toContain("101 Switching Protocols");
    expect(socket.destroyed).toBe(false);
  });

  it("never echoes auth subprotocol in handshake response", async () => {
    const { store, cleanup: cleanupStore } = await createTempStore();
    cleanups.push(cleanupStore);

    const runtime = createRealtimeRuntime({
      store,
      apiAuthToken: "secret-token"
    });
    cleanups.push(() => runtime.dispose());

    const server = new FakeServer();
    runtime.attachServer(server as unknown as HttpServer);

    const tokenOnlyProtocol = `fyreflow-auth.${Buffer.from("secret-token", "utf8").toString("base64url")}`;
    const socket = new FakeSocket();
    server.emit(
      "upgrade",
      createUpgradeRequest("/api/ws", {
        upgrade: "websocket",
        "sec-websocket-key": "test-key",
        "sec-websocket-protocol": tokenOnlyProtocol
      }),
      socket as unknown as Socket
    );

    const handshake = socket.writes[0]?.toString("utf8") ?? "";
    expect(handshake).toContain("101 Switching Protocols");
    expect(handshake).not.toContain("Sec-WebSocket-Protocol: fyreflow-auth.");
  });

  it("streams pairing status updates to subscribed clients", async () => {
    const { store, cleanup: cleanupStore } = await createTempStore();
    cleanups.push(cleanupStore);

    const pairingService = new PairingService();
    const runtime = createRealtimeRuntime({
      store,
      pairingService,
      apiAuthToken: "",
      runPollIntervalMs: 30,
      heartbeatIntervalMs: 60_000
    });
    cleanups.push(() => runtime.dispose());

    const session = pairingService.createSession({
      clientName: "Desktop App"
    });

    const server = new FakeServer();
    runtime.attachServer(server as unknown as HttpServer);

    const socket = new FakeSocket();
    server.emit(
      "upgrade",
      createUpgradeRequest("/api/ws", {
        upgrade: "websocket",
        "sec-websocket-key": "test-key"
      }),
      socket as unknown as Socket
    );

    socket.emit(
      "data",
      encodeClientJsonMessage({
        type: "subscribe_pairing",
        sessionId: session.id
      })
    );

    pairingService.approveSession(session.id, session.code, "Office Mac");

    await new Promise((resolve) => setTimeout(resolve, 190));

    const messages = decodeServerMessages(socket);
    expect(messages.some((payload) => payload.type === "hello")).toBe(true);
    expect(messages.some((payload) => payload.type === "pairing_subscribed" && payload.sessionId === session.id)).toBe(true);
    expect(
      messages.some((payload) => {
        if (payload.type !== "pairing_status") {
          return false;
        }
        const sessionPayload = payload.session as { status?: string };
        return sessionPayload?.status === "approved";
      })
    ).toBe(true);
  });
});
