import type { Express, Request, Response } from "express";
import { assertResolvedPublicAddress } from "../../../security/networkTargets.js";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sanitizeMcpServer, sendZodError } from "./helpers.js";
import { mcpServerPatchSchema, mcpServerSchema } from "./schemas.js";

export function registerMcpRoutes(app: Express, deps: PipelineRouteContext): void {
  app.get("/api/mcp-servers", (_request: Request, response: Response) => {
    response.json({ mcpServers: deps.store.listMcpServers().map((server) => sanitizeMcpServer(server)) });
  });

  app.post("/api/mcp-servers", async (request: Request, response: Response) => {
    try {
      const input = mcpServerSchema.parse(request.body);
      if (input.transport === "http" && typeof input.url === "string" && input.url.trim().length > 0) {
        await assertResolvedPublicAddress(input.url, "MCP URL");
      }
      if (input.transport === "http" && (!input.toolAllowlist || input.toolAllowlist.trim().length === 0)) {
        response.status(400).json({ error: "HTTP MCP servers require an explicit tool allowlist." });
        return;
      }
      if (input.transport === "http" && (!input.hostAllowlist || input.hostAllowlist.trim().length === 0)) {
        response.status(400).json({ error: "HTTP MCP servers require an explicit outbound host allowlist." });
        return;
      }
      const mcpServer = deps.store.createMcpServer(input);
      response.status(201).json({ mcpServer: sanitizeMcpServer(mcpServer) });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.put("/api/mcp-servers/:serverId", async (request: Request, response: Response) => {
    try {
      const input = mcpServerPatchSchema.parse(request.body);
      const serverId = firstParam(request.params.serverId);
      const existing = deps.store.listMcpServers().find((entry) => entry.id === serverId);
      const nextTransport = input.transport ?? existing?.transport;
      const nextUrl = typeof input.url === "string" ? input.url : existing?.url;
      const nextToolAllowlist = typeof input.toolAllowlist === "string" ? input.toolAllowlist : existing?.toolAllowlist;
      const nextHostAllowlist = typeof input.hostAllowlist === "string" ? input.hostAllowlist : existing?.hostAllowlist;
      if (nextTransport === "http" && typeof nextUrl === "string" && nextUrl.trim().length > 0) {
        await assertResolvedPublicAddress(nextUrl, "MCP URL");
      }
      if (nextTransport === "http" && (!nextToolAllowlist || nextToolAllowlist.trim().length === 0)) {
        response.status(400).json({ error: "HTTP MCP servers require an explicit tool allowlist." });
        return;
      }
      if (nextTransport === "http" && (!nextHostAllowlist || nextHostAllowlist.trim().length === 0)) {
        response.status(400).json({ error: "HTTP MCP servers require an explicit outbound host allowlist." });
        return;
      }
      const mcpServer = deps.store.updateMcpServer(serverId, input);

      if (!mcpServer) {
        response.status(404).json({ error: "MCP server not found" });
        return;
      }

      response.json({ mcpServer: sanitizeMcpServer(mcpServer) });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.delete("/api/mcp-servers/:serverId", (request: Request, response: Response) => {
    const removed = deps.store.deleteMcpServer(firstParam(request.params.serverId));
    if (!removed) {
      response.status(404).json({ error: "MCP server not found" });
      return;
    }

    response.status(204).send();
  });
}
