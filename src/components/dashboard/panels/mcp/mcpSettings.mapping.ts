import type { McpServerConfig, McpServerPayload } from "@/lib/types";
import type { McpDraft } from "./formSchema";

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

export function toMcpServerPayload(draft: McpDraft): McpServerPayload {
  return {
    name: draft.name,
    enabled: draft.enabled,
    transport: draft.transport,
    command: draft.command,
    args: draft.args,
    url: draft.url,
    env: draft.env,
    headers: draft.headers,
    toolAllowlist: draft.toolAllowlist,
    health: draft.health
  };
}
