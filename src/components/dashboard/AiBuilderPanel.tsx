import { useLayoutEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { McpServerConfig, PipelinePayload } from "@/lib/types";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { OpenAIIcon, AnthropicIcon } from "@/components/optics/icons";
import { cn } from "@/lib/cn";
import { PlanPreview } from "@/components/dashboard/ai-builder/PlanPreview";
import { PromptEditor } from "@/components/dashboard/ai-builder/PromptEditor";
import { useAiBuilderSession } from "@/components/dashboard/ai-builder/useAiBuilderSession";
import { usePersistedCollapsed } from "@/components/dashboard/usePersistedCollapsed";

interface AiBuilderPanelProps {
  workflowKey: string;
  currentDraft: PipelinePayload;
  mcpServers: McpServerConfig[];
  claudeFastModeAvailable: boolean;
  claudeFastModeUnavailableNote?: string;
  onApplyDraft: (draft: PipelinePayload) => void;
  onNotice: (message: string) => void;
  readOnly?: boolean;
}

const providerSegments = [
  { value: "openai" as const, label: "OpenAI", icon: <OpenAIIcon className="h-3.5 w-3.5" /> },
  { value: "claude" as const, label: "Anthropic", icon: <AnthropicIcon className="h-3.5 w-3.5" /> },
];

const transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };

export function AiBuilderPanel({
  workflowKey,
  currentDraft,
  mcpServers,
  claudeFastModeAvailable,
  claudeFastModeUnavailableNote,
  onApplyDraft,
  onNotice,
  readOnly = false
}: AiBuilderPanelProps) {
  const [settingsOpen, setSettingsOpen] = usePersistedCollapsed("fyreflow:ai-builder-settings-open", false);

  const {
    providerId,
    model,
    reasoningEffort,
    fastMode,
    use1MContext,
    modelCatalog,
    selectedModelMeta,
    reasoningOptions,
    messages,
    hasOlderMessages,
    loadingOlderMessages,
    hydratedWorkflowKey,
    prompt,
    effectiveMode,
    generating,
    setPrompt,
    setMode,
    setProviderId,
    setModel,
    setReasoningEffort,
    setFastMode,
    setUse1MContext,
    handleSend,
    handleQuickReply,
    loadOlderMessages,
  } = useAiBuilderSession({
    workflowKey,
    currentDraft,
    mcpServers,
    claudeFastModeAvailable,
    onApplyDraft,
    onNotice,
    mutationLocked: readOnly,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitialScrollRef = useRef(false);
  const latestMessageId = messages[messages.length - 1]?.id ?? "";

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
  }, [generating, hydratedWorkflowKey, latestMessageId, workflowKey]);

  return (
    <div className="flex h-full flex-col">
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
                  onValueChange={(v) => setProviderId(v as "openai" | "claude")}
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
                  onValueChange={(v) => setReasoningEffort(v as typeof reasoningEffort)}
                  options={reasoningOptions.map((mode) => ({ value: mode, label: mode }))}
                />
              </div>

              {providerId === "claude" && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={fastMode}
                      onChange={setFastMode}
                      disabled={
                        readOnly ||
                        selectedModelMeta?.supportsFastMode === false ||
                        !claudeFastModeAvailable
                      }
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

              {providerId === "claude" && !claudeFastModeAvailable ? (
                <p className="text-[11px] text-amber-400">
                  {claudeFastModeUnavailableNote ?? "Fast mode requires an active Claude API key in Provider Auth."}
                </p>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PlanPreview
        messages={messages}
        generating={generating}
        hasOlderMessages={hasOlderMessages}
        loadingOlderMessages={loadingOlderMessages}
        readOnly={readOnly}
        messagesEndRef={messagesEndRef}
        onApplyDraft={onApplyDraft}
        onQuickReply={handleQuickReply}
        onLoadOlderMessages={loadOlderMessages}
      />

      <PromptEditor
        prompt={prompt}
        composerDisabled={false}
        generating={generating}
        mode={effectiveMode}
        modeLocked={readOnly}
        onPromptChange={setPrompt}
        onModeChange={setMode}
        onSend={handleSend}
      />
    </div>
  );
}
