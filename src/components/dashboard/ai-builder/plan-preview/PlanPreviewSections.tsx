import { motion } from "motion/react";
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

type HeadingBlock = Extract<MarkdownBlock, { type: "heading" }>;
type ParagraphBlock = Extract<MarkdownBlock, { type: "paragraph" }>;
type UnorderedListBlock = Extract<MarkdownBlock, { type: "unordered_list" }>;
type OrderedListBlock = Extract<MarkdownBlock, { type: "ordered_list" }>;
type BlockquoteBlock = Extract<MarkdownBlock, { type: "blockquote" }>;
type CodeBlock = Extract<MarkdownBlock, { type: "code_block" }>;

function HeadingSection({ block, index }: { block: HeadingBlock; index: number }) {
  const headingClass =
    block.level <= 2
      ? "text-sm font-semibold text-ink-100"
      : block.level <= 4
        ? "text-[13px] font-semibold text-ink-100"
        : "text-[13px] font-medium text-ink-100";

  return (
    <p className={headingClass}>
      {renderInlineMarkdown(block.text, `md-heading-${index}`)}
    </p>
  );
}

function ParagraphSection({ block, index }: { block: ParagraphBlock; index: number }) {
  return (
    <p className="break-words text-[13px]">
      {renderInlineMarkdownWithLineBreaks(block.lines.join("\n"), `md-paragraph-${index}`)}
    </p>
  );
}

function UnorderedListSection({ block, index }: { block: UnorderedListBlock; index: number }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {block.items.map((item, itemIndex) => (
        <li key={`md-ul-${index}-item-${itemIndex}`} className="break-words text-[13px]">
          {renderInlineMarkdown(item, `md-ul-${index}-item-${itemIndex}`)}
        </li>
      ))}
    </ul>
  );
}

function OrderedListSection({ block, index }: { block: OrderedListBlock; index: number }) {
  return (
    <ol className="list-decimal space-y-1 pl-4">
      {block.items.map((item, itemIndex) => (
        <li key={`md-ol-${index}-item-${itemIndex}`} className="break-words text-[13px]">
          {renderInlineMarkdown(item, `md-ol-${index}-item-${itemIndex}`)}
        </li>
      ))}
    </ol>
  );
}

function BlockquoteSection({ block, index }: { block: BlockquoteBlock; index: number }) {
  return (
    <blockquote className="border-l-2 border-ink-700 pl-3 text-ink-300">
      {renderInlineMarkdownWithLineBreaks(block.lines.join("\n"), `md-quote-${index}`)}
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

export function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  if (blocks.length === 0) {
    return <p className="whitespace-pre-wrap break-words text-[13px]">{content}</p>;
  }

  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <HeadingSection key={`md-heading-${index}`} block={block} index={index} />;
        }

        if (block.type === "paragraph") {
          return <ParagraphSection key={`md-paragraph-${index}`} block={block} index={index} />;
        }

        if (block.type === "unordered_list") {
          return <UnorderedListSection key={`md-ul-${index}`} block={block} index={index} />;
        }

        if (block.type === "ordered_list") {
          return <OrderedListSection key={`md-ol-${index}`} block={block} index={index} />;
        }

        if (block.type === "blockquote") {
          return <BlockquoteSection key={`md-quote-${index}`} block={block} index={index} />;
        }

        return <CodeBlockSection key={`md-code-${index}`} block={block} />;
      })}
    </div>
  );
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
        {actionLabel && !isUser && !isError ? (
          <div className="mb-1">
            <Badge variant="neutral">{actionLabel}</Badge>
          </div>
        ) : null}

        {isUser || isError ? (
          <p className="whitespace-pre-wrap break-words text-[13px]">{message.content}</p>
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

        {!isUser && !isError && hasQuestions && onQuickReply ? (
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

        <p className="mt-1 text-[10px] text-ink-600">{new Date(message.timestamp).toLocaleTimeString()}</p>
      </div>
    </motion.div>
  );
}

export function PlanPreviewGeneratingIndicator() {
  return (
    <div className="px-3 py-2">
      <span className="shiny-text text-xs font-medium">Thinking...</span>
    </div>
  );
}
