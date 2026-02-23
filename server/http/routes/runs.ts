import { type Request, type Response } from "express";
import { ZodError, z } from "zod";
import type { Express } from "express";
import type { Pipeline, PipelineRun } from "../../types.js";
import type { LocalStore } from "../../storage.js";
import { createAbortError } from "../../abort.js";
import { cancelRun, pauseRun, resolveRunApproval, resumeRun } from "../../runner.js";

interface RunRouteContext {
  store: LocalStore;
  activeRunControllers: Map<string, AbortController>;
  attachWorkerToExistingRun: (
    run: PipelineRun,
    pipeline: Pipeline,
    reason: string
  ) => Promise<void>;
}

const runApprovalResolveSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional()
});

function sendZodError(error: unknown, response: Response): void {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }

  console.error("[api-error]", error);
  response.status(500).json({ error: "Internal server error" });
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function parseCursorValue(value: string | string[] | undefined): number {
  const raw = firstParam(value);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function isTerminalRunStatus(status: PipelineRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function writeSseEvent(response: Response, event: string, payload: Record<string, unknown>): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function registerRunRoutes(app: Express, deps: RunRouteContext): void {
  app.get("/api/runs", (request: Request, response: Response) => {
    const limitRaw = request.query.limit;
    const limit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 30;
    response.json({ runs: deps.store.listRuns(Number.isNaN(limit) ? 30 : limit) });
  });

  app.get("/api/runs/:runId", (request: Request, response: Response) => {
    const run = deps.store.getRun(firstParam(request.params.runId));
    if (!run) {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    response.json({ run });
  });

  app.get("/api/runs/:runId/events", (request: Request, response: Response) => {
    const runId = firstParam(request.params.runId);
    const initialRun = deps.store.getRun(runId);
    if (!initialRun) {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    let closed = false;
    let nextLogIndex = Math.min(parseCursorValue(request.query.cursor), initialRun.logs.length);
    let lastStatus = initialRun.status;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      response.end();
    };

    const emitRunSnapshot = (run: PipelineRun): boolean => {
      if (closed) {
        return true;
      }

      for (let index = nextLogIndex; index < run.logs.length; index += 1) {
        writeSseEvent(response, "log", {
          runId,
          logIndex: index,
          message: run.logs[index],
          status: run.status,
          at: new Date().toISOString()
        });
      }
      nextLogIndex = run.logs.length;

      if (run.status !== lastStatus) {
        lastStatus = run.status;
        writeSseEvent(response, "status", {
          runId,
          status: run.status,
          at: new Date().toISOString()
        });
      }

      if (isTerminalRunStatus(run.status)) {
        writeSseEvent(response, "complete", {
          runId,
          status: run.status,
          at: new Date().toISOString()
        });
        return true;
      }

      return false;
    };

    writeSseEvent(response, "ready", {
      runId,
      cursor: nextLogIndex,
      status: initialRun.status,
      at: new Date().toISOString()
    });

    const shouldCloseImmediately = emitRunSnapshot(initialRun);
    if (shouldCloseImmediately) {
      closeStream();
      return;
    }

    pollTimer = setInterval(() => {
      const run = deps.store.getRun(runId);
      if (!run) {
        writeSseEvent(response, "error", {
          runId,
          message: "Run not found",
          at: new Date().toISOString()
        });
        closeStream();
        return;
      }

      if (emitRunSnapshot(run)) {
        closeStream();
      }
    }, 700);

    heartbeatTimer = setInterval(() => {
      const run = deps.store.getRun(runId);
      writeSseEvent(response, "heartbeat", {
        runId,
        cursor: nextLogIndex,
        status: run?.status ?? lastStatus,
        at: new Date().toISOString()
      });
    }, 15_000);

    request.on("close", closeStream);
  });

  app.post("/api/runs/:runId/stop", (request: Request, response: Response) => {
    const runId = firstParam(request.params.runId);
    const run = deps.store.getRun(runId);
    if (!run) {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    const controller = deps.activeRunControllers.get(runId);
    if (controller) {
      controller.abort(createAbortError("Stopped by user"));
    }

    cancelRun(deps.store, runId, "Stopped by user");
    const updated = deps.store.getRun(runId) ?? run;

    response.json({
      run: updated
    });
  });

  app.post("/api/runs/:runId/pause", (request: Request, response: Response) => {
    const runId = firstParam(request.params.runId);
    const run = deps.store.getRun(runId);
    if (!run) {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    const paused = pauseRun(deps.store, runId);
    if (!paused) {
      response.status(409).json({ error: "Run cannot be paused in its current state." });
      return;
    }

    const controller = deps.activeRunControllers.get(runId);
    if (controller) {
      controller.abort(createAbortError("Paused by user"));
      deps.activeRunControllers.delete(runId);
    }

    const updated = deps.store.getRun(runId) ?? run;
    response.json({ run: updated });
  });

  app.post("/api/runs/:runId/resume", async (request: Request, response: Response) => {
    const runId = firstParam(request.params.runId);
    const run = deps.store.getRun(runId);
    if (!run) {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    const resumed = resumeRun(deps.store, runId);
    if (!resumed) {
      response.status(409).json({ error: "Run is not paused." });
      return;
    }

    const updated = deps.store.getRun(runId) ?? run;
    const existingController = deps.activeRunControllers.get(runId);
    if (existingController?.signal.aborted) {
      deps.activeRunControllers.delete(runId);
    }
    const shouldAttachWorker =
      (updated.status === "running" || updated.status === "awaiting_approval") &&
      !deps.activeRunControllers.has(runId);

    if (shouldAttachWorker) {
      const pipeline = deps.store.getPipeline(updated.pipelineId);
      if (!pipeline) {
        cancelRun(deps.store, runId, "Resume failed: pipeline no longer exists");
        response.status(409).json({ error: "Pipeline not found for resumed run", run: deps.store.getRun(runId) ?? updated });
        return;
      }

      await deps.attachWorkerToExistingRun(
        updated,
        pipeline,
        `Recovery: execution worker attached after resume at ${new Date().toISOString()}.`
      );
    }

    response.json({ run: deps.store.getRun(runId) ?? updated });
  });

  app.post("/api/runs/:runId/approvals/:approvalId", async (request: Request, response: Response) => {
    const runId = firstParam(request.params.runId);
    const approvalId = firstParam(request.params.approvalId);

    try {
      const input = runApprovalResolveSchema.parse(request.body ?? {});
      const result = resolveRunApproval(deps.store, runId, approvalId, input.decision, input.note);

      if (result.status === "run_not_found") {
        response.status(404).json({ error: "Run not found" });
        return;
      }

      if (result.status === "approval_not_found") {
        response.status(404).json({ error: "Approval not found" });
        return;
      }

      if (result.status === "already_resolved") {
        response.status(409).json({ error: "Approval is already resolved", run: result.run });
        return;
      }

      const shouldAttachWorker =
        (result.run.status === "running" || result.run.status === "awaiting_approval") &&
        !deps.activeRunControllers.has(runId);
      if (!shouldAttachWorker) {
        const existingController = deps.activeRunControllers.get(runId);
        if (existingController?.signal.aborted) {
          deps.activeRunControllers.delete(runId);
        }
      }
      const shouldAttachAfterCleanup =
        (result.run.status === "running" || result.run.status === "awaiting_approval") &&
        !deps.activeRunControllers.has(runId);

      if (shouldAttachAfterCleanup) {
        const pipeline = deps.store.getPipeline(result.run.pipelineId);
        if (!pipeline) {
          cancelRun(deps.store, runId, "Approval resolved but pipeline is missing");
          response
            .status(409)
            .json({ error: "Pipeline not found for approval run", run: deps.store.getRun(runId) ?? result.run });
          return;
        }

        await deps.attachWorkerToExistingRun(
          result.run,
          pipeline,
          `Recovery: execution worker attached after approval at ${new Date().toISOString()}.`
        );
      }

      response.json({ run: deps.store.getRun(runId) ?? result.run });
    } catch (error) {
      sendZodError(error, response);
    }
  });
}

export type RunRouteDependencies = RunRouteContext;
