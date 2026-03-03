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

    request.on("close", () => {
      closed = true;
      console.log("[stream-endpoint] client disconnected");
      abortController.abort("Client disconnected");
    });

    const heartbeat = setInterval(() => {
      if (closed) {
        clearInterval(heartbeat);
        return;
      }
      console.log("[stream-endpoint] sending heartbeat");
      writeSseEvent(response, "heartbeat", { at: new Date().toISOString() });
    }, 15_000);

    let trackerDeltaCount = 0;
    let rawDeltaCount = 0;
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

    try {
      const result = await deps.generateFlowDraft(payload, deps.store.getProviders(), {
        onTextDelta: (delta) => {
          rawDeltaCount++;
          if (rawDeltaCount <= 3) {
            console.log(`[stream-endpoint] raw onTextDelta #${rawDeltaCount}:`, delta.slice(0, 80));
          }
          tracker.push(delta);
        },
        signal: abortController.signal
      });

      console.log(`[stream-endpoint] complete: rawDeltas=${rawDeltaCount}, trackerDeltas=${trackerDeltaCount}, closed=${closed}`);
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
      clearInterval(heartbeat);
      if (!closed) {
        response.end();
      }
    }
  });
}
