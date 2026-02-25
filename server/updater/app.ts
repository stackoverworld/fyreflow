import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";

import type { UpdaterRuntimeConfig } from "./config.js";
import type { ApplyUpdateRequest } from "./types.js";
import { UpdaterService } from "./service.js";

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

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createAuthMiddleware(authToken: string) {
  const expected = authToken.trim();

  return (request: Request, response: Response, next: NextFunction) => {
    if (request.path === "/health") {
      next();
      return;
    }

    if (expected.length === 0) {
      next();
      return;
    }

    const bearer = extractBearerToken(
      typeof request.headers.authorization === "string" ? request.headers.authorization : undefined
    );
    const xApiToken = typeof request.headers["x-api-token"] === "string"
      ? request.headers["x-api-token"].trim()
      : "";
    const candidate = bearer || xApiToken;

    if (candidate.length === 0 || !constantTimeEquals(candidate, expected)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

function createCorsMiddleware(config: UpdaterRuntimeConfig) {
  return cors({
    origin: (origin, callback) => {
      if (!origin || config.allowAnyCorsOrigin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-token"],
    credentials: false,
    maxAge: 600
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createUpdaterApp(config: UpdaterRuntimeConfig, service = new UpdaterService(config)): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(createCorsMiddleware(config));
  app.use(express.json({ limit: "256kb" }));
  app.use(createAuthMiddleware(config.authToken));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      now: new Date().toISOString()
    });
  });

  app.get("/api/updates/status", async (_request, response) => {
    try {
      await service.refreshLatestWhenStale();
      response.json({
        status: await service.getStatus()
      });
    } catch (error) {
      response.status(500).json({
        error: toErrorMessage(error)
      });
    }
  });

  app.post("/api/updates/check", async (_request, response) => {
    try {
      response.json({
        status: await service.checkForUpdates()
      });
    } catch (error) {
      response.status(500).json({
        error: toErrorMessage(error)
      });
    }
  });

  app.post("/api/updates/apply", async (request, response) => {
    try {
      const body = (request.body ?? {}) as ApplyUpdateRequest;
      response.json({
        status: await service.applyUpdate(body)
      });
    } catch (error) {
      response.status(409).json({
        error: toErrorMessage(error)
      });
    }
  });

  app.post("/api/updates/rollback", async (_request, response) => {
    try {
      response.json({
        status: await service.rollbackUpdate()
      });
    } catch (error) {
      response.status(409).json({
        error: toErrorMessage(error)
      });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  return app;
}
