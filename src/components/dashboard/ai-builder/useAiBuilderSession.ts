import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction, type Dispatch } from "react";
import { MODEL_CATALOG, getDefaultModelForProvider } from "@/lib/modelCatalog";
import { generateFlowDraft } from "@/lib/api";
import {
  clearAiChatPendingRequest,
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
  FlowBuilderRequest,
  McpServerConfig,
  PipelinePayload,
  ProviderId,
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
      providerId:
        parsed.providerId === "openai" || parsed.providerId === "claude"
          ? parsed.providerId
          : defaultSettings.providerId,
      model: typeof parsed.model === "string" ? parsed.model : defaultSettings.model,
      reasoningEffort: ["minimal", "low", "medium", "high", "xhigh"].includes(parsed.reasoningEffort)
        ? parsed.reasoningEffort
        : defaultSettings.reasoningEffort,
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
  claudeFastModeAvailable: boolean;
  onApplyDraft: (draft: PipelinePayload) => void;
  onNotice: (message: string) => void;
  mutationLocked?: boolean;
}

interface UseAiBuilderSessionState {
  providerId: ProviderId;
  model: string;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  use1MContext: boolean;
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
  handleSend: () => Promise<void>;
  handleQuickReply: (value: string) => Promise<void>;
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
  const [mode, setMode] = useState<AiBuilderMode>(DEFAULT_AI_BUILDER_MODE);

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hydratedWorkflowKey, setHydratedWorkflowKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const visibleMessageCountRef = useRef(0);
  const loadingOlderMessagesRef = useRef(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const effectiveMode = resolveAiBuilderMode(mode, mutationLocked);

  const modelCatalog = useMemo(() => MODEL_CATALOG[providerId] ?? [], [providerId]);

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
    if (providerId !== "claude") {
      if (fastMode) setFastMode(false);
      if (use1MContext) setUse1MContext(false);
      return;
    }
    if (!claudeFastModeAvailable && fastMode) {
      setFastMode(false);
    }
    if (selectedModelMeta?.supportsFastMode === false && fastMode) setFastMode(false);
    if (selectedModelMeta?.supports1MContext === false && use1MContext) setUse1MContext(false);
  }, [
    claudeFastModeAvailable,
    fastMode,
    providerId,
    selectedModelMeta?.supports1MContext,
    selectedModelMeta?.supportsFastMode,
    use1MContext,
  ]);

  useEffect(() => {
    saveAiBuilderSettings({ providerId, model, reasoningEffort, fastMode, use1MContext });
  }, [providerId, model, reasoningEffort, fastMode, use1MContext]);

  useEffect(() => {
    const initialPage = loadAiChatHistoryPage(workflowKey, {
      limit: AI_BUILDER_MESSAGES_PAGE_SIZE,
      offset: 0
    });
    setMessages(initialPage.messages);
    setHasOlderMessages(initialPage.hasMore);
    loadingOlderMessagesRef.current = false;
    setLoadingOlderMessages(false);
    setHydratedWorkflowKey(workflowKey);
    setPrompt(loadAiChatDraft(workflowKey));
    activeRequestIdRef.current = null;
    setGenerating(loadAiChatPending(workflowKey));
  }, [workflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey !== workflowKey) {
      return;
    }

    return subscribeAiChatLifecycle(workflowKey, () => {
      const refreshedPage = loadAiChatHistoryPage(workflowKey, {
        limit: Math.max(AI_BUILDER_MESSAGES_PAGE_SIZE, visibleMessageCountRef.current),
        offset: 0
      });
      setMessages(refreshedPage.messages);
      setHasOlderMessages(refreshedPage.hasMore);
      setGenerating(loadAiChatPending(workflowKey));
    });
  }, [hydratedWorkflowKey, workflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey !== workflowKey) {
      return;
    }
    saveAiChatDraft(workflowKey, prompt);
  }, [hydratedWorkflowKey, workflowKey, prompt]);

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

  const runFlowBuilderRequest = useCallback(
    async ({ requestId, payload, startedAt, mode: requestMode, resumed }: ExecuteFlowBuilderRequestOptions) => {
      const execution = executeFlowBuilderRequestOnce(requestId, async () => {
        try {
          const result = await generateFlowDraft(payload);
          const mutationAction = result.action === "update_current_flow" || result.action === "replace_flow";
          const mutationSuppressedByAskMode = requestMode === "ask" && mutationAction;
          const responseAction: FlowBuilderAction = mutationSuppressedByAskMode ? "answer" : result.action;
          const shouldApplyDraft = mutationAction && !mutationSuppressedByAskMode;
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
          const assistantContent = mutationSuppressedByAskMode
            ? `${baseAssistantContent}\n\nAsk mode kept this response read-only; no flow changes were applied.`
            : baseAssistantContent;

          const aiMsg: AiChatMessage = {
            id: crypto.randomUUID(),
            requestId,
            role: "assistant",
            content: assistantContent,
            generatedDraft: generatedDraftSnapshot,
            action: responseAction,
            questions: result.questions,
            source: result.source,
            notes: mutationSuppressedByAskMode
              ? [...result.notes, "Ask mode kept the response read-only; flow mutation output was ignored."]
              : result.notes,
            timestamp: Date.now(),
          };
          const latestMessages = loadAiChatHistory(workflowKey);
          if (hasAssistantResultForRequest(latestMessages, requestId)) {
            appendAiChatDebugEvent(workflowKey, {
              level: "info",
              event: "request_duplicate_ignored",
              message: "Ignored duplicate AI Builder completion for request",
              meta: {
                requestId,
                mode: requestMode,
                resumed,
                reason: "assistant_result_already_recorded"
              }
            });
            return;
          }

          const durationMs = Date.now() - startedAt;
          appendAiChatDebugEvent(workflowKey, {
            level: "info",
            event: "request_success",
            message: "AI Builder chat request completed",
            meta: {
              requestId,
              durationMs,
              mode: requestMode,
              resumed,
              action: result.action,
              source: result.source,
              hasDraft: Boolean(result.draft),
              questions: result.questions?.length ?? 0
            }
          });

          const messagesWithAssistant = [...latestMessages, aiMsg];
          appendVisibleMessages([aiMsg]);
          saveAiChatHistory(workflowKey, messagesWithAssistant);

          if (generatedDraftSnapshot) {
            onApplyDraft(clonePipelinePayload(generatedDraftSnapshot));
            onNotice(
              result.action === "replace_flow"
                ? "AI rebuilt the flow from chat."
                : "AI updated the current flow from chat."
            );
          } else if (mutationSuppressedByAskMode) {
            onNotice("Ask mode replied without changing the flow.");
          } else if ((result.questions?.length ?? 0) > 0) {
            onNotice("AI asked clarification questions.");
          } else {
            onNotice("AI replied in chat.");
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to process AI chat message";
          const durationMs = Date.now() - startedAt;
          const latestMessages = loadAiChatHistory(workflowKey);
          if (hasAssistantResultForRequest(latestMessages, requestId) || hasErrorResultForRequest(latestMessages, requestId)) {
            appendAiChatDebugEvent(workflowKey, {
              level: "info",
              event: "request_duplicate_ignored",
              message: "Ignored duplicate AI Builder failure for request",
              meta: {
                requestId,
                mode: requestMode,
                resumed,
                reason: "terminal_result_already_recorded"
              }
            });
            return;
          }

          appendAiChatDebugEvent(workflowKey, {
            level: "error",
            event: "request_error",
            message: "AI Builder chat request failed",
            meta: {
              requestId,
              durationMs,
              resumed,
              errorName: error instanceof Error ? error.name : "UnknownError",
              providerId: payload.providerId,
              model: payload.model
            },
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
          saveAiChatHistory(workflowKey, messagesWithError);
          onNotice(errorMessage);
        } finally {
          if (activeRequestIdRef.current === requestId) {
            activeRequestIdRef.current = null;
          }
          setGenerating(false);
          saveAiChatPending(workflowKey, false);
          clearAiChatPendingRequest(workflowKey);
          appendAiChatDebugEvent(workflowKey, {
            level: "info",
            event: "request_end",
            message: "AI Builder chat request lifecycle finished",
            meta: {
              requestId,
              mode: requestMode,
              resumed,
              pending: false,
              elapsedMs: Date.now() - startedAt
            }
          });
        }
      });

      if (execution.joinedExisting) {
        appendAiChatDebugEvent(workflowKey, {
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
    [appendVisibleMessages, onApplyDraft, onNotice, workflowKey]
  );

  useEffect(() => {
    if (hydratedWorkflowKey !== workflowKey || activeRequestIdRef.current) {
      return;
    }

    if (!loadAiChatPending(workflowKey)) {
      return;
    }

    const pendingRequest = loadAiChatPendingRequest(workflowKey);
    if (!pendingRequest) {
      saveAiChatPending(workflowKey, false);
      clearAiChatPendingRequest(workflowKey);
      setGenerating(false);
      appendAiChatDebugEvent(workflowKey, {
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
    appendAiChatDebugEvent(workflowKey, {
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
  }, [effectiveMode, hydratedWorkflowKey, runFlowBuilderRequest, workflowKey]);

  const sendPrompt = async (nextPrompt: string, options?: { clearComposer?: boolean }) => {
    const trimmed = normalizeFlowBuilderPrompt(nextPrompt);
    if (trimmed.length < MIN_PROMPT_LENGTH || generating || activeRequestIdRef.current) return;

    if (isFlowBuilderPromptTooLong(trimmed)) {
      const requestId = createRequestId();
      const promptLength = getFlowBuilderPromptLength(trimmed);
      const message = `Prompt is too long (${promptLength}/${MAX_PROMPT_LENGTH}). Shorten it and try again.`;
      appendAiChatDebugEvent(workflowKey, {
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

      const latestMessages = loadAiChatHistory(workflowKey);
      const errorMessageEntry: AiChatMessage = {
        id: crypto.randomUUID(),
        requestId,
        role: "error",
        content: message,
        action: "answer",
        timestamp: Date.now(),
      };
      appendVisibleMessages([errorMessageEntry]);
      saveAiChatHistory(workflowKey, [...latestMessages, errorMessageEntry]);
      onNotice(message);
      return;
    }

    const effectiveFastMode = providerId === "claude" && claudeFastModeAvailable && fastMode;
    const requestId = createRequestId();
    const startedAt = Date.now();

    const persistedMessages = loadAiChatHistory(workflowKey);
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
      saveAiChatHistory(workflowKey, blockedMessages);
      if (options?.clearComposer ?? false) {
        setPrompt("");
        saveAiChatDraft(workflowKey, "");
      }
      appendAiChatDebugEvent(workflowKey, {
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

    appendAiChatDebugEvent(workflowKey, {
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
        promptChars: trimmed.length,
        historyCount: history.length
      }
    });

    appendVisibleMessages([userMsg]);
    saveAiChatHistory(workflowKey, messagesWithUser);
    if (options?.clearComposer ?? false) {
      setPrompt("");
      saveAiChatDraft(workflowKey, "");
    }

    const payload: FlowBuilderRequest = {
      requestId,
      prompt: trimmed,
      providerId,
      model,
      reasoningEffort,
      fastMode: effectiveFastMode,
      use1MContext,
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
    saveAiChatPendingRequest(workflowKey, {
      requestId,
      payload,
      startedAt,
      mode: effectiveMode
    });
    setGenerating(true);
    saveAiChatPending(workflowKey, true);

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

  return {
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
    handleSend,
    handleQuickReply,
    loadOlderMessages,
  };
}
