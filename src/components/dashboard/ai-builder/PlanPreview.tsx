import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from "react";
import { ArrowDown } from "lucide-react";
import type { AiChatMessage, PipelinePayload } from "@/lib/types";
import { clonePipelinePayload } from "@/lib/pipelineDraft";
import { Button } from "@/components/optics/button";
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
  const [showScrollDown, setShowScrollDown] = useState(false);

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
    const el = event.currentTarget;
    if (el.scrollTop <= 64) {
      requestOlderMessages();
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 120);
  }, [requestOlderMessages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messagesEndRef]);

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
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto p-3 space-y-3">
        {loadingOlderMessages ? (
          <p className="py-1 text-center text-[11px] text-ink-600">Loading older messages...</p>
        ) : hasOlderMessages ? (
          <p className="py-1 text-center text-[11px] text-ink-600">Scroll up to load older messages</p>
        ) : null}

        {messages.length === 0 && !generating ? <PlanPreviewHeader /> : null}

        {messages.map((msg) => {
          const generatedDraft = msg.generatedDraft;
          return (
            <ChatBubble
              key={msg.id}
              message={msg}
              readOnly={readOnly || generating}
              onQuickReply={onQuickReply}
              onApply={
                generatedDraft
                  ? () => {
                      onApplyDraft(clonePipelinePayload(generatedDraft));
                    }
                  : undefined
              }
            />
          );
        })}

        {generating ? <PlanPreviewGeneratingIndicator /> : null}

        <div ref={messagesEndRef} />
      </div>

      {showScrollDown ? (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 gap-1 rounded-full border-ink-700/80 bg-ink-900/95 px-3 text-[11px]"
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-3 w-3" />
          Latest
        </Button>
      ) : null}
    </div>
  );
}
