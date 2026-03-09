import type { McpServerTemplate } from "@/lib/mcpTemplates";

export interface McpDraft {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
  toolAllowlist: string;
  hostAllowlist: string;
  health: "unknown" | "healthy" | "degraded" | "down";
}

export const MCP_SERVER_TRANSPORT_OPTIONS = [
  { value: "http", label: "HTTP" },
  { value: "stdio", label: "Stdio" }
] as const;

export const HEALTH_DOT: Record<McpDraft["health"], string> = {
  unknown: "bg-ink-600",
  healthy: "bg-emerald-500",
  degraded: "bg-amber-400",
  down: "bg-red-500"
};

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
    hostAllowlist: "",
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
