import { useCallback, useLayoutEffect, useRef, type RefObject, type UIEvent } from "react";
import type { AiChatMessage, PipelinePayload } from "@/lib/types";
import { ChatBubble, PlanPreviewGeneratingIndicator } from "./plan-preview/PlanPreviewSections";
import { PlanPreviewHeader } from "./plan-preview/PlanPreviewHeader";

interface PlanPreviewProps {
  messages: AiChatMessage[];
  generating: boolean;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  readOnly: boolean;
  messagesEndRef: RefObject<HTMLDivElement>;
  onApplyDraft: (draft: PipelinePayload) => void;
  onQuickReply: (value: string) => Promise<void>;
  onLoadOlderMessages: () => boolean;
}

export function PlanPreview({
  messages,
  generating,
  hasOlderMessages,
  loadingOlderMessages,
  readOnly,
  messagesEndRef,
  onApplyDraft,
  onQuickReply,
  onLoadOlderMessages,
}: PlanPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const previousScrollHeightRef = useRef(0);

  const requestOlderMessages = useCallback(() => {
    const container = containerRef.current;
    if (!container || loadingOlderMessages || !hasOlderMessages) {
      return;
    }

    pendingScrollRestoreRef.current = true;
    previousScrollTopRef.current = container.scrollTop;
    previousScrollHeightRef.current = container.scrollHeight;
    const loaded = onLoadOlderMessages();
    if (!loaded) {
      pendingScrollRestoreRef.current = false;
    }
  }, [hasOlderMessages, loadingOlderMessages, onLoadOlderMessages]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop <= 64) {
      requestOlderMessages();
    }
  }, [requestOlderMessages]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      pendingScrollRestoreRef.current = false;
      return;
    }

    const heightDelta = container.scrollHeight - previousScrollHeightRef.current;
    container.scrollTop = previousScrollTopRef.current + Math.max(0, heightDelta);
    pendingScrollRestoreRef.current = false;
  }, [messages]);

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-3">
      {loadingOlderMessages ? (
        <p className="py-1 text-center text-[11px] text-ink-600">Loading older messages...</p>
      ) : hasOlderMessages ? (
        <p className="py-1 text-center text-[11px] text-ink-600">Scroll up to load older messages</p>
      ) : null}

      {messages.length === 0 && !generating ? <PlanPreviewHeader /> : null}

      {messages.map((msg) => (
        <ChatBubble
          key={msg.id}
          message={msg}
          readOnly={readOnly || generating}
          onQuickReply={onQuickReply}
          onApply={
            msg.generatedDraft
              ? () => {
                  onApplyDraft(msg.generatedDraft!);
                }
              : undefined
          }
        />
      ))}

      {generating ? <PlanPreviewGeneratingIndicator /> : null}

      <div ref={messagesEndRef} />
    </div>
  );
}
