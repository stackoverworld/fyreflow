import { type Request, type Response } from "express";
import { ZodError, z } from "zod";
import type { Express } from "express";
import { timingSafeEqual } from "node:crypto";

import { PairingError, type PairingService } from "../../pairing/service.js";
import type { RuntimeMode } from "../../runtime/config.js";

interface PairingRouteContext {
  pairingService: PairingService;
  realtimePath: string;
  apiAuthToken: string;
  runtimeMode: RuntimeMode;
}

const createPairingSessionSchema = z
  .object({
    clientName: z.string().max(120).optional(),
    platform: z.string().max(80).optional(),
    ttlSeconds: z.number().int().min(60).max(1800).optional()
  })
  .optional()
  .default({});

const approvePairingSchema = z.object({
  code: z.string().min(1).max(24),
  label: z.string().max(120).optional()
});

const claimPairingSchema = z.object({
  code: z.string().min(1).max(24)
});

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
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

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function requirePairingAdminAuth(request: Request, response: Response, deps: PairingRouteContext): boolean {
  const expectedToken = deps.apiAuthToken.trim();
  if (expectedToken.length === 0) {
    if (deps.runtimeMode === "local") {
      return true;
    }

    response.status(503).json({
      error: "Pairing admin actions require DASHBOARD_API_TOKEN in remote mode.",
      code: "pairing_admin_token_missing"
    });
    return false;
  }

  const authorizationHeader =
    typeof request.headers.authorization === "string" ? request.headers.authorization : undefined;
  const xApiTokenHeader =
    typeof request.headers["x-api-token"] === "string" ? request.headers["x-api-token"] : undefined;
  const bearerToken = extractBearerToken(authorizationHeader);
  const candidateToken = bearerToken || (xApiTokenHeader?.trim() ?? "");
  if (candidateToken.length === 0 || !constantTimeEquals(candidateToken, expectedToken)) {
    response.status(401).json({
      error: "Unauthorized",
      code: "pairing_admin_unauthorized"
    });
    return false;
  }

  return true;
}

function sendPairingError(error: unknown, response: Response): void {
  if (error instanceof PairingError) {
    response.status(error.statusCode).json({
      error: error.message,
      code: error.code
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  console.error("[pairing-api-error]", error);
  response.status(500).json({ error: "Internal server error" });
}

export function registerPairingRoutes(app: Express, deps: PairingRouteContext): void {
  app.post("/api/pairing/sessions", (request: Request, response: Response) => {
    try {
      const input = createPairingSessionSchema.parse(request.body ?? {});
      const session = deps.pairingService.createSession(input);
      response.status(201).json({
        session: {
          ...session,
          realtimePath: deps.realtimePath
        }
      });
    } catch (error) {
      sendPairingError(error, response);
    }
  });

  app.get("/api/pairing/sessions/:sessionId", (request: Request, response: Response) => {
    try {
      const sessionId = firstParam(request.params.sessionId);
      const session = deps.pairingService.getSession(sessionId);
      if (!session) {
        response.status(404).json({ error: "Pairing session not found", code: "pairing_session_not_found" });
        return;
      }

      response.json({
        session: {
          ...session,
          realtimePath: deps.realtimePath
        }
      });
    } catch (error) {
      sendPairingError(error, response);
    }
  });

  app.post("/api/pairing/sessions/:sessionId/approve", (request: Request, response: Response) => {
    if (!requirePairingAdminAuth(request, response, deps)) {
      return;
    }

    try {
      const sessionId = firstParam(request.params.sessionId);
      const input = approvePairingSchema.parse(request.body ?? {});
      const session = deps.pairingService.approveSession(sessionId, input.code, input.label);
      response.json({ session });
    } catch (error) {
      sendPairingError(error, response);
    }
  });

  app.post("/api/pairing/sessions/:sessionId/claim", (request: Request, response: Response) => {
    try {
      const sessionId = firstParam(request.params.sessionId);
      const input = claimPairingSchema.parse(request.body ?? {});
      const result = deps.pairingService.claimSession(sessionId, input.code);
      response.json(result);
    } catch (error) {
      sendPairingError(error, response);
    }
  });

  app.post("/api/pairing/sessions/:sessionId/cancel", (request: Request, response: Response) => {
    if (!requirePairingAdminAuth(request, response, deps)) {
      return;
    }

    try {
      const sessionId = firstParam(request.params.sessionId);
      const session = deps.pairingService.cancelSession(sessionId);
      response.json({ session });
    } catch (error) {
      sendPairingError(error, response);
    }
  });
}

export type PairingRouteDependencies = PairingRouteContext;
