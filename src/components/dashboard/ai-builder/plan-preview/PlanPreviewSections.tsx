import { useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/optics/button";
import { Badge } from "@/components/optics/badge";
import { cn } from "@/lib/cn";
import type { AiChatMessage } from "@/lib/types";
import {
  type MarkdownBlock,
  parseMarkdownBlocks,
  renderInlineMarkdown,
  renderInlineMarkdownWithLineBreaks,
} from "./planPreviewFormatters";

const transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
const metaTransition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const };

type HeadingBlock = Extract<MarkdownBlock, { type: "heading" }>;
type ParagraphBlock = Extract<MarkdownBlock, { type: "paragraph" }>;
type UnorderedListBlock = Extract<MarkdownBlock, { type: "unordered_list" }>;
type OrderedListBlock = Extract<MarkdownBlock, { type: "ordered_list" }>;
type BlockquoteBlock = Extract<MarkdownBlock, { type: "blockquote" }>;
type CodeBlock = Extract<MarkdownBlock, { type: "code_block" }>;

function HeadingSection({ block, index, trailingDot }: { block: HeadingBlock; index: number; trailingDot?: boolean }) {
  const headingClass =
    block.level <= 2
      ? "text-sm font-semibold text-ink-100"
      : block.level <= 4
        ? "text-[13px] font-semibold text-ink-100"
        : "text-[13px] font-medium text-ink-100";

  return (
    <p className={headingClass}>
      {renderInlineMarkdown(block.text, `md-heading-${index}`)}
      {trailingDot ? <ThinkingIndicator inline /> : null}
    </p>
  );
}

function ThinkingIndicator({ inline = false }: { inline?: boolean }) {
  return (
    <span className={cn("inline-flex items-center align-middle text-[11px] font-medium text-ink-500", inline ? "ml-1" : null)}>
      <span className="shiny-text">Thinking</span>
      <span aria-hidden className="ml-0.5 inline-flex text-ink-600">
        <span className="animate-pulse [animation-delay:0ms]">.</span>
        <span className="animate-pulse [animation-delay:120ms]">.</span>
        <span className="animate-pulse [animation-delay:240ms]">.</span>
      </span>
    </span>
  );
}

function ParagraphSection({ block, index, trailingDot }: { block: ParagraphBlock; index: number; trailingDot?: boolean }) {
  return (
    <p className="break-words text-[13px]">
      {renderInlineMarkdownWithLineBreaks(block.lines.join("\n"), `md-paragraph-${index}`)}
      {trailingDot ? <ThinkingIndicator inline /> : null}
    </p>
  );
}

function UnorderedListSection({ block, index, trailingDot }: { block: UnorderedListBlock; index: number; trailingDot?: boolean }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {block.items.map((item, itemIndex) => (
        <li key={`md-ul-${index}-item-${itemIndex}`} className="break-words text-[13px]">
          {renderInlineMarkdown(item, `md-ul-${index}-item-${itemIndex}`)}
          {trailingDot && itemIndex === block.items.length - 1 ? <ThinkingIndicator inline /> : null}
        </li>
      ))}
    </ul>
  );
}

function OrderedListSection({ block, index, trailingDot }: { block: OrderedListBlock; index: number; trailingDot?: boolean }) {
  return (
    <ol className="list-decimal space-y-1 pl-4">
      {block.items.map((item, itemIndex) => (
        <li key={`md-ol-${index}-item-${itemIndex}`} className="break-words text-[13px]">
          {renderInlineMarkdown(item, `md-ol-${index}-item-${itemIndex}`)}
          {trailingDot && itemIndex === block.items.length - 1 ? <ThinkingIndicator inline /> : null}
        </li>
      ))}
    </ol>
  );
}

function BlockquoteSection({ block, index, trailingDot }: { block: BlockquoteBlock; index: number; trailingDot?: boolean }) {
  return (
    <blockquote className="border-l-2 border-ink-700 pl-3 text-ink-300">
      {renderInlineMarkdownWithLineBreaks(block.lines.join("\n"), `md-quote-${index}`)}
      {trailingDot ? <ThinkingIndicator inline /> : null}
    </blockquote>
  );
}

function CodeBlockSection({ block }: { block: CodeBlock }) {
  return (
    <pre
      className="overflow-x-auto rounded-lg border border-ink-800/50 bg-[var(--surface-inset)] px-2.5 py-2"
    >
      {block.language ? <p className="mb-1 text-[10px] uppercase text-ink-500">{block.language}</p> : null}
      <code className="whitespace-pre font-mono text-[12px] text-ink-100">{block.code}</code>
    </pre>
  );
}

export function MarkdownContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const blocks = parseMarkdownBlocks(content);
  const prevBlockCountRef = useRef(0);

  const stableBlockCount = blocks.length;
  const firstNewBlock = prevBlockCountRef.current;
  if (!streaming) {
    prevBlockCountRef.current = 0;
  } else if (stableBlockCount > prevBlockCountRef.current) {
    prevBlockCountRef.current = stableBlockCount;
  }

  if (blocks.length === 0) {
    return (
      <p className="whitespace-pre-wrap break-words text-[13px]">
        {content}
        {streaming ? <ThinkingIndicator inline /> : null}
      </p>
    );
  }

  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const isNew = streaming && index >= firstNewBlock;
        const element = renderBlock(block, index, streaming && isLast);
        if (!isNew) return element;
        return (
          <motion.div
            key={`fade-${index}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            {element}
          </motion.div>
        );
      })}
    </div>
  );
}

function renderBlock(block: MarkdownBlock, index: number, trailingDot = false) {
  if (block.type === "heading") {
    return <HeadingSection key={`md-heading-${index}`} block={block} index={index} trailingDot={trailingDot} />;
  }
  if (block.type === "paragraph") {
    return <ParagraphSection key={`md-paragraph-${index}`} block={block} index={index} trailingDot={trailingDot} />;
  }
  if (block.type === "unordered_list") {
    return <UnorderedListSection key={`md-ul-${index}`} block={block} index={index} trailingDot={trailingDot} />;
  }
  if (block.type === "ordered_list") {
    return <OrderedListSection key={`md-ol-${index}`} block={block} index={index} trailingDot={trailingDot} />;
  }
  if (block.type === "blockquote") {
    return <BlockquoteSection key={`md-quote-${index}`} block={block} index={index} trailingDot={trailingDot} />;
  }
  return <CodeBlockSection key={`md-code-${index}`} block={block} />;
}


interface ChatBubbleProps {
  message: AiChatMessage;
  onApply?: () => void;
  onQuickReply?: (value: string) => Promise<void>;
  readOnly?: boolean;
}

export function ChatBubble({ message, onApply, onQuickReply, readOnly = false }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const isAssistant = !isUser && !isError;
  const isNativeStreaming = message.streaming === true && isAssistant;
  const nativeStreamingWaiting = isNativeStreaming && message.content.length === 0;
  const nativeStreamingActive = isNativeStreaming && message.content.length > 0;
  const hasQuestions = (message.questions?.length ?? 0) > 0;
  const actionLabel =
    message.action === "answer" && hasQuestions
      ? "Clarification"
      : message.action === "answer"
      ? "Answer"
      : message.action === "update_current_flow"
        ? "Flow update"
        : message.action === "replace_flow"
          ? "Flow rebuild"
          : null;

  const showBadge = isAssistant && !isNativeStreaming;
  const showTimestamp = !isNativeStreaming;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2",
          isUser
            ? "bg-ink-800/50 text-ink-100"
            : isError
              ? "border border-red-500/20 bg-red-500/10 text-red-400"
              : "text-ink-200"
        )}
      >
        <AnimatePresence initial={false}>
          {showBadge ? (
            <motion.div
              key="assistant-badge"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={metaTransition}
              className="mb-1"
            >
              <Badge variant="neutral">{actionLabel ?? "Answer"}</Badge>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {isUser || isError ? (
          <p className="whitespace-pre-wrap break-words text-[13px]">{message.content}</p>
        ) : nativeStreamingWaiting ? (
          <ThinkingIndicator />
        ) : nativeStreamingActive ? (
          <MarkdownContent content={message.content} streaming />
        ) : (
          <MarkdownContent content={message.content} />
        )}

        {message.generatedDraft && onApply ? (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="neutral">{message.generatedDraft.steps.length} steps</Badge>
            <Badge variant="neutral">{message.generatedDraft.links.length} links</Badge>
            <Button size="sm" variant="ghost" disabled={readOnly} onClick={onApply}>
              Re-apply
            </Button>
          </div>
        ) : null}

        {isAssistant && hasQuestions && onQuickReply ? (
          <div className="mt-2 space-y-2">
            {message.questions?.map((question) => (
              <div
                key={question.id}
                className="rounded-lg bg-ink-900/50 px-2.5 py-2"
              >
                <p className="text-[12px] font-medium text-ink-200">{question.question}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {question.options.map((option, index) => (
                    <Button
                      key={`${question.id}-option-${index}`}
                      size="sm"
                      variant="secondary"
                      disabled={readOnly}
                      onClick={() => {
                        void onQuickReply(option.value);
                      }}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {showTimestamp ? (
            <motion.p
              key="message-time"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={metaTransition}
              className="mt-1 text-[10px] text-ink-600"
            >
              {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function PlanPreviewGeneratingIndicator() {
  return (
    <div className="px-3 py-2">
      <ThinkingIndicator />
    </div>
  );
}
