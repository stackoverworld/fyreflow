import type { AiChatMessage } from "@/lib/types";

function normalizeRequestId(requestId: string): string {
  return requestId.trim();
}

export function hasAssistantResultForRequest(messages: AiChatMessage[], requestId: string): boolean {
  const normalized = normalizeRequestId(requestId);
  if (normalized.length === 0) {
    return false;
  }

  return messages.some((entry) => entry.role === "assistant" && entry.requestId === normalized);
}

export function hasErrorResultForRequest(messages: AiChatMessage[], requestId: string): boolean {
  const normalized = normalizeRequestId(requestId);
  if (normalized.length === 0) {
    return false;
  }

  return messages.some((entry) => entry.role === "error" && entry.requestId === normalized);
}
