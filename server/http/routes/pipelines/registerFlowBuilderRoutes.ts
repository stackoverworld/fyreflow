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

function writeSseEvent(response: Response, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
    let input;
    try {
      input = flowBuilderRequestSchema.parse(request.body);
    } catch (error) {
      sendZodError(error, response);
      return;
    }

    const payload = stripFlowBuilderRequestId(input);

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const abortController = new AbortController();
    let closed = false;

    request.on("close", () => {
      closed = true;
      abortController.abort("Client disconnected");
    });

    const heartbeat = setInterval(() => {
      if (closed) {
        clearInterval(heartbeat);
        return;
      }
      writeSseEvent(response, "heartbeat", { at: new Date().toISOString() });
    }, 15_000);

    const tracker = new MessageFieldTracker((delta) => {
      if (!closed) {
        writeSseEvent(response, "text_delta", { delta });
      }
    });

    try {
      const result = await deps.generateFlowDraft(payload, deps.store.getProviders(), {
        onTextDelta: (delta) => tracker.push(delta),
        signal: abortController.signal
      });

      if (!closed) {
        writeSseEvent(response, "complete", { response: result });
      }
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error ? error.message : "Flow builder request failed";
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
