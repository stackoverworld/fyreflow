import type { McpServerConfig } from "@/lib/types";
import type { McpServerTemplate } from "@/lib/mcpTemplates";

export interface McpDraft {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
  toolAllowlist: string;
  health: "unknown" | "healthy" | "degraded" | "down";
}

export const MCP_SERVER_TRANSPORT_OPTIONS = [
  { value: "http", label: "HTTP" },
  { value: "sse", label: "SSE" },
  { value: "stdio", label: "Stdio" }
] as const;

export const HEALTH_DOT: Record<McpDraft["health"], string> = {
  unknown: "bg-ink-600",
  healthy: "bg-emerald-500",
  degraded: "bg-amber-400",
  down: "bg-red-500"
};

export function toServerDraft(server: McpServerConfig): McpDraft {
  return {
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    env: server.env,
    headers: server.headers,
    toolAllowlist: server.toolAllowlist,
    health: server.health
  };
}

export function createNewServerDraft(): McpDraft {
  return {
    name: "",
    enabled: true,
    transport: "http",
    command: "",
    args: "",
    url: "",
    env: "",
    headers: "",
    toolAllowlist: "",
    health: "unknown"
  };
}

export function toDraftFromTemplate(template: McpServerTemplate): McpDraft {
  return {
    ...createNewServerDraft(),
    ...template.draft,
    enabled: true,
    health: "unknown"
  };
}
