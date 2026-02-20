import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Send, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { MODEL_CATALOG, getDefaultModelForProvider } from "@/lib/modelCatalog";
import { generateFlowDraft } from "@/lib/api";
import { loadAiChatHistory, saveAiChatHistory } from "@/lib/aiChatStorage";
import { autoLayoutPipelineDraftSmart } from "@/lib/flowLayout";
import type { AiChatMessage, McpServerConfig, PipelinePayload, ProviderId, ReasoningEffort } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Textarea } from "@/components/optics/textarea";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { OpenAIIcon, AnthropicIcon } from "@/components/optics/icons";
import { Badge } from "@/components/optics/badge";
import { cn } from "@/lib/cn";

const AI_SETTINGS_KEY = "fyreflow:ai-builder-settings";

interface AiBuilderSettings {
  providerId: ProviderId;
  model: string;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  use1MContext: boolean;
}

const defaultSettings: AiBuilderSettings = {
  providerId: "claude",
  model: "claude-opus-4-6",
  reasoningEffort: "high",
  fastMode: false,
  use1MContext: false,
};

function loadAiBuilderSettings(): AiBuilderSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultSettings;
    return {
      providerId: parsed.providerId === "openai" || parsed.providerId === "claude" ? parsed.providerId : defaultSettings.providerId,
      model: typeof parsed.model === "string" ? parsed.model : defaultSettings.model,
      reasoningEffort: ["minimal", "low", "medium", "high", "xhigh"].includes(parsed.reasoningEffort) ? parsed.reasoningEffort : defaultSettings.reasoningEffort,
      fastMode: typeof parsed.fastMode === "boolean" ? parsed.fastMode : defaultSettings.fastMode,
      use1MContext: typeof parsed.use1MContext === "boolean" ? parsed.use1MContext : defaultSettings.use1MContext,
    };
  } catch {
    return defaultSettings;
  }
}

function saveAiBuilderSettings(settings: AiBuilderSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore write errors
  }
}

interface AiBuilderPanelProps {
  workflowKey: string;
  currentDraft: PipelinePayload;
  mcpServers: McpServerConfig[];
  onApplyDraft: (draft: PipelinePayload) => void;
  onNotice: (message: string) => void;
  readOnly?: boolean;
}

const providerSegments = [
  { value: "openai" as const, label: "OpenAI", icon: <OpenAIIcon className="h-3.5 w-3.5" /> },
  { value: "claude" as const, label: "Anthropic", icon: <AnthropicIcon className="h-3.5 w-3.5" /> },
];

const transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
const MIN_PROMPT_LENGTH = 2;

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "unordered_list"; items: string[] }
  | { type: "ordered_list"; items: string[] }
  | { type: "code_block"; language?: string; code: string }
  | { type: "blockquote"; lines: string[] };

const inlineTokenPattern =
  /(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(__(.+?)__)|(\*([^*\n]+)\*)|(_([^_\n]+)_)/g;

function isMarkdownBlockStart(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^```/.test(trimmed) ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed)
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const codeFence = trimmed.match(/^```([\w-]+)?\s*$/);
    if (codeFence) {
      const language = codeFence[1]?.trim() || undefined;
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length) {
        const next = lines[index] ?? "";
        if (next.trim().startsWith("```")) {
          index += 1;
          break;
        }
        codeLines.push(next);
        index += 1;
      }
      blocks.push({ type: "code_block", language, code: codeLines.join("\n") });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const next = (lines[index] ?? "").trim();
        if (!/^>\s?/.test(next)) {
          break;
        }
        quoteLines.push(next.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const next = (lines[index] ?? "").trim();
        if (!/^[-*]\s+/.test(next)) {
          break;
        }
        items.push(next.replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "unordered_list", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const next = (lines[index] ?? "").trim();
        if (!/^\d+\.\s+/.test(next)) {
          break;
        }
        items.push(next.replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ordered_list", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const nextRaw = lines[index] ?? "";
      const nextTrimmed = nextRaw.trim();

      if (nextTrimmed.length === 0 || isMarkdownBlockStart(nextRaw)) {
        break;
      }

      paragraphLines.push(nextRaw);
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraphLines });
  }

  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(inlineTokenPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex));
    }

    if (match[2]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${tokenIndex}`}
          className="rounded bg-ink-950/80 px-1 py-0.5 font-mono text-[12px] text-ink-100"
        >
          {match[2]}
        </code>
      );
    } else if (match[4] && match[5]) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${tokenIndex}`}
          href={match[5]}
          target="_blank"
          rel="noreferrer"
          className="text-ember-300 underline underline-offset-2 hover:text-ember-200"
        >
          {renderInlineMarkdown(match[4], `${keyPrefix}-link-text-${tokenIndex}`)}
        </a>
      );
    } else if (match[7] || match[9]) {
      const value = match[7] ?? match[9] ?? "";
      nodes.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`} className="font-semibold text-ink-100">
          {renderInlineMarkdown(value, `${keyPrefix}-strong-text-${tokenIndex}`)}
        </strong>
      );
    } else if (match[11] || match[13]) {
      const value = match[11] ?? match[13] ?? "";
      nodes.push(
        <em key={`${keyPrefix}-em-${tokenIndex}`} className="italic">
          {renderInlineMarkdown(value, `${keyPrefix}-em-text-${tokenIndex}`)}
        </em>
      );
    }

    cursor = matchIndex + match[0].length;
    tokenIndex += 1;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderInlineMarkdownWithLineBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];

  lines.forEach((line, index) => {
    nodes.push(...renderInlineMarkdown(line, `${keyPrefix}-line-${index}`));
    if (index < lines.length - 1) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    }
  });

  return nodes;
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  if (blocks.length === 0) {
    return <p className="whitespace-pre-wrap break-words text-[13px]">{content}</p>;
  }

  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const headingClass =
            block.level <= 2
              ? "text-sm font-semibold text-ink-100"
              : block.level <= 4
                ? "text-[13px] font-semibold text-ink-100"
                : "text-[13px] font-medium text-ink-100";

          return (
            <p key={`md-heading-${index}`} className={headingClass}>
              {renderInlineMarkdown(block.text, `md-heading-${index}`)}
            </p>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p key={`md-paragraph-${index}`} className="break-words text-[13px]">
              {renderInlineMarkdownWithLineBreaks(block.lines.join("\n"), `md-paragraph-${index}`)}
            </p>
          );
        }

        if (block.type === "unordered_list") {
          return (
            <ul key={`md-ul-${index}`} className="list-disc space-y-1 pl-4">
              {block.items.map((item, itemIndex) => (
                <li key={`md-ul-${index}-item-${itemIndex}`} className="break-words text-[13px]">
                  {renderInlineMarkdown(item, `md-ul-${index}-item-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered_list") {
          return (
            <ol key={`md-ol-${index}`} className="list-decimal space-y-1 pl-4">
              {block.items.map((item, itemIndex) => (
                <li key={`md-ol-${index}-item-${itemIndex}`} className="break-words text-[13px]">
                  {renderInlineMarkdown(item, `md-ol-${index}-item-${itemIndex}`)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote key={`md-quote-${index}`} className="border-l-2 border-ink-600/70 pl-3 text-ink-300">
              {renderInlineMarkdownWithLineBreaks(block.lines.join("\n"), `md-quote-${index}`)}
            </blockquote>
          );
        }

        return (
          <pre
            key={`md-code-${index}`}
            className="overflow-x-auto rounded-lg border border-ink-700/60 bg-ink-950/80 px-2.5 py-2"
          >
            {block.language ? <p className="mb-1 text-[10px] uppercase text-ink-500">{block.language}</p> : null}
            <code className="whitespace-pre font-mono text-[12px] text-ink-100">{block.code}</code>
          </pre>
        );
      })}
    </div>
  );
}

export function AiBuilderPanel({
  workflowKey,
  currentDraft,
  mcpServers,
  onApplyDraft,
  onNotice,
  readOnly = false
}: AiBuilderPanelProps) {
  const [savedSettings] = useState(loadAiBuilderSettings);
  const [providerId, setProviderId] = useState<ProviderId>(savedSettings.providerId);
  const [model, setModel] = useState(savedSettings.model);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(savedSettings.reasoningEffort);
  const [fastMode, setFastMode] = useState(savedSettings.fastMode);
  const [use1MContext, setUse1MContext] = useState(savedSettings.use1MContext);

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [hydratedWorkflowKey, setHydratedWorkflowKey] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitialScrollRef = useRef(false);

  // ── Derived model state ──

  const modelCatalog = useMemo(() => MODEL_CATALOG[providerId] ?? [], [providerId]);

  const selectedModelMeta = useMemo(
    () => modelCatalog.find((entry) => entry.id === model),
    [model, modelCatalog]
  );

  const reasoningOptions = useMemo(
    () => selectedModelMeta?.reasoningEfforts ?? ["minimal", "low", "medium", "high", "xhigh"],
    [selectedModelMeta?.reasoningEfforts]
  );

  // ── Sync effects ──

  useEffect(() => {
    if (modelCatalog.some((entry) => entry.id === model)) return;
    const preferred = getDefaultModelForProvider(providerId);
    const fallback = modelCatalog.some((entry) => entry.id === preferred) ? preferred : modelCatalog[0]?.id ?? preferred;
    setModel(fallback);
  }, [model, modelCatalog, providerId]);

  useEffect(() => {
    if (reasoningOptions.includes(reasoningEffort)) return;
    const fallback = (reasoningOptions.includes("medium") ? "medium" : reasoningOptions[0] ?? "medium") as ReasoningEffort;
    setReasoningEffort(fallback);
  }, [reasoningEffort, reasoningOptions]);

  useEffect(() => {
    if (providerId !== "claude") {
      if (fastMode) setFastMode(false);
      if (use1MContext) setUse1MContext(false);
      return;
    }
    if (selectedModelMeta?.supportsFastMode === false && fastMode) setFastMode(false);
    if (selectedModelMeta?.supports1MContext === false && use1MContext) setUse1MContext(false);
  }, [fastMode, providerId, selectedModelMeta?.supports1MContext, selectedModelMeta?.supportsFastMode, use1MContext]);

  // ── Persist settings ──

  useEffect(() => {
    saveAiBuilderSettings({ providerId, model, reasoningEffort, fastMode, use1MContext });
  }, [providerId, model, reasoningEffort, fastMode, use1MContext]);

  // ── Auto-scroll ──

  useEffect(() => {
    hasInitialScrollRef.current = false;
    setMessages(loadAiChatHistory(workflowKey));
    setHydratedWorkflowKey(workflowKey);
    setPrompt("");
    setGenerating(false);
  }, [workflowKey]);

  useLayoutEffect(() => {
    if (hydratedWorkflowKey !== workflowKey) {
      return;
    }

    const end = messagesEndRef.current;
    if (!end) {
      return;
    }

    end.scrollIntoView({
      behavior: hasInitialScrollRef.current ? "smooth" : "auto",
      block: "end",
    });
    hasInitialScrollRef.current = true;
  }, [generating, hydratedWorkflowKey, messages, workflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey !== workflowKey) {
      return;
    }
    saveAiChatHistory(workflowKey, messages);
  }, [hydratedWorkflowKey, messages, workflowKey]);

  // ── Send handler ──

  const handleSend = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < MIN_PROMPT_LENGTH || generating || readOnly) return;

    const userMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const history = [
      ...messages
        .flatMap((entry) =>
          entry.role === "user" || entry.role === "assistant"
            ? [{ role: entry.role, content: entry.content }]
            : []
        )
        .slice(-20),
      { role: "user" as const, content: trimmed },
    ];
    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setGenerating(true);

    try {
      const result = await generateFlowDraft({
        prompt: trimmed,
        providerId,
        model,
        reasoningEffort,
        fastMode,
        use1MContext,
        history,
        currentDraft,
        availableMcpServers: mcpServers.map((server) => ({
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          transport: server.transport,
          summary: `${server.transport}${server.enabled ? "" : " (disabled)"}`
        }))
      });
      const shouldApplyDraft = result.action === "update_current_flow" || result.action === "replace_flow";
      const nextDraft =
        shouldApplyDraft && result.draft
          ? result.action === "replace_flow"
            ? await autoLayoutPipelineDraftSmart(result.draft)
            : result.draft
          : undefined;

      const assistantContent = result.message.trim().length
        ? result.message.trim()
        : result.action === "answer"
          ? "Answered without changing the flow."
          : result.source === "model"
            ? `Prepared ${nextDraft?.steps.length ?? 0} step(s) and ${nextDraft?.links.length ?? 0} link(s).`
            : `Generated deterministic template: ${result.notes.join(" ")}`;

      const aiMsg: AiChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantContent,
        generatedDraft: nextDraft,
        action: result.action,
        source: result.source,
        notes: result.notes,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);

      if (nextDraft) {
        onApplyDraft(nextDraft);
        onNotice(
          result.action === "replace_flow"
            ? "AI rebuilt the flow from chat."
            : "AI updated the current flow from chat."
        );
      } else {
        onNotice("AI replied in chat.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to process AI chat message";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "error", content: errorMessage, action: "answer", timestamp: Date.now() },
      ]);
      onNotice(errorMessage);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Settings toggle ── */}
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setSettingsOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 border-b border-ink-800/60 px-3 py-2.5 text-xs font-medium transition-colors",
          readOnly ? "text-ink-600 cursor-not-allowed" : "text-ink-400 hover:text-ink-200 cursor-pointer"
        )}
      >
        {providerId === "claude" ? <AnthropicIcon className="h-3.5 w-3.5" /> : <OpenAIIcon className="h-3.5 w-3.5" />}
        <span className="flex-1 text-left truncate">
          {selectedModelMeta?.label ?? model}
          <span className="ml-1.5 text-ink-600">&middot; {reasoningEffort}</span>
        </span>
        <motion.span animate={{ rotate: settingsOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      </button>

      {/* ── Collapsible settings ── */}
      <AnimatePresence initial={false}>
        {settingsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, overflow: "visible" }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={transition}
            className="relative z-10 border-b border-ink-800/60"
          >
            <div className="space-y-3 p-3">
              <div className="space-y-1.5">
                <span className="text-xs text-ink-500">Provider</span>
                <SegmentedControl
                  segments={providerSegments}
                  value={providerId}
                  disabled={readOnly}
                  onValueChange={(v) => setProviderId(v as ProviderId)}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-ink-500">Model</span>
                <Select
                  value={model}
                  disabled={readOnly}
                  onValueChange={setModel}
                  options={modelCatalog.map((entry) => ({ value: entry.id, label: entry.label }))}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-ink-500">Reasoning</span>
                <Select
                  value={reasoningEffort}
                  disabled={readOnly}
                  onValueChange={(v) => setReasoningEffort(v as ReasoningEffort)}
                  options={reasoningOptions.map((mode) => ({ value: mode, label: mode }))}
                />
              </div>

              {providerId === "claude" && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={fastMode}
                      onChange={setFastMode}
                      disabled={readOnly || selectedModelMeta?.supportsFastMode === false}
                    />
                    <span className="text-xs text-ink-300">Fast mode</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={use1MContext}
                      onChange={setUse1MContext}
                      disabled={readOnly || selectedModelMeta?.supports1MContext === false}
                    />
                    <span className="text-xs text-ink-300">1M context</span>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chat messages ── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !generating && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ember-500/10 text-ember-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink-200">AI Flow Builder</p>
            <p className="mt-1 max-w-[260px] text-xs text-ink-500">
              Ask questions about your current flow, request edits, or ask for a fully new rebuild.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            message={msg}
            readOnly={readOnly}
            onApply={msg.generatedDraft ? () => onApplyDraft(msg.generatedDraft!) : undefined}
          />
        ))}

        {generating && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-ember-400" />
            <span className="text-xs text-ink-500">Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ── */}
      <div className="border-t border-ink-800/60 p-3">
        <div className="relative">
          <Textarea
            className="min-h-[80px] pr-12"
            value={prompt}
            disabled={readOnly}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask about the current flow or request updates/rebuild..."
          />
          <button
            type="button"
            disabled={readOnly || generating || prompt.trim().length < MIN_PROMPT_LENGTH}
            onClick={() => void handleSend()}
            className={cn(
              "absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
              prompt.trim().length >= MIN_PROMPT_LENGTH && !generating && !readOnly
                ? "bg-ember-500 text-ink-950 hover:bg-ember-400 cursor-pointer"
                : "bg-ink-800 text-ink-600 cursor-not-allowed"
            )}
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-600">
          Shift+Enter for new line &middot; min 2 characters
        </p>
      </div>
    </div>
  );
}

// ── Chat bubble sub-component ──

interface ChatBubbleProps {
  message: AiChatMessage;
  onApply?: () => void;
  readOnly?: boolean;
}

function ChatBubble({ message, onApply, readOnly = false }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const actionLabel =
    message.action === "answer"
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
            ? "bg-ember-500/15 text-ink-100"
            : isError
              ? "border border-red-500/20 bg-red-500/10 text-red-400"
              : "bg-ink-800/50 text-ink-200"
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

        {message.generatedDraft && onApply && (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="success">{message.generatedDraft.steps.length} steps</Badge>
            <Badge variant="neutral">{message.generatedDraft.links.length} links</Badge>
            <Button size="sm" variant="ghost" disabled={readOnly} onClick={onApply}>
              Re-apply
            </Button>
          </div>
        )}

        <p className="mt-1 text-[10px] text-ink-600">
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </motion.div>
  );
}
