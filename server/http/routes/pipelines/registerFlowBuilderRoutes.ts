import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { sendZodError } from "./helpers.js";
import { flowBuilderRequestSchema } from "./schemas.js";
import {
  createFlowBuilderRequestRegistry,
  FlowBuilderRequestConflictError,
  stripFlowBuilderRequestId
} from "./flowBuilderRequestRegistry.js";
import { MessageFieldTracker } from "../../../flowBuilder/messageFieldTracker.js";

const flowBuilderRequestRegistry = createFlowBuilderRequestRegistry();
const FLOW_BUILDER_STREAM_MAX_DURATION_MS = (() => {
  const raw = Number.parseInt(process.env.FLOW_BUILDER_STREAM_MAX_DURATION_MS ?? "120000", 10);
  if (!Number.isFinite(raw)) {
    return 120_000;
  }
  return Math.max(30_000, Math.min(600_000, raw));
})();

function writeSseEvent(response: Response, event: string, data: unknown): boolean {
  const ok = response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const res = response as unknown as { flush?: () => void };
  if (typeof res.flush === "function") {
    res.flush();
  }
  return ok;
}

export function registerFlowBuilderRoutes(app: Express, deps: PipelineRouteContext): void {
  app.post("/api/flow-builder/generate", async (request: Request, response: Response) => {
    try {
      const input = flowBuilderRequestSchema.parse(request.body);
      const payload = stripFlowBuilderRequestId(input);
      const result =
        typeof input.requestId === "string" && input.requestId.trim().length > 0
          ? await flowBuilderRequestRegistry.resolve({
              requestId: input.requestId,
              payload,
              execute: async () => deps.generateFlowDraft(payload, deps.store.getProviders())
            })
          : await deps.generateFlowDraft(payload, deps.store.getProviders());
      response.json(result);
    } catch (error) {
      if (error instanceof FlowBuilderRequestConflictError) {
        response.status(409).json({ error: error.message });
        return;
      }
      sendZodError(error, response);
    }
  });

  app.post("/api/flow-builder/generate-stream", async (request: Request, response: Response) => {
    console.log("[stream-endpoint] request received");
    let input;
    try {
      input = flowBuilderRequestSchema.parse(request.body);
    } catch (error) {
      console.log("[stream-endpoint] validation failed");
      sendZodError(error, response);
      return;
    }

    const payload = stripFlowBuilderRequestId(input);

    request.socket.setTimeout(0);
    request.socket.setNoDelay(true);
    request.socket.setKeepAlive(true);

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const abortController = new AbortController();
    let closed = false;

    const handleClientDisconnect = (reason: string): void => {
      if (closed) {
        return;
      }
      closed = true;
      console.log(`[stream-endpoint] ${reason}`);
      abortController.abort(reason);
    };

    // `request.close` can fire once the POST body is fully consumed, even while
    // the SSE response is still active. Track disconnect from response lifecycle.
    request.on("aborted", () => {
      handleClientDisconnect("client request aborted");
    });
    response.on("close", () => {
      if (!response.writableEnded) {
        handleClientDisconnect("client disconnected");
      }
    });

    const heartbeat = setInterval(() => {
      if (closed) {
        clearInterval(heartbeat);
        return;
      }
      console.log("[stream-endpoint] sending heartbeat");
      writeSseEvent(response, "heartbeat", { at: new Date().toISOString() });
    }, 15_000);
    const maxDurationTimer = setTimeout(() => {
      if (closed) {
        return;
      }
      const message = `Flow builder stream timed out after ${FLOW_BUILDER_STREAM_MAX_DURATION_MS}ms`;
      console.log(`[stream-endpoint] timeout: ${message}`);
      writeSseEvent(response, "error", { message });
      closed = true;
      response.end();
      abortController.abort(message);
    }, FLOW_BUILDER_STREAM_MAX_DURATION_MS);

    let trackerDeltaCount = 0;
    let rawDeltaCount = 0;
    let statusCount = 0;
    const emittedStatuses = new Set<string>();
    const emitStatus = (message: string): void => {
      const normalized = message.replace(/\s+/g, " ").trim();
      if (normalized.length === 0 || emittedStatuses.has(normalized)) {
        return;
      }
      emittedStatuses.add(normalized);
      statusCount++;
      if (statusCount <= 3) {
        console.log(`[stream-endpoint] status #${statusCount}:`, normalized);
      }
      if (!closed) {
        writeSseEvent(response, "status", { message: normalized, at: new Date().toISOString() });
      }
    };

    const tracker = new MessageFieldTracker((delta) => {
      trackerDeltaCount++;
      if (trackerDeltaCount <= 3) {
        console.log(`[stream-endpoint] tracker emitted delta #${trackerDeltaCount}:`, delta.slice(0, 80));
      }
      if (!closed) {
        writeSseEvent(response, "text_delta", { delta });
      }
    });

    console.log("[stream-endpoint] sending ready event");
    writeSseEvent(response, "ready", {
      requestId: typeof input.requestId === "string" ? input.requestId : undefined,
      at: new Date().toISOString()
    });
    emitStatus("Request accepted; model started processing.");

    try {
      const result = await deps.generateFlowDraft(payload, deps.store.getProviders(), {
        onTextDelta: (delta) => {
          rawDeltaCount++;
          if (rawDeltaCount <= 3) {
            console.log(`[stream-endpoint] raw onTextDelta #${rawDeltaCount}:`, delta.slice(0, 80));
          }
          tracker.push(delta);
        },
        onStatus: (message) => {
          emitStatus(message);
        },
        onThinking: (message) => {
          if (!closed) {
            writeSseEvent(response, "thinking", { message, at: new Date().toISOString() });
          }
        },
        signal: abortController.signal
      });

      console.log(
        `[stream-endpoint] complete: rawDeltas=${rawDeltaCount}, trackerDeltas=${trackerDeltaCount}, statuses=${statusCount}, closed=${closed}`
      );
      if (!closed) {
        writeSseEvent(response, "complete", { response: result });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Flow builder request failed";
      console.log(`[stream-endpoint] error: ${message}, rawDeltas=${rawDeltaCount}, trackerDeltas=${trackerDeltaCount}`);
      if (!closed) {
        writeSseEvent(response, "error", { message });
      }
    } finally {
      clearTimeout(maxDurationTimer);
      clearInterval(heartbeat);
      if (!closed) {
        response.end();
      }
    }
  });
}
