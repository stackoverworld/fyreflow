import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction, type Dispatch } from "react";
import {
  MODEL_CATALOG,
  getSelectableModelsForProvider,
  getDefaultModelForProvider,
  resolve1MContextEnabled,
  resolveProviderRuntimeCapabilities
} from "@/lib/modelCatalog";
import { generateFlowDraft, generateFlowDraftStream } from "@/lib/api";
import {
  clearAiChatPendingRequest,
  clearAiChatSession,
  loadAiChatDraft,
  loadAiChatHistory,
  loadAiChatHistoryPage,
  loadAiChatPending,
  loadAiChatPendingRequest,
  saveAiChatDraft,
  saveAiChatHistory,
  saveAiChatPending,
  saveAiChatPendingRequest,
  subscribeAiChatLifecycle
} from "@/lib/aiChatStorage";
import { appendAiChatDebugEvent } from "@/lib/aiChatDebugStorage";
import { autoLayoutPipelineDraftSmart } from "@/lib/flowLayout";
import { clonePipelinePayload } from "@/lib/pipelineDraft";
import { hasAssistantResultForRequest, hasErrorResultForRequest } from "@/components/dashboard/ai-builder/requestDedup";
import { executeFlowBuilderRequestOnce } from "@/components/dashboard/ai-builder/requestExecutionRegistry";
import { clipFlowBuilderHistoryContent, toFlowBuilderHistoryMessage } from "@/components/dashboard/ai-builder/history";
import {
  resolveCommittedAssistantContent,
  resolveCompletedAssistantMessage,
  shouldRevealAssistantTextDuringGeneration
} from "@/components/dashboard/ai-builder/resultVisibility";
import {
  FLOW_BUILDER_PROMPT_MAX_CHARS,
  FLOW_BUILDER_PROMPT_MIN_CHARS,
  getFlowBuilderPromptLength,
  isFlowBuilderPromptTooLong,
  normalizeFlowBuilderPrompt
} from "@/components/dashboard/ai-builder/promptValidation";
import {
  ASK_MODE_MUTATION_BLOCK_MESSAGE,
  ASK_MODE_MUTATION_BLOCK_NOTICE,
  DEFAULT_AI_BUILDER_MODE,
  canSendPromptToFlowMutationEndpoint,
  resolveAiBuilderMode,
  type AiBuilderMode
} from "@/components/dashboard/ai-builder/mode";
import type {
  AiChatMessage,
  FlowBuilderAction,
  FlowBuilderGeneratedStepStrategy,
  FlowBuilderRequest,
  FlowBuilderResponse,
  McpServerConfig,
  PipelinePayload,
  ProviderConfig,
  ProviderId,
  ProviderOAuthStatus,
  ReasoningEffort
} from "@/lib/types";

const AI_SETTINGS_KEY = "fyreflow:ai-builder-settings";
const MAX_FLOW_BUILDER_MCP_SERVERS = 40;
const MAX_FLOW_BUILDER_HISTORY_CHARS = 120_000;
const AI_BUILDER_MESSAGES_PAGE_SIZE = 30;

interface AiBuilderSettings {
  providerId: ProviderId;
  model: string;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  use1MContext: boolean;
  generatedStepStrategy: FlowBuilderGeneratedStepStrategy;
  allowPremiumModes: boolean;
  mode: AiBuilderMode;
}

export const DEFAULT_AI_BUILDER_SETTINGS: AiBuilderSettings = {
  providerId: "openai",
  model: "gpt-5.4",
  reasoningEffort: "medium",
  fastMode: false,
  use1MContext: false,
  generatedStepStrategy: "openai-first",
  allowPremiumModes: false,
  mode: DEFAULT_AI_BUILDER_MODE,
};

export function normalizeAiBuilderSettings(raw: unknown): AiBuilderSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return DEFAULT_AI_BUILDER_SETTINGS;
  }

  const parsed = raw as Record<string, unknown>;
  const normalized: AiBuilderSettings = {
    providerId:
      parsed.providerId === "openai" || parsed.providerId === "claude"
        ? parsed.providerId
        : DEFAULT_AI_BUILDER_SETTINGS.providerId,
    model: typeof parsed.model === "string" ? parsed.model : DEFAULT_AI_BUILDER_SETTINGS.model,
    reasoningEffort: ["minimal", "low", "medium", "high", "xhigh"].includes(parsed.reasoningEffort as string)
      ? (parsed.reasoningEffort as ReasoningEffort)
      : DEFAULT_AI_BUILDER_SETTINGS.reasoningEffort,
    fastMode: typeof parsed.fastMode === "boolean" ? parsed.fastMode : DEFAULT_AI_BUILDER_SETTINGS.fastMode,
    use1MContext:
      typeof parsed.use1MContext === "boolean" ? parsed.use1MContext : DEFAULT_AI_BUILDER_SETTINGS.use1MContext,
    generatedStepStrategy:
      parsed.generatedStepStrategy === "anthropic-first" ||
      parsed.generatedStepStrategy === "balanced" ||
      parsed.generatedStepStrategy === "openai-first"
        ? parsed.generatedStepStrategy
        : DEFAULT_AI_BUILDER_SETTINGS.generatedStepStrategy,
    allowPremiumModes:
      typeof parsed.allowPremiumModes === "boolean"
        ? parsed.allowPremiumModes
        : DEFAULT_AI_BUILDER_SETTINGS.allowPremiumModes,
    mode: parsed.mode === "agent" || parsed.mode === "ask" ? parsed.mode : DEFAULT_AI_BUILDER_SETTINGS.mode,
  };

  return normalized;
}

function loadAiBuilderSettings(): AiBuilderSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return DEFAULT_AI_BUILDER_SETTINGS;
    const parsed = JSON.parse(raw);
    return normalizeAiBuilderSettings(parsed);
  } catch {
    return DEFAULT_AI_BUILDER_SETTINGS;
  }
}

function saveAiBuilderSettings(settings: AiBuilderSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
  }
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ai-chat-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export const MIN_PROMPT_LENGTH = FLOW_BUILDER_PROMPT_MIN_CHARS;
export const MAX_PROMPT_LENGTH = FLOW_BUILDER_PROMPT_MAX_CHARS;

interface UseAiBuilderSessionOptions {
  workflowKey: string;
  currentDraft: PipelinePayload;
  mcpServers: McpServerConfig[];
  providers: Record<ProviderId, ProviderConfig>;
  oauthStatuses: Record<ProviderId, ProviderOAuthStatus | null>;
  openAiFastModeAvailable: boolean;
  claudeFastModeAvailable: boolean;
  onApplyDraft: (draft: PipelinePayload) => Promise<{ workflowKey?: string } | void>;
  onNotice: (message: string) => void;
  mutationLocked?: boolean;
}

interface UseAiBuilderSessionState {
  providerId: ProviderId;
  model: string;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  use1MContext: boolean;
  generatedStepStrategy: FlowBuilderGeneratedStepStrategy;
  allowPremiumModes: boolean;
  modelCatalog: typeof MODEL_CATALOG[ProviderId];
  selectedModelMeta: (typeof MODEL_CATALOG[ProviderId])[number] | undefined;
  reasoningOptions: ReasoningEffort[];
  messages: AiChatMessage[];
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  hydratedWorkflowKey: string;
  prompt: string;
  mode: AiBuilderMode;
  effectiveMode: AiBuilderMode;
  generating: boolean;
  setPrompt: Dispatch<SetStateAction<string>>;
  setMode: Dispatch<SetStateAction<AiBuilderMode>>;
  setProviderId: Dispatch<SetStateAction<ProviderId>>;
  setModel: Dispatch<SetStateAction<string>>;
  setReasoningEffort: Dispatch<SetStateAction<ReasoningEffort>>;
  setFastMode: Dispatch<SetStateAction<boolean>>;
  setUse1MContext: Dispatch<SetStateAction<boolean>>;
  setGeneratedStepStrategy: Dispatch<SetStateAction<FlowBuilderGeneratedStepStrategy>>;
  setAllowPremiumModes: Dispatch<SetStateAction<boolean>>;
  handleSend: () => Promise<void>;
  handleQuickReply: (value: string) => Promise<void>;
  handleClearChat: () => void;
  loadOlderMessages: () => boolean;
}

interface ExecuteFlowBuilderRequestOptions {
  requestId: string;
  payload: FlowBuilderRequest;
  startedAt: number;
  mode: AiBuilderMode;
  resumed: boolean;
}

export function useAiBuilderSession({
  workflowKey,
  currentDraft,
  mcpServers,
  providers,
  oauthStatuses,
  openAiFastModeAvailable,
  claudeFastModeAvailable,
  onApplyDraft,
  onNotice,
  mutationLocked = false,
}: UseAiBuilderSessionOptions): UseAiBuilderSessionState {
  const [savedSettings] = useState(loadAiBuilderSettings);
  const [providerId, setProviderId] = useState<ProviderId>(savedSettings.providerId);
  const [model, setModel] = useState(savedSettings.model);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(savedSettings.reasoningEffort);
  const [fastMode, setFastMode] = useState(savedSettings.fastMode);
  const [use1MContext, setUse1MContext] = useState(savedSettings.use1MContext);
  const [generatedStepStrategy, setGeneratedStepStrategy] = useState<FlowBuilderGeneratedStepStrategy>(
    savedSettings.generatedStepStrategy
  );
  const [allowPremiumModes, setAllowPremiumModes] = useState(savedSettings.allowPremiumModes);
  const [mode, setMode] = useState<AiBuilderMode>(savedSettings.mode);

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hydratedWorkflowKey, setHydratedWorkflowKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const visibleMessageCountRef = useRef(0);
  const loadingOlderMessagesRef = useRef(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const hydratedWorkflowKeyRef = useRef("");
  const deferredWorkflowKeyRef = useRef<string | null>(null);
  const effectiveMode = resolveAiBuilderMode(mode, mutationLocked);

  const modelCatalog = useMemo(
    () =>
      getSelectableModelsForProvider(providerId, {
        provider: providers[providerId],
        oauthStatus: oauthStatuses[providerId]
      }),
    [oauthStatuses, providerId, providers]
  );

  const selectedModelMeta = useMemo(
    () => modelCatalog.find((entry) => entry.id === model),
    [model, modelCatalog]
  );

  const reasoningOptions = useMemo(
    (): ReasoningEffort[] => {
      const fallback: ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
      const values = selectedModelMeta?.reasoningEfforts;
      if (!Array.isArray(values) || values.length === 0) {
        return fallback;
      }

      const normalized = values.filter(
        (value): value is ReasoningEffort =>
          value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
      );
      return normalized.length > 0 ? normalized : fallback;
    },
    [selectedModelMeta?.reasoningEfforts]
  );

  const appendVisibleMessages = useCallback((nextMessages: AiChatMessage[]) => {
    if (nextMessages.length === 0) {
      return;
    }

    setMessages((current) => {
      const existingIds = new Set(current.map((entry) => entry.id));
      const deduped: AiChatMessage[] = [];

      for (const nextMessage of nextMessages) {
        if (existingIds.has(nextMessage.id)) {
          continue;
        }
        existingIds.add(nextMessage.id);
        deduped.push(nextMessage);
      }

      if (deduped.length === 0) {
        return current;
      }

      return [...current, ...deduped];
    });
  }, []);

  useEffect(() => {
    visibleMessageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    hydratedWorkflowKeyRef.current = hydratedWorkflowKey;
  }, [hydratedWorkflowKey]);

  useEffect(() => {
    if (modelCatalog.some((entry) => entry.id === model)) return;
    const preferred = getDefaultModelForProvider(providerId);
    const fallback =
      modelCatalog.some((entry) => entry.id === preferred) ? preferred : modelCatalog[0]?.id ?? preferred;
    setModel(fallback);
  }, [model, modelCatalog, providerId]);

  useEffect(() => {
    if (reasoningOptions.includes(reasoningEffort)) return;
    const fallback =
      (reasoningOptions.includes("medium") ? "medium" : reasoningOptions[0] ?? "medium") as ReasoningEffort;
    setReasoningEffort(fallback);
  }, [reasoningEffort, reasoningOptions]);

  useEffect(() => {
    const providerFastModeAvailable = providerId === "openai" ? openAiFastModeAvailable : claudeFastModeAvailable;
    if (!providerFastModeAvailable && fastMode) {
      setFastMode(false);
    }
    if (selectedModelMeta?.supportsFastMode === false && fastMode) {
      setFastMode(false);
    }
    const effectiveUse1MContext = resolve1MContextEnabled(providerId, model, use1MContext);
    if (!effectiveUse1MContext && use1MContext) {
      setUse1MContext(false);
    }
  }, [
    openAiFastModeAvailable,
    claudeFastModeAvailable,
    fastMode,
    model,
    providerId,
    selectedModelMeta?.supports1MContext,
    selectedModelMeta?.supportsFastMode,
    use1MContext,
  ]);

  useEffect(() => {
    saveAiBuilderSettings({
      providerId,
      model,
      reasoningEffort,
      fastMode,
      use1MContext,
      generatedStepStrategy,
      allowPremiumModes,
      mode
    });
  }, [providerId, model, reasoningEffort, fastMode, use1MContext, generatedStepStrategy, allowPremiumModes, mode]);

  const hydrateWorkflowSession = useCallback((nextWorkflowKey: string) => {
    const initialPage = loadAiChatHistoryPage(nextWorkflowKey, {
      limit: AI_BUILDER_MESSAGES_PAGE_SIZE,
      offset: 0
    });
    setMessages(initialPage.messages);
    setHasOlderMessages(initialPage.hasMore);
    loadingOlderMessagesRef.current = false;
    setLoadingOlderMessages(false);
    setHydratedWorkflowKey(nextWorkflowKey);
    setPrompt(loadAiChatDraft(nextWorkflowKey));
    activeRequestIdRef.current = null;
    setGenerating(loadAiChatPending(nextWorkflowKey));
  }, []);

  useEffect(() => {
    if (workflowKey.trim().length === 0 || hydratedWorkflowKey === workflowKey) {
      return;
    }

    if (activeRequestIdRef.current) {
      deferredWorkflowKeyRef.current = workflowKey;
      return;
    }

    deferredWorkflowKeyRef.current = null;
    hydrateWorkflowSession(workflowKey);
  }, [hydrateWorkflowSession, hydratedWorkflowKey, workflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey.trim().length === 0) {
      return;
    }

    return subscribeAiChatLifecycle(hydratedWorkflowKey, () => {
      const refreshedPage = loadAiChatHistoryPage(hydratedWorkflowKey, {
        limit: Math.max(AI_BUILDER_MESSAGES_PAGE_SIZE, visibleMessageCountRef.current),
        offset: 0
      });
      setMessages(refreshedPage.messages);
      setHasOlderMessages(refreshedPage.hasMore);
      setGenerating(loadAiChatPending(hydratedWorkflowKey));
    });
  }, [hydratedWorkflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey.trim().length === 0) {
      return;
    }
    saveAiChatDraft(hydratedWorkflowKey, prompt);
  }, [hydratedWorkflowKey, prompt]);

  const loadOlderMessages = useCallback((): boolean => {
    if (hydratedWorkflowKey !== workflowKey || loadingOlderMessagesRef.current || !hasOlderMessages) {
      return false;
    }

    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);

    try {
      const nextPage = loadAiChatHistoryPage(workflowKey, {
        offset: visibleMessageCountRef.current,
        limit: AI_BUILDER_MESSAGES_PAGE_SIZE
      });

      setHasOlderMessages(nextPage.hasMore);
      if (nextPage.messages.length === 0) {
        return false;
      }

      let addedCount = 0;
      setMessages((current) => {
        const existingIds = new Set(current.map((entry) => entry.id));
        const olderMessages = nextPage.messages.filter((entry) => !existingIds.has(entry.id));
        if (olderMessages.length === 0) {
          return current;
        }
        addedCount = olderMessages.length;
        return [...olderMessages, ...current];
      });

      if (addedCount === 0) {
        return false;
      }
      visibleMessageCountRef.current += addedCount;
      return true;
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [hasOlderMessages, hydratedWorkflowKey, workflowKey]);

  const streamingBufferRef = useRef("");
  const streamingRevealedRef = useRef(0);
  const streamingRafRef = useRef<number | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingHasModelTextRef = useRef(false);
  const streamingDoneRef = useRef(false);
  const streamingResolveRef = useRef<(() => void) | null>(null);

  const CHARS_PER_SECOND = 80;
  const streamingLastFrameRef = useRef(0);

  useEffect(() => {
    return () => {
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
    };
  }, []);

  const advanceStreamingReveal = useCallback((now: number) => {
    streamingRafRef.current = null;
    const msgId = streamingMessageIdRef.current;
    if (!msgId) return;

    const buffer = streamingBufferRef.current;
    const revealed = streamingRevealedRef.current;

    if (revealed >= buffer.length) {
      if (streamingDoneRef.current && streamingResolveRef.current) {
        streamingResolveRef.current();
        streamingResolveRef.current = null;
      }
      return;
    }

    const elapsed = now - streamingLastFrameRef.current;
    streamingLastFrameRef.current = now;

    const charsBudget = streamingDoneRef.current
      ? Math.max(4, Math.ceil((buffer.length - revealed) / 6))
      : Math.max(1, Math.round((CHARS_PER_SECOND * elapsed) / 1000));

    let nextRevealed = Math.min(buffer.length, revealed + charsBudget);

    if (!streamingDoneRef.current && nextRevealed < buffer.length) {
      const spaceAfter = buffer.indexOf(" ", nextRevealed);
      if (spaceAfter !== -1 && spaceAfter - nextRevealed < 6) {
        nextRevealed = spaceAfter + 1;
      }
    }

    streamingRevealedRef.current = nextRevealed;
    const displayContent = buffer.slice(0, nextRevealed);

    setMessages((current) => {
      const idx = current.findIndex((msg) => msg.id === msgId);
      if (idx === -1 || current[idx].content === displayContent) return current;
      const next = [...current];
      next[idx] = { ...current[idx], content: displayContent };
      return next;
    });

    streamingRafRef.current = requestAnimationFrame(advanceStreamingReveal);
  }, []);

  const scheduleStreamingFlush = useCallback(() => {
    if (streamingRafRef.current !== null) return;
    streamingLastFrameRef.current = performance.now();
    streamingRafRef.current = requestAnimationFrame(advanceStreamingReveal);
  }, [advanceStreamingReveal]);

  const processCompletedResult = useCallback(
    async (
      result: FlowBuilderResponse,
      messageId: string,
      requestId: string,
      requestMode: AiBuilderMode,
      startedAt: number,
      resumed: boolean,
      insertMode: "update_existing" | "append_new"
    ) => {
      const sessionWorkflowKey = hydratedWorkflowKeyRef.current || workflowKey;
      const mutationAction = result.action === "update_current_flow" || result.action === "replace_flow";
      const mutationSuppressedByAskMode = requestMode === "ask" && mutationAction;
      const responseAction: FlowBuilderAction = mutationSuppressedByAskMode ? "answer" : result.action;
      const shouldApplyDraft = mutationAction && !mutationSuppressedByAskMode;
      const intendedDraftSnapshot = mutationAction && result.draft ? clonePipelinePayload(result.draft) : undefined;
      const nextDraft =
        shouldApplyDraft && result.draft
          ? result.action === "replace_flow"
            ? await autoLayoutPipelineDraftSmart(result.draft)
            : result.draft
          : undefined;
      const generatedDraftSnapshot = nextDraft ? clonePipelinePayload(nextDraft) : undefined;

      const baseAssistantContent = result.message.trim().length
        ? result.message.trim()
        : responseAction === "answer"
          ? "Answered without changing the flow."
          : result.source === "model"
            ? `Prepared ${nextDraft?.steps.length ?? 0} step(s) and ${nextDraft?.links.length ?? 0} link(s).`
            : `Generated deterministic template: ${result.notes.join(" ")}`;
      const assistantContent = resolveCompletedAssistantMessage(
        result.action,
        responseAction,
        baseAssistantContent,
        {
          appliedDraft: generatedDraftSnapshot,
          intendedDraft: intendedDraftSnapshot,
          mutationSuppressedByAskMode
        }
      );

      const resolvedNotes = mutationSuppressedByAskMode
        ? [...result.notes, "Ask mode kept the response read-only; flow mutation output was ignored."]
        : result.notes;

      if (generatedDraftSnapshot) {
        try {
          const applyResult = await onApplyDraft(clonePipelinePayload(generatedDraftSnapshot));
          void applyResult;
        } catch (error) {
          const errorMessage =
            error instanceof Error && error.message.trim().length > 0
              ? error.message.trim()
              : "Failed to save AI-generated flow.";
          const latestMessages = loadAiChatHistory(sessionWorkflowKey);
          if (
            hasAssistantResultForRequest(latestMessages, requestId) ||
            hasErrorResultForRequest(latestMessages, requestId)
          ) {
            appendAiChatDebugEvent(sessionWorkflowKey, {
              level: "info",
              event: "request_duplicate_ignored",
              message: "Ignored duplicate AI Builder persistence failure for request",
              meta: { requestId, mode: requestMode, resumed, reason: "terminal_result_already_recorded" }
            });
            return;
          }

          appendAiChatDebugEvent(sessionWorkflowKey, {
            level: "error",
            event: "request_error",
            message: "AI Builder flow save failed",
            meta: { requestId, resumed, mode: requestMode, action: result.action },
            details: errorMessage
          });

          const errorMessageEntry: AiChatMessage = {
            id: crypto.randomUUID(),
            requestId,
            role: "error",
            content: errorMessage,
            action: "answer",
            timestamp: Date.now(),
          };

          if (insertMode === "update_existing") {
            setMessages((current) => current.filter((msg) => msg.id !== messageId));
          }

          appendVisibleMessages([errorMessageEntry]);
          saveAiChatHistory(sessionWorkflowKey, [...latestMessages, errorMessageEntry]);
          onNotice(errorMessage);
          return;
        }
      }

      const aiMsg: AiChatMessage = {
        id: messageId,
        requestId,
        role: "assistant",
        content: assistantContent,
        generatedDraft: generatedDraftSnapshot,
        action: responseAction,
        questions: result.questions,
        source: result.source,
        notes: resolvedNotes,
        timestamp: Date.now(),
      };

      if (insertMode === "update_existing") {
        setMessages((current) => {
          let matched = false;
          const next = current.map((msg) => {
            if (msg.id !== messageId) return msg;
            matched = true;
            return {
              ...msg,
              streaming: false,
              nativeStreamed: msg.nativeStreamed || msg.content.length > 0,
              content: resolveCommittedAssistantContent(msg.content, assistantContent),
              generatedDraft: generatedDraftSnapshot,
              action: responseAction,
              questions: result.questions,
              source: result.source,
              notes: resolvedNotes,
            };
          });

          if (matched) {
            return next;
          }

          return [...current, aiMsg];
        });
      } else {
        appendVisibleMessages([aiMsg]);
      }

      const latestMessages = loadAiChatHistory(sessionWorkflowKey);
      if (hasAssistantResultForRequest(latestMessages, requestId)) {
        appendAiChatDebugEvent(sessionWorkflowKey, {
          level: "info",
          event: "request_duplicate_ignored",
          message: "Ignored duplicate AI Builder completion for request",
          meta: { requestId, mode: requestMode, resumed, reason: "assistant_result_already_recorded" }
        });
        return;
      }

      const durationMs = Date.now() - startedAt;
      appendAiChatDebugEvent(sessionWorkflowKey, {
        level: "info",
        event: "request_success",
        message: "AI Builder chat request completed",
        meta: { requestId, durationMs, mode: requestMode, resumed, action: result.action, source: result.source, hasDraft: Boolean(result.draft), questions: result.questions?.length ?? 0 }
      });

      saveAiChatHistory(sessionWorkflowKey, [...latestMessages, aiMsg]);

      if (generatedDraftSnapshot) {
        onNotice(result.action === "replace_flow" ? "AI rebuilt the flow from chat." : "AI updated the current flow from chat.");
      } else if (mutationSuppressedByAskMode) {
        onNotice("Ask mode replied without changing the flow.");
      } else if ((result.questions?.length ?? 0) > 0) {
        onNotice("AI asked clarification questions.");
      } else {
        onNotice("AI replied in chat.");
      }
    },
    [appendVisibleMessages, onApplyDraft, onNotice, workflowKey]
  );

  const runFlowBuilderRequest = useCallback(
    async ({ requestId, payload, startedAt, mode: requestMode, resumed }: ExecuteFlowBuilderRequestOptions) => {
      const requestWorkflowKey = hydratedWorkflowKeyRef.current || workflowKey;
      const revealAssistantTextDuringGeneration = shouldRevealAssistantTextDuringGeneration(requestMode);
      const execution = executeFlowBuilderRequestOnce(requestId, async () => {
        const streamingMsgId = crypto.randomUUID();
        streamingBufferRef.current = "";
        streamingRevealedRef.current = 0;
        streamingDoneRef.current = false;
        streamingResolveRef.current = null;
        streamingMessageIdRef.current = streamingMsgId;
        streamingHasModelTextRef.current = false;
        appendVisibleMessages([{
          id: streamingMsgId,
          requestId,
          role: "assistant",
          content: "",
          streaming: true,
          nativeStreamed: true,
          timestamp: Date.now(),
        }]);

        try {
          let completedResult: FlowBuilderResponse | null = null;

          await new Promise<void>((resolve, reject) => {
            generateFlowDraftStream(
              payload,
              {
                onTextDelta: (delta) => {
                  if (!revealAssistantTextDuringGeneration) {
                    return;
                  }
                  if (!streamingHasModelTextRef.current) {
                    streamingHasModelTextRef.current = true;
                    streamingBufferRef.current = "";
                    streamingRevealedRef.current = 0;
                  }
                  streamingBufferRef.current += delta;
                  scheduleStreamingFlush();
                },
                onStatus: () => {},
                onComplete: (result) => {
                  completedResult = result;
                  streamingDoneRef.current = true;
                  if (streamingRevealedRef.current >= streamingBufferRef.current.length) {
                    resolve();
                  } else {
                    streamingResolveRef.current = resolve;
                    scheduleStreamingFlush();
                  }
                },
                onError: (error) => {
                  if (streamingRafRef.current !== null) {
                    cancelAnimationFrame(streamingRafRef.current);
                    streamingRafRef.current = null;
                  }
                  streamingMessageIdRef.current = null;
                  streamingHasModelTextRef.current = false;
                  reject(error);
                }
              }
            ).catch(reject);
          });

          streamingHasModelTextRef.current = false;

          if (completedResult) {
            await processCompletedResult(
              completedResult,
              streamingMsgId,
              requestId,
              requestMode,
              startedAt,
              resumed,
              "update_existing"
            );
          }

          streamingMessageIdRef.current = null;
        } catch (streamError) {
          console.log(
            "[ai-chat] streaming failed, falling back to non-streaming:",
            streamError instanceof Error ? streamError.message : streamError
          );
          if (revealAssistantTextDuringGeneration) {
            setMessages((current) => current.filter((msg) => msg.id !== streamingMsgId));
          }

          appendAiChatDebugEvent(requestWorkflowKey, {
            level: "info",
            event: "stream_fallback",
            message: "Streaming failed; falling back to non-streaming request",
            meta: { requestId, mode: requestMode, resumed, error: streamError instanceof Error ? streamError.message : "unknown" }
          });

          try {
            const result = await generateFlowDraft(payload);
            const fallbackMsgId = revealAssistantTextDuringGeneration ? crypto.randomUUID() : streamingMsgId;
            const fallbackInsertMode = revealAssistantTextDuringGeneration ? "append_new" : "update_existing";
            await processCompletedResult(result, fallbackMsgId, requestId, requestMode, startedAt, resumed, fallbackInsertMode);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Failed to process AI chat message";
            const durationMs = Date.now() - startedAt;
            const latestMessages = loadAiChatHistory(requestWorkflowKey);
            setMessages((current) => current.filter((msg) => msg.id !== streamingMsgId));
            if (hasAssistantResultForRequest(latestMessages, requestId) || hasErrorResultForRequest(latestMessages, requestId)) {
              appendAiChatDebugEvent(requestWorkflowKey, {
                level: "info",
                event: "request_duplicate_ignored",
                message: "Ignored duplicate AI Builder failure for request",
                meta: { requestId, mode: requestMode, resumed, reason: "terminal_result_already_recorded" }
              });
              return;
            }

            appendAiChatDebugEvent(requestWorkflowKey, {
              level: "error",
              event: "request_error",
              message: "AI Builder chat request failed",
              meta: { requestId, durationMs, resumed, errorName: error instanceof Error ? error.name : "UnknownError", providerId: payload.providerId, model: payload.model },
              details: errorMessage
            });
            const errorMessageEntry: AiChatMessage = {
              id: crypto.randomUUID(),
              requestId,
              role: "error",
              content: errorMessage,
              action: "answer",
              timestamp: Date.now(),
            };
            const messagesWithError = [...latestMessages, errorMessageEntry];
            appendVisibleMessages([errorMessageEntry]);
            saveAiChatHistory(requestWorkflowKey, messagesWithError);
            onNotice(errorMessage);
          }
        } finally {
          if (activeRequestIdRef.current === requestId) {
            activeRequestIdRef.current = null;
          }
          setGenerating(false);
          saveAiChatPending(requestWorkflowKey, false);
          clearAiChatPendingRequest(requestWorkflowKey);
          appendAiChatDebugEvent(requestWorkflowKey, {
            level: "info",
            event: "request_end",
            message: "AI Builder chat request lifecycle finished",
            meta: { requestId, mode: requestMode, resumed, pending: false, elapsedMs: Date.now() - startedAt }
          });

          const deferredWorkflowKey = deferredWorkflowKeyRef.current;
          if (deferredWorkflowKey && deferredWorkflowKey !== hydratedWorkflowKeyRef.current) {
            deferredWorkflowKeyRef.current = null;
            hydrateWorkflowSession(deferredWorkflowKey);
          }
        }
      });

      if (execution.joinedExisting) {
        appendAiChatDebugEvent(requestWorkflowKey, {
          level: "info",
          event: "request_duplicate_ignored",
          message: "Joined in-flight AI Builder request",
          meta: {
            requestId,
            mode: requestMode,
            resumed,
            reason: "request_execution_already_in_flight"
          }
        });
      }

      await execution.promise;
    },
    [appendVisibleMessages, hydrateWorkflowSession, onNotice, processCompletedResult, scheduleStreamingFlush, workflowKey]
  );

  useEffect(() => {
    if (hydratedWorkflowKey.trim().length === 0 || activeRequestIdRef.current) {
      return;
    }

    if (!loadAiChatPending(hydratedWorkflowKey)) {
      return;
    }

    const pendingRequest = loadAiChatPendingRequest(hydratedWorkflowKey);
    if (!pendingRequest) {
      saveAiChatPending(hydratedWorkflowKey, false);
      clearAiChatPendingRequest(hydratedWorkflowKey);
      setGenerating(false);
      appendAiChatDebugEvent(hydratedWorkflowKey, {
        level: "info",
        event: "request_resume_missing",
        message: "Pending AI Builder request was missing its payload",
        meta: {
          pending: false
        }
      });
      return;
    }

    const requestMode = pendingRequest.mode ?? effectiveMode;
    activeRequestIdRef.current = pendingRequest.requestId;
    setGenerating(true);
    appendAiChatDebugEvent(hydratedWorkflowKey, {
      level: "info",
      event: "request_resume",
      message: "Resuming pending AI Builder chat request",
      meta: {
        requestId: pendingRequest.requestId,
        mode: requestMode,
        elapsedMs: Math.max(0, Date.now() - pendingRequest.startedAt)
      }
    });

    void runFlowBuilderRequest({
      requestId: pendingRequest.requestId,
      payload: pendingRequest.payload,
      startedAt: pendingRequest.startedAt,
      mode: requestMode,
      resumed: true
    });
  }, [effectiveMode, hydratedWorkflowKey, runFlowBuilderRequest]);

  const sendPrompt = async (nextPrompt: string, options?: { clearComposer?: boolean }) => {
    const sessionWorkflowKey = hydratedWorkflowKey || workflowKey;
    const trimmed = normalizeFlowBuilderPrompt(nextPrompt);
    if (trimmed.length < MIN_PROMPT_LENGTH || generating || activeRequestIdRef.current) return;

    if (isFlowBuilderPromptTooLong(trimmed)) {
      const requestId = createRequestId();
      const promptLength = getFlowBuilderPromptLength(trimmed);
      const message = `Prompt is too long (${promptLength}/${MAX_PROMPT_LENGTH}). Shorten it and try again.`;
      appendAiChatDebugEvent(sessionWorkflowKey, {
        level: "info",
        event: "request_blocked",
        message: "AI Builder prompt exceeded max length",
        meta: {
          requestId,
          mode: effectiveMode,
          promptChars: promptLength,
          maxPromptChars: MAX_PROMPT_LENGTH
        }
      });

      const latestMessages = loadAiChatHistory(sessionWorkflowKey);
      const errorMessageEntry: AiChatMessage = {
        id: crypto.randomUUID(),
        requestId,
        role: "error",
        content: message,
        action: "answer",
        timestamp: Date.now(),
      };
      appendVisibleMessages([errorMessageEntry]);
      saveAiChatHistory(sessionWorkflowKey, [...latestMessages, errorMessageEntry]);
      onNotice(message);
      return;
    }

    const providerFastModeAvailable = providerId === "openai" ? openAiFastModeAvailable : claudeFastModeAvailable;
    const effectiveFastMode =
      providerFastModeAvailable && selectedModelMeta?.supportsFastMode !== false && fastMode;
    const openAiApiCapable = resolveProviderRuntimeCapabilities(
      providers.openai,
      oauthStatuses.openai
    ).hasActiveApiCredential;
    const requestId = createRequestId();
    const startedAt = Date.now();

    const persistedMessages = loadAiChatHistory(sessionWorkflowKey);
    const userMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      requestId,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const serializedHistory = persistedMessages.flatMap((entry) => {
      const message = toFlowBuilderHistoryMessage(entry);
      return message ? [message] : [];
    });
    const historyWindow: Array<{ role: "user" | "assistant"; content: string }> = [];
    let historyChars = trimmed.length;
    for (let index = serializedHistory.length - 1; index >= 0; index -= 1) {
      const message = serializedHistory[index];
      if (!message) {
        continue;
      }
      const nextChars = historyChars + message.content.length + 16;
      if (historyWindow.length > 0 && nextChars > MAX_FLOW_BUILDER_HISTORY_CHARS) {
        break;
      }
      historyWindow.push(message);
      historyChars = nextChars;
    }
    historyWindow.reverse();
    const history = [...historyWindow, { role: "user" as const, content: clipFlowBuilderHistoryContent(trimmed) }];
    const messagesWithUser = [...persistedMessages, userMsg];

    if (!canSendPromptToFlowMutationEndpoint(effectiveMode, trimmed)) {
      const blockedMessage: AiChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: ASK_MODE_MUTATION_BLOCK_MESSAGE,
        action: "answer",
        source: "fallback",
        notes: ["Blocked mutation-intent prompt while Ask mode was active."],
        timestamp: Date.now()
      };
      const blockedMessages = [...messagesWithUser, blockedMessage];
      appendVisibleMessages([userMsg, blockedMessage]);
      saveAiChatHistory(sessionWorkflowKey, blockedMessages);
      if (options?.clearComposer ?? false) {
        setPrompt("");
        saveAiChatDraft(sessionWorkflowKey, "");
      }
      appendAiChatDebugEvent(sessionWorkflowKey, {
        level: "info",
        event: "request_blocked",
        message: "AI Builder prompt blocked in Ask mode",
        meta: {
          requestId,
          mode: effectiveMode,
          promptChars: trimmed.length
        }
      });
      onNotice(ASK_MODE_MUTATION_BLOCK_NOTICE);
      return;
    }

    appendAiChatDebugEvent(sessionWorkflowKey, {
      level: "info",
      event: "request_start",
      message: "AI Builder chat request started",
      meta: {
        requestId,
        providerId,
        model,
        reasoningEffort,
        mode: effectiveMode,
        fastMode: effectiveFastMode,
        use1MContext,
        generatedStepStrategy,
        allowPremiumModes,
        promptChars: trimmed.length,
        historyCount: history.length
      }
    });

    appendVisibleMessages([userMsg]);
    saveAiChatHistory(sessionWorkflowKey, messagesWithUser);
    if (options?.clearComposer ?? false) {
      setPrompt("");
      saveAiChatDraft(sessionWorkflowKey, "");
    }

    const payload: FlowBuilderRequest = {
      requestId,
      prompt: trimmed,
      providerId,
      model,
      reasoningEffort,
      fastMode: effectiveFastMode,
      use1MContext,
      generatedStepPolicy: {
        strategy: generatedStepStrategy,
        allowPremiumModes,
        openAiApiCapable
      },
      history,
      currentDraft,
      availableMcpServers: mcpServers.slice(0, MAX_FLOW_BUILDER_MCP_SERVERS).map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
        summary: `${server.transport}${server.enabled ? "" : " (disabled)"}`
      }))
    };

    activeRequestIdRef.current = requestId;
    saveAiChatPendingRequest(sessionWorkflowKey, {
      requestId,
      payload,
      startedAt,
      mode: effectiveMode
    });
    setGenerating(true);
    saveAiChatPending(sessionWorkflowKey, true);

    await runFlowBuilderRequest({
      requestId,
      payload,
      startedAt,
      mode: effectiveMode,
      resumed: false
    });
  };

  const handleSend = async () => {
    await sendPrompt(prompt, { clearComposer: true });
  };

  const handleQuickReply = async (value: string) => {
    await sendPrompt(value, { clearComposer: false });
  };

  const handleClearChat = useCallback(() => {
    if (generating || activeRequestIdRef.current) return;
    const sessionWorkflowKey = hydratedWorkflowKey || workflowKey;
    if (sessionWorkflowKey.trim().length === 0) return;

    clearAiChatSession(sessionWorkflowKey);
    setMessages([]);
    setHasOlderMessages(false);
    setPrompt("");
    visibleMessageCountRef.current = 0;
  }, [generating, hydratedWorkflowKey, workflowKey]);

  return {
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
    mode,
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
    handleClearChat,
    loadOlderMessages,
  };
}
