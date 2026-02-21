import type { McpServerConfig } from "../types.js";
import { parseCsv } from "./parsers.js";

export function isToolAllowed(server: McpServerConfig, tool: string): boolean {
  const allowlist = parseCsv(server.toolAllowlist);
  if (allowlist.length === 0) {
    return true;
  }

  return allowlist.includes("*") || allowlist.includes(tool);
}
