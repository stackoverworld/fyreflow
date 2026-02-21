import type { McpDraft } from "./formSchema";

export const MCP_SERVER_NAME_MINIMUM_LENGTH = 2;

export function hasMcpServerDraftChanged(nextDraft: McpDraft, baseDraft: McpDraft): boolean {
  return JSON.stringify(nextDraft) !== JSON.stringify(baseDraft);
}

export function isValidMcpServerName(draft: McpDraft): boolean {
  return draft.name.trim().length >= MCP_SERVER_NAME_MINIMUM_LENGTH;
}
