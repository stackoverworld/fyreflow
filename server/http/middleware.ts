import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

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

export function createSecurityHeadersMiddleware(): (request: Request, response: Response, next: NextFunction) => void {
  return (_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  };
}

export interface CorsConfig {
  allowedOrigins: string[];
  allowAnyOrigin: boolean;
}

export function createCorsMiddleware(config: CorsConfig) {
  return cors({
    origin: (origin, callback) => {
      if (!origin || config.allowAnyOrigin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 600
  });
}

export interface ApiAuthMiddlewareOptions {
  isAdditionalTokenValid?: (token: string) => boolean;
}

export function createApiAuthMiddleware(apiAuthToken: string, options: ApiAuthMiddlewareOptions = {}) {
  const trimmedToken = apiAuthToken.trim();
  const publicPaths = new Set(["/api/health"]);

  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.path.startsWith("/api/")) {
      next();
      return;
    }

    if (request.method === "OPTIONS" || publicPaths.has(request.path) || request.path.startsWith("/api/pairing/")) {
      next();
      return;
    }

    if (trimmedToken.length === 0) {
      next();
      return;
    }

    const bearerToken = extractBearerToken(
      typeof request.headers.authorization === "string" ? request.headers.authorization : undefined
    );
    const headerToken =
      typeof request.headers["x-api-token"] === "string" ? request.headers["x-api-token"].trim() : "";
    const rawQueryToken =
      request.query && typeof request.query === "object"
        ? (request.query as Record<string, unknown>).api_token
        : undefined;
    const queryToken =
      request.method === "GET" &&
      request.path.startsWith("/api/files/raw/") &&
      typeof rawQueryToken === "string"
        ? rawQueryToken.trim()
        : "";
    const candidate = bearerToken || headerToken || queryToken;

    const isStaticTokenValid = candidate.length > 0 && constantTimeEquals(candidate, trimmedToken);
    const isAdditionalTokenValid =
      candidate.length > 0 &&
      typeof options.isAdditionalTokenValid === "function" &&
      options.isAdditionalTokenValid(candidate);

    if (!isStaticTokenValid && !isAdditionalTokenValid) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

export function createNotFoundMiddleware(): (request: Request, response: Response) => void {
  return (_request, response) => {
    response.status(404).json({ error: "Not found" });
  };
}

export function createErrorMiddleware(): (
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction
) => void {
  return (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _request;
    void _next;
    console.error("[unhandled-api-error]", error);
    response.status(500).json({ error: "Internal server error" });
  };
}
