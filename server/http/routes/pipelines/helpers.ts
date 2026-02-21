import type { Response } from "express";
import { ZodError } from "zod";
import type { McpServerConfig, ProviderConfig } from "../../../types.js";
import { MASK_VALUE } from "../../../secureInputs.js";

export function sendZodError(error: unknown, response: Response): void {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }

  console.error("[api-error]", error);
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim().replace(/\s+/g, " ").slice(0, 480)
      : "Internal server error";
  response.status(500).json({ error: message });
}

export function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function maskIfPresent(value: string): string {
  return value.trim().length > 0 ? MASK_VALUE : "";
}

export function sanitizeProviderConfig(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: maskIfPresent(provider.apiKey),
    oauthToken: maskIfPresent(provider.oauthToken)
  };
}

export function sanitizeMcpServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: maskIfPresent(server.env),
    headers: maskIfPresent(server.headers)
  };
}
