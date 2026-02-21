import { useEffect, useMemo, useState, type SetStateAction, type Dispatch } from "react";
import { MODEL_CATALOG, getDefaultModelForProvider } from "@/lib/modelCatalog";
import { generateFlowDraft } from "@/lib/api";
import {
  loadAiChatDraft,
  loadAiChatHistory,
  loadAiChatPending,
  saveAiChatDraft,
  saveAiChatHistory,
  saveAiChatPending,
  subscribeAiChatLifecycle
} from "@/lib/aiChatStorage";
import { autoLayoutPipelineDraftSmart } from "@/lib/flowLayout";
import type { AiChatMessage, McpServerConfig, PipelinePayload, ProviderId, ReasoningEffort } from "@/lib/types";

const AI_SETTINGS_KEY = "fyreflow:ai-builder-settings";
const MAX_FLOW_BUILDER_MCP_SERVERS = 40;

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

export const MIN_PROMPT_LENGTH = 2;

interface UseAiBuilderSessionOptions {
  workflowKey: string;
  currentDraft: PipelinePayload;
  mcpServers: McpServerConfig[];
  onApplyDraft: (draft: PipelinePayload) => void;
  onNotice: (message: string) => void;
  readOnly?: boolean;
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
  hydratedWorkflowKey: string;
  prompt: string;
  generating: boolean;
  setPrompt: Dispatch<SetStateAction<string>>;
  setProviderId: Dispatch<SetStateAction<ProviderId>>;
  setModel: Dispatch<SetStateAction<string>>;
  setReasoningEffort: Dispatch<SetStateAction<ReasoningEffort>>;
  setFastMode: Dispatch<SetStateAction<boolean>>;
  setUse1MContext: Dispatch<SetStateAction<boolean>>;
  handleSend: () => Promise<void>;
  handleQuickReply: (value: string) => Promise<void>;
}

export function useAiBuilderSession({
  workflowKey,
  currentDraft,
  mcpServers,
  onApplyDraft,
  onNotice,
  readOnly = false,
}: UseAiBuilderSessionOptions): UseAiBuilderSessionState {
  const [savedSettings] = useState(loadAiBuilderSettings);
  const [providerId, setProviderId] = useState<ProviderId>(savedSettings.providerId);
  const [model, setModel] = useState(savedSettings.model);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(savedSettings.reasoningEffort);
  const [fastMode, setFastMode] = useState(savedSettings.fastMode);
  const [use1MContext, setUse1MContext] = useState(savedSettings.use1MContext);

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [hydratedWorkflowKey, setHydratedWorkflowKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

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
    if (selectedModelMeta?.supportsFastMode === false && fastMode) setFastMode(false);
    if (selectedModelMeta?.supports1MContext === false && use1MContext) setUse1MContext(false);
  }, [
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
    setMessages(loadAiChatHistory(workflowKey));
    setHydratedWorkflowKey(workflowKey);
    setPrompt(loadAiChatDraft(workflowKey));
    setGenerating(loadAiChatPending(workflowKey));
  }, [workflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey !== workflowKey) {
      return;
    }
    saveAiChatHistory(workflowKey, messages);
  }, [hydratedWorkflowKey, messages, workflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey !== workflowKey) {
      return;
    }

    return subscribeAiChatLifecycle(workflowKey, () => {
      setMessages(loadAiChatHistory(workflowKey));
      setGenerating(loadAiChatPending(workflowKey));
    });
  }, [hydratedWorkflowKey, workflowKey]);

  useEffect(() => {
    if (hydratedWorkflowKey !== workflowKey) {
      return;
    }
    saveAiChatDraft(workflowKey, prompt);
  }, [hydratedWorkflowKey, workflowKey, prompt]);

  const sendPrompt = async (nextPrompt: string, options?: { clearComposer?: boolean }) => {
    const trimmed = nextPrompt.trim();
    if (trimmed.length < MIN_PROMPT_LENGTH || generating || readOnly) return;

    const persistedMessages = loadAiChatHistory(workflowKey);
    const userMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const history = [
      ...persistedMessages
        .flatMap((entry) =>
          entry.role === "user" || entry.role === "assistant"
            ? [{ role: entry.role, content: entry.content }]
            : []
        )
        .slice(-20),
      { role: "user" as const, content: trimmed },
    ];
    const messagesWithUser = [...persistedMessages, userMsg];

    setMessages(messagesWithUser);
    saveAiChatHistory(workflowKey, messagesWithUser);
    if (options?.clearComposer ?? false) {
      setPrompt("");
      saveAiChatDraft(workflowKey, "");
    }
    setGenerating(true);
    saveAiChatPending(workflowKey, true);

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
        availableMcpServers: mcpServers.slice(0, MAX_FLOW_BUILDER_MCP_SERVERS).map((server) => ({
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
        questions: result.questions,
        source: result.source,
        notes: result.notes,
        timestamp: Date.now(),
      };
      const latestMessages = loadAiChatHistory(workflowKey);
      const messagesWithAssistant = [...latestMessages, aiMsg];
      setMessages(messagesWithAssistant);
      saveAiChatHistory(workflowKey, messagesWithAssistant);

      if (nextDraft) {
        onApplyDraft(nextDraft);
        onNotice(
          result.action === "replace_flow"
            ? "AI rebuilt the flow from chat."
            : "AI updated the current flow from chat."
        );
      } else if ((result.questions?.length ?? 0) > 0) {
        onNotice("AI asked clarification questions.");
      } else {
        onNotice("AI replied in chat.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to process AI chat message";
      const latestMessages = loadAiChatHistory(workflowKey);
      const errorMessageEntry: AiChatMessage = {
        id: crypto.randomUUID(),
        role: "error",
        content: errorMessage,
        action: "answer",
        timestamp: Date.now(),
      };
      const messagesWithError = [
        ...latestMessages,
        errorMessageEntry,
      ];
      setMessages(messagesWithError);
      saveAiChatHistory(workflowKey, messagesWithError);
      onNotice(errorMessage);
    } finally {
      setGenerating(false);
      saveAiChatPending(workflowKey, false);
    }
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
    hydratedWorkflowKey,
    prompt,
    generating,
    setPrompt,
    setProviderId,
    setModel,
    setReasoningEffort,
    setFastMode,
    setUse1MContext,
    handleSend,
    handleQuickReply,
  };
}
