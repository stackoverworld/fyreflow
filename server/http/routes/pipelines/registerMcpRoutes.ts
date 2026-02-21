import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sanitizeMcpServer, sendZodError } from "./helpers.js";
import { mcpServerPatchSchema, mcpServerSchema } from "./schemas.js";

export function registerMcpRoutes(app: Express, deps: PipelineRouteContext): void {
  app.get("/api/mcp-servers", (_request: Request, response: Response) => {
    response.json({ mcpServers: deps.store.listMcpServers().map((server) => sanitizeMcpServer(server)) });
  });

  app.post("/api/mcp-servers", (request: Request, response: Response) => {
    try {
      const input = mcpServerSchema.parse(request.body);
      const mcpServer = deps.store.createMcpServer(input);
      response.status(201).json({ mcpServer: sanitizeMcpServer(mcpServer) });
    } catch (error) {
      sendZodError(error, response);
    }
  });

  app.put("/api/mcp-servers/:serverId", (request: Request, response: Response) => {
    try {
      const input = mcpServerPatchSchema.parse(request.body);
      const mcpServer = deps.store.updateMcpServer(firstParam(request.params.serverId), input);

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
