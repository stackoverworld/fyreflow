import { type Request, type Response } from "express";
import { ZodError, z } from "zod";
import type { Express } from "express";

import { PairingError, type PairingService } from "../../pairing/service.js";

interface PairingRouteContext {
  pairingService: PairingService;
  realtimePath: string;
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
