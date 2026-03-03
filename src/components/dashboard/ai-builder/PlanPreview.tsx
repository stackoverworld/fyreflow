import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from "react";
import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { AiChatMessage, PipelinePayload } from "@/lib/types";
import { clonePipelinePayload } from "@/lib/pipelineDraft";
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

interface SyntheticStreamingDecisionInput {
  wasGenerating: boolean;
  generating: boolean;
  hasNativeStreaming: boolean;
  sawNativeStreamingInCurrentRun: boolean;
}

export function shouldStartSyntheticStreaming({
  wasGenerating,
  generating,
  hasNativeStreaming,
  sawNativeStreamingInCurrentRun
}: SyntheticStreamingDecisionInput): boolean {
  void wasGenerating;
  void generating;
  void hasNativeStreaming;
  void sawNativeStreamingInCurrentRun;
  return false;
}

interface ScrollContainer {
  scrollHeight: number;
  scrollTop: number;
  scrollTo?: (options: ScrollToOptions) => void;
}

export function scrollContainerToBottom(container: ScrollContainer): void {
  container.scrollTop = container.scrollHeight;
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }
}

interface BooleanRef {
  current: boolean;
}

export function cancelPendingRestoreAndScrollToBottom(
  container: ScrollContainer,
  pendingRestoreRef: BooleanRef
): void {
  pendingRestoreRef.current = false;
  scrollContainerToBottom(container);
}

interface AutoLoadOlderMessagesInput {
  scrollTop: number;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  pendingScrollRestore: boolean;
}

const LOAD_OLDER_TOP_THRESHOLD = 64;

export function shouldAutoLoadOlderMessages({
  scrollTop,
  hasOlderMessages,
  loadingOlderMessages,
  pendingScrollRestore
}: AutoLoadOlderMessagesInput): boolean {
  if (!hasOlderMessages || loadingOlderMessages || pendingScrollRestore) {
    return false;
  }
  return scrollTop <= LOAD_OLDER_TOP_THRESHOLD;
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
  const showScrollDownRef = useRef(false);
  const hasNativeStreaming = useMemo(() => messages.some((m) => m.streaming === true), [messages]);

  useEffect(() => {
    if (!hasNativeStreaming) return;
    const container = containerRef.current;
    if (!container) return;

    const interval = setInterval(() => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < 150) {
        container.scrollTop = container.scrollHeight;
      }
    }, 150);
    return () => clearInterval(interval);
  }, [hasNativeStreaming]);

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
    if (pendingScrollRestoreRef.current && el.scrollTop > 96) {
      pendingScrollRestoreRef.current = false;
    }
    if (shouldAutoLoadOlderMessages({
      scrollTop: el.scrollTop,
      hasOlderMessages,
      loadingOlderMessages,
      pendingScrollRestore: pendingScrollRestoreRef.current
    })) {
      requestOlderMessages();
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldShow = showScrollDownRef.current
      ? distanceFromBottom > 60
      : distanceFromBottom > 200;
    if (shouldShow !== showScrollDownRef.current) {
      showScrollDownRef.current = shouldShow;
      setShowScrollDown(shouldShow);
    }
  }, [hasOlderMessages, loadingOlderMessages, requestOlderMessages]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (shouldAutoLoadOlderMessages({
      scrollTop: container.scrollTop,
      hasOlderMessages,
      loadingOlderMessages,
      pendingScrollRestore: pendingScrollRestoreRef.current
    })) {
      requestOlderMessages();
    }
  }, [hasOlderMessages, loadingOlderMessages, messages.length, requestOlderMessages]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    cancelPendingRestoreAndScrollToBottom(container, pendingScrollRestoreRef);
    showScrollDownRef.current = false;
    setShowScrollDown(false);
  }, []);

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
      <div
        ref={containerRef}
        data-testid="ai-builder-chat-scroll"
        onScroll={handleScroll}
        className="h-full overflow-y-auto p-3 space-y-3"
      >
        {loadingOlderMessages ? (
          <p className="py-1 text-center text-[11px] text-ink-600">Loading older messages...</p>
        ) : hasOlderMessages ? (
          <p className="py-1 text-center text-[11px] text-ink-600">Older messages available</p>
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

        {generating && !hasNativeStreaming ? <PlanPreviewGeneratingIndicator /> : null}

        <div ref={messagesEndRef} />
      </div>

      <AnimatePresence>
        {showScrollDown ? (
          <motion.div
            key="scroll-btn"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center"
          >
            <button
              type="button"
              data-testid="ai-builder-chat-latest"
              className="pointer-events-auto flex items-center gap-1 rounded-full border border-ink-700/80 bg-ink-900/95 px-3 py-1.5 text-[11px] font-medium text-ink-200 hover:bg-ink-800/95"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-3 w-3" />
              Latest
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
