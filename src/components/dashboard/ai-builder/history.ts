import type { AiChatMessage } from "@/lib/types";

export const FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS = 64_000;

export interface FlowBuilderHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export function clipFlowBuilderHistoryContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS) {
    return trimmed;
  }
  return trimmed.slice(0, FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS);
}

export function toFlowBuilderHistoryMessage(entry: AiChatMessage): FlowBuilderHistoryMessage | null {
  if (entry.role !== "user" && entry.role !== "assistant") {
    return null;
  }

  const content = clipFlowBuilderHistoryContent(entry.content);
  if (content.length === 0) {
    return null;
  }

  return {
    role: entry.role,
    content
  };
}
