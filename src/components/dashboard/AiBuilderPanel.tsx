import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, MessageSquare, Plus, Route, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { McpServerConfig, PipelinePayload, ProviderConfig, ProviderId, ProviderOAuthStatus } from "@/lib/types";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { OpenAIIcon, AnthropicIcon } from "@/components/optics/icons";
import { Tooltip } from "@/components/optics/tooltip";
import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider } from "@/components/optics/dropdown-menu";
import { cn } from "@/lib/cn";
import { ONE_MILLION_CONTEXT_TOKENS, resolveProviderRuntimeCapabilities } from "@/lib/modelCatalog";
import { toModelSelectOption } from "@/lib/modelLabel";
import {
  getClaude1MContextCapabilityState,
  getClaude1MContextUnavailableNote,
  getClaudeFastModeCapabilityState,
  getClaudeFastModeUnavailableNote,
  getOpenAiFastModeCapabilityState,
  getOpenAiFastModeUnavailableNote
} from "@/lib/providerCapabilities";
import {
  createSession,
  deleteSession,
  deriveSessionTitle,
  loadSessionIndex,
  relativeTimeLabel,
  resolveActiveSession,
  saveActiveSessionId,
  updateSessionTitle,
  updateSessionTimestamp,
  type AiChatSessionEntry,
} from "@/lib/aiChatSessionIndex";
import { PlanPreview } from "@/components/dashboard/ai-builder/PlanPreview";
import { PromptEditor } from "@/components/dashboard/ai-builder/PromptEditor";
import { useAiBuilderSession } from "@/components/dashboard/ai-builder/useAiBuilderSession";
import { usePersistedCollapsed } from "@/components/dashboard/usePersistedCollapsed";

interface AiBuilderPanelProps {
  workflowKey: string;
  currentDraft: PipelinePayload;
  mcpServers: McpServerConfig[];
  providers: Record<ProviderId, ProviderConfig>;
  oauthStatuses: Record<ProviderId, ProviderOAuthStatus | null>;
  openAiFastModeAvailable: boolean;
  openAiFastModeUnavailableNote?: string;
  claudeFastModeAvailable: boolean;
  claudeFastModeUnavailableNote?: string;
  onApplyDraft: (draft: PipelinePayload) => Promise<{ workflowKey?: string } | void>;
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
  providers,
  oauthStatuses,
  openAiFastModeAvailable,
  openAiFastModeUnavailableNote,
  claudeFastModeAvailable,
  claudeFastModeUnavailableNote,
  onApplyDraft,
  onNotice,
  readOnly = false
}: AiBuilderPanelProps) {
  const [settingsOpen, setSettingsOpen] = usePersistedCollapsed("fyreflow:ai-builder-settings-open", false);

  const [sessions, setSessions] = useState<AiChatSessionEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [prevWorkflowKey, setPrevWorkflowKey] = useState("");

  if (workflowKey.trim() && workflowKey !== prevWorkflowKey) {
    setPrevWorkflowKey(workflowKey);
    const resolved = resolveActiveSession(workflowKey);
    setSessions(loadSessionIndex(workflowKey));
    setActiveSessionId(resolved.id);
  }

  const {
    providerId,
    model,
    reasoningEffort,
    fastMode,
    use1MContext,
    generatedStepStrategy,
    allowPremiumModes,
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
    setGeneratedStepStrategy,
    setAllowPremiumModes,
    handleSend,
    handleQuickReply,
    loadOlderMessages,
  } = useAiBuilderSession({
    workflowKey: activeSessionId,
    currentDraft,
    mcpServers,
    providers,
    oauthStatuses,
    openAiFastModeAvailable,
    claudeFastModeAvailable,
    onApplyDraft,
    onNotice,
    mutationLocked: readOnly,
  });

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId]
  );

  useEffect(() => {
    if (!activeSession || activeSession.title !== "New chat" || !workflowKey.trim()) return;
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return;
    updateSessionTitle(workflowKey, activeSessionId, deriveSessionTitle(firstUserMsg.content));
    setSessions(loadSessionIndex(workflowKey));
  }, [activeSession, activeSessionId, messages, workflowKey]);

  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (!activeSessionId || !workflowKey.trim() || messages.length === 0) return;
    if (messages.length !== prevMessageCountRef.current) {
      prevMessageCountRef.current = messages.length;
      updateSessionTimestamp(workflowKey, activeSessionId);
    }
  }, [messages.length, activeSessionId, workflowKey]);

  const handleNewChat = useCallback(() => {
    if (generating || !workflowKey.trim()) return;
    const entry = createSession(workflowKey);
    setSessions(loadSessionIndex(workflowKey));
    setActiveSessionId(entry.id);
  }, [generating, workflowKey]);

  const handleSwitchSession = useCallback((sessionId: string) => {
    if (generating || sessionId === activeSessionId || !workflowKey.trim()) return;
    saveActiveSessionId(workflowKey, sessionId);
    setActiveSessionId(sessionId);
  }, [activeSessionId, generating, workflowKey]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (generating || !workflowKey.trim()) return;
    deleteSession(workflowKey, sessionId);
    if (sessionId === activeSessionId) {
      const remaining = loadSessionIndex(workflowKey);
      if (remaining.length > 0) {
        const sorted = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
        setActiveSessionId(sorted[0].id);
        saveActiveSessionId(workflowKey, sorted[0].id);
      } else {
        const entry = createSession(workflowKey);
        setActiveSessionId(entry.id);
      }
    }
    setSessions(loadSessionIndex(workflowKey));
  }, [activeSessionId, generating, workflowKey]);

  const providerFastModeAvailable = providerId === "openai" ? openAiFastModeAvailable : claudeFastModeAvailable;
  const openAiApiCapable = resolveProviderRuntimeCapabilities(
    providers.openai,
    oauthStatuses.openai
  ).hasActiveApiCredential;
  const fastModeCapabilityState =
    providerId === "openai"
      ? getOpenAiFastModeCapabilityState(providers.openai, model)
      : getClaudeFastModeCapabilityState(providers.claude, model, oauthStatuses.claude);
  const context1MCapabilityState =
    providerId === "claude"
      ? getClaude1MContextCapabilityState(providers.claude, model, oauthStatuses.claude)
      : "confirmed";
  const providerFastModeUnavailableNote =
    providerId === "openai"
      ? getOpenAiFastModeUnavailableNote(providers.openai, model) || openAiFastModeUnavailableNote
      : getClaudeFastModeUnavailableNote(providers.claude, model, oauthStatuses.claude) || claudeFastModeUnavailableNote;
  const claude1MContextNote = getClaude1MContextUnavailableNote(providers.claude, model, oauthStatuses.claude);
  const showFastMode = selectedModelMeta?.supportsFastMode === true;
  const modelUsesDefault1MContext = (selectedModelMeta?.contextWindowTokens ?? 0) >= ONE_MILLION_CONTEXT_TOKENS;
  const show1MContext = modelUsesDefault1MContext || selectedModelMeta?.supports1MContext === true;
  const handleFastModeToggle = (checked: boolean) => {
    if (!checked) {
      setFastMode(false);
      return;
    }

    if (
      providerId === "claude" &&
      !window.confirm(
        "Enable Claude fast mode for this builder session? This is Opus 4.6-only, premium-priced, and best for interactive work rather than autonomous flow execution."
      )
    ) {
      return;
    }

    setFastMode(true);
  };
  const handle1MContextToggle = (checked: boolean) => {
    if (!checked) {
      setUse1MContext(false);
      return;
    }

    if (
      providerId === "claude" &&
      !window.confirm(
        "Enable Claude 1M context for this builder session? This beta can require Extra Usage and is unavailable on OAuth-authenticated Anthropic API paths."
      )
    ) {
      return;
    }

    setUse1MContext(true);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitialScrollRef = useRef(false);
  const latestMessageId = messages[messages.length - 1]?.id ?? "";

  useLayoutEffect(() => {
    if (hydratedWorkflowKey !== activeSessionId) {
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
  }, [generating, hydratedWorkflowKey, latestMessageId, activeSessionId]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-ink-800/60">
        <button
          type="button"
          data-testid="ai-builder-settings-toggle"
          disabled={readOnly}
          onClick={() => setSettingsOpen((v) => !v)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors",
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

        <div className="mr-2 flex items-center gap-0.5">
          {sessions.length > 1 && (
            <DropdownMenu
              align="right"
              trigger={
                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-ink-600 transition-colors hover:bg-ink-800/60 hover:text-ink-300 cursor-pointer"
                  aria-label="Chat history"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
              }
            >
              <div className="w-64 max-h-72 overflow-y-auto">
                {sortedSessions.map((session) => (
                  <DropdownMenuItem
                    key={session.id}
                    icon={
                      session.id === activeSessionId
                        ? <Check className="h-3.5 w-3.5 text-ember-400" />
                        : <MessageSquare className="h-3.5 w-3.5 opacity-0" />
                    }
                    label={session.title}
                    description={relativeTimeLabel(session.updatedAt)}
                    onClick={() => handleSwitchSession(session.id)}
                  />
                ))}
                {sessions.length > 1 && (
                  <>
                    <DropdownMenuDivider />
                    <DropdownMenuItem
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      label="Delete current chat"
                      danger
                      onClick={() => handleDeleteSession(activeSessionId)}
                    />
                  </>
                )}
              </div>
            </DropdownMenu>
          )}

          <Tooltip content="New chat" side="bottom">
            <button
              type="button"
              onClick={handleNewChat}
              disabled={generating || readOnly}
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors",
                generating || readOnly
                  ? "text-ink-700 cursor-not-allowed"
                  : "text-ink-600 hover:bg-ink-800/60 hover:text-ink-300 cursor-pointer"
              )}
              aria-label="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {settingsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, overflow: "visible" }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={transition}
            className="relative z-10 border-b border-ink-800/60"
          >
            <div
              data-testid="ai-builder-settings-scroll"
              className="max-h-[min(32rem,calc(100vh-11rem))] overflow-y-auto overscroll-contain p-3"
            >
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  {providerId === "claude" ? <AnthropicIcon className="h-3.5 w-3.5" /> : <OpenAIIcon className="h-3.5 w-3.5" />}
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Builder Model</span>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Provider</span>
                  <SegmentedControl
                    segments={providerSegments}
                    value={providerId}
                    disabled={readOnly}
                    onValueChange={(v) => setProviderId(v as "openai" | "claude")}
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Model</span>
                  <Select
                    value={model}
                    disabled={readOnly}
                    onValueChange={setModel}
                    options={modelCatalog.map(toModelSelectOption)}
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Reasoning</span>
                  <Select
                    value={reasoningEffort}
                    disabled={readOnly}
                    onValueChange={(v) => setReasoningEffort(v as typeof reasoningEffort)}
                    options={reasoningOptions.map((mode) => ({ value: mode, label: mode }))}
                  />
                </label>

                {(showFastMode || show1MContext) && (
                  <div className="space-y-2">
                    {showFastMode ? (
                      <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-ink-200">
                              {providerId === "claude" ? "Fast mode (Opus 4.6 only, premium)" : "Fast mode"}
                            </p>
                            <p className="mt-0.5 text-[11px] text-ink-500">
                              {providerId === "openai"
                                ? 'Priority processing for API runs. Codex CLI fallback requests `service_tier="fast"`.'
                                : "Premium, best-effort speed mode for interactive Claude Opus 4.6 sessions."}
                            </p>
                            {providerFastModeUnavailableNote ? (
                              <p className={cn(
                                "mt-1 text-[11px]",
                                fastModeCapabilityState === "maybe" ? "text-amber-400" : "text-ink-600"
                              )}>
                                {providerFastModeUnavailableNote}
                              </p>
                            ) : null}
                          </div>
                          <Switch
                            checked={fastMode}
                            onChange={handleFastModeToggle}
                            disabled={readOnly || !providerFastModeAvailable}
                          />
                        </div>
                      </div>
                    ) : null}

                    {show1MContext ? (
                      <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-ink-200">
                              {modelUsesDefault1MContext ? "1M context included" : "1M context"}
                            </p>
                            <p className="mt-0.5 text-[11px] text-ink-500">
                              {providerId === "openai"
                                ? "GPT-5.4 already includes the large context window; use compaction before forcing more history into the prompt."
                                : "Beta large-context mode for repo-scale prompts and oversized transcripts."}
                            </p>
                            {providerId === "claude" ? (
                              <p className={cn(
                                "mt-1 text-[11px]",
                                context1MCapabilityState === "maybe" ? "text-amber-400" : "text-ink-600"
                              )}>
                                {claude1MContextNote}
                              </p>
                            ) : null}
                          </div>
                          <Switch
                            checked={modelUsesDefault1MContext || use1MContext}
                            onChange={handle1MContextToggle}
                            disabled={
                              readOnly ||
                              modelUsesDefault1MContext ||
                              selectedModelMeta?.supports1MContext === false ||
                              (providerId === "claude" && context1MCapabilityState === "unavailable")
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="rounded-lg border border-ink-800/50 bg-ink-950/40 px-3 py-2.5 text-[11px] text-ink-500">
                  Builder premium toggles apply only to this planning session. Generated steps start in standard mode unless
                  you explicitly enable premium review routing below.
                </div>
              </section>

              <div className="my-5 h-px bg-ink-800/60" />

              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <Route className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Generated Steps</span>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Routing strategy</span>
                  <SegmentedControl
                    segments={[
                      { value: "openai-first", label: "OpenAI first" },
                      { value: "balanced", label: "Balanced" },
                      { value: "anthropic-first", label: "Anthropic first" }
                    ]}
                    value={generatedStepStrategy}
                    disabled={readOnly}
                    onValueChange={(value) => setGeneratedStepStrategy(value as typeof generatedStepStrategy)}
                  />
                </label>

                <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink-200">Premium review step</p>
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        Route review and final-auditor steps to `gpt-5.4-pro` only when an API-capable OpenAI path exists.
                      </p>
                      {!openAiApiCapable ? (
                        <p className="mt-1 text-[11px] text-amber-400">
                          Save an OpenAI API key or verify OpenAI OAuth API access before enabling this.
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      checked={allowPremiumModes}
                      onChange={setAllowPremiumModes}
                      disabled={readOnly || !openAiApiCapable}
                    />
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 px-3 py-2 text-xs text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Generated steps do not inherit builder fast mode or Claude 1M toggles. Use the routing policy here for
                  default execution, then enable step-level premium settings only when you mean to pay for them.
                </div>
              </section>
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
