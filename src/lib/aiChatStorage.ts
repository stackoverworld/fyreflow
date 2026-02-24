import type { AiChatMessage, FlowBuilderRequest, PipelinePayload } from "@/lib/types";

const AI_CHAT_STORAGE_PREFIX = "fyreflow:ai-chat:";
const AI_CHAT_DRAFT_PREFIX = "fyreflow:ai-chat-draft:";
const AI_CHAT_PENDING_PREFIX = "fyreflow:ai-chat-pending:";
const AI_CHAT_PENDING_REQUEST_PREFIX = "fyreflow:ai-chat-pending-request:";
const MAX_MESSAGES_PER_WORKFLOW = 500;
const DEFAULT_HISTORY_PAGE_SIZE = 30;

type AiChatLifecycleListener = () => void;

export type AiChatPendingMode = "ask" | "build";

export interface AiChatPendingRequest {
  requestId: string;
  payload: FlowBuilderRequest;
  startedAt: number;
  mode?: AiChatPendingMode;
}

const aiChatLifecycleListeners = new Map<string, Set<AiChatLifecycleListener>>();

function getStorageKey(workflowKey: string): string {
  return `${AI_CHAT_STORAGE_PREFIX}${workflowKey}`;
}

function getDraftKey(workflowKey: string): string {
  return `${AI_CHAT_DRAFT_PREFIX}${workflowKey}`;
}

function getPendingKey(workflowKey: string): string {
  return `${AI_CHAT_PENDING_PREFIX}${workflowKey}`;
}

function getPendingRequestKey(workflowKey: string): string {
  return `${AI_CHAT_PENDING_REQUEST_PREFIX}${workflowKey}`;
}

function notifyAiChatLifecycle(workflowKey: string): void {
  const listeners = aiChatLifecycleListeners.get(workflowKey);
  if (!listeners || listeners.size === 0) {
    return;
  }
  listeners.forEach((listener) => listener());
}

export function subscribeAiChatLifecycle(
  workflowKey: string,
  listener: AiChatLifecycleListener
): () => void {
  if (workflowKey.trim().length === 0) {
    return () => {};
  }

  let listeners = aiChatLifecycleListeners.get(workflowKey);
  if (!listeners) {
    listeners = new Set<AiChatLifecycleListener>();
    aiChatLifecycleListeners.set(workflowKey, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = aiChatLifecycleListeners.get(workflowKey);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      aiChatLifecycleListeners.delete(workflowKey);
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidRole(role: unknown): role is AiChatMessage["role"] {
  return role === "user" || role === "assistant" || role === "error";
}

function isValidAction(action: unknown): action is NonNullable<AiChatMessage["action"]> {
  return action === "answer" || action === "update_current_flow" || action === "replace_flow";
}

function isValidQuestionOption(option: unknown): option is NonNullable<AiChatMessage["questions"]>[number]["options"][number] {
  if (!isObject(option)) {
    return false;
  }

  if (typeof option.label !== "string" || option.label.trim().length === 0) {
    return false;
  }

  if (typeof option.value !== "string" || option.value.trim().length === 0) {
    return false;
  }

  return typeof option.description === "undefined" || typeof option.description === "string";
}

function isValidQuestion(question: unknown): question is NonNullable<AiChatMessage["questions"]>[number] {
  if (!isObject(question)) {
    return false;
  }

  if (typeof question.id !== "string" || question.id.trim().length === 0) {
    return false;
  }

  if (typeof question.question !== "string" || question.question.trim().length === 0) {
    return false;
  }

  if (!Array.isArray(question.options)) {
    return false;
  }

  return question.options.length > 0 && question.options.every((option) => isValidQuestionOption(option));
}

function isPipelinePayload(value: unknown): value is PipelinePayload {
  if (!isObject(value)) {
    return false;
  }

  const steps = Array.isArray(value.steps) ? value.steps : [];
  const hasValidSteps = steps.every((step) => {
    if (!isObject(step)) {
      return false;
    }
    return (
      (step.outputFormat === "markdown" || step.outputFormat === "json") &&
      Array.isArray(step.requiredOutputFields) &&
      Array.isArray(step.requiredOutputFiles) &&
      Array.isArray(step.scenarios) &&
      Array.isArray(step.skipIfArtifacts) &&
      Array.isArray(step.policyProfileIds) &&
      Array.isArray(step.cacheBypassInputKeys) &&
      Array.isArray(step.cacheBypassOrchestratorPromptPatterns)
    );
  });

  return (
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.steps) &&
    hasValidSteps &&
    Array.isArray(value.links) &&
    Array.isArray(value.qualityGates)
  );
}

function isValidFlowBuilderHistoryMessage(
  value: unknown
): value is NonNullable<FlowBuilderRequest["history"]>[number] {
  if (!isObject(value)) {
    return false;
  }

  return (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    value.content.trim().length > 0
  );
}

function isValidFlowBuilderMcpServer(
  value: unknown
): value is NonNullable<FlowBuilderRequest["availableMcpServers"]>[number] {
  if (!isObject(value)) {
    return false;
  }

  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    return false;
  }

  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return false;
  }

  if (typeof value.enabled !== "undefined" && typeof value.enabled !== "boolean") {
    return false;
  }

  if (
    typeof value.transport !== "undefined" &&
    value.transport !== "stdio" &&
    value.transport !== "http" &&
    value.transport !== "sse"
  ) {
    return false;
  }

  return typeof value.summary === "undefined" || typeof value.summary === "string";
}

function isFlowBuilderRequest(value: unknown): value is FlowBuilderRequest {
  if (!isObject(value)) {
    return false;
  }

  if (typeof value.requestId !== "undefined" && (typeof value.requestId !== "string" || value.requestId.trim().length === 0)) {
    return false;
  }

  if (typeof value.prompt !== "string" || value.prompt.trim().length < 2) {
    return false;
  }

  if (value.providerId !== "openai" && value.providerId !== "claude") {
    return false;
  }

  if (typeof value.model !== "string" || value.model.trim().length === 0) {
    return false;
  }

  if (
    typeof value.reasoningEffort !== "undefined" &&
    value.reasoningEffort !== "minimal" &&
    value.reasoningEffort !== "low" &&
    value.reasoningEffort !== "medium" &&
    value.reasoningEffort !== "high" &&
    value.reasoningEffort !== "xhigh"
  ) {
    return false;
  }

  if (typeof value.fastMode !== "undefined" && typeof value.fastMode !== "boolean") {
    return false;
  }

  if (typeof value.use1MContext !== "undefined" && typeof value.use1MContext !== "boolean") {
    return false;
  }

  if (
    typeof value.history !== "undefined" &&
    (!Array.isArray(value.history) || !value.history.every((entry) => isValidFlowBuilderHistoryMessage(entry)))
  ) {
    return false;
  }

  if (typeof value.currentDraft !== "undefined" && !isPipelinePayload(value.currentDraft)) {
    return false;
  }

  if (
    typeof value.availableMcpServers !== "undefined" &&
    (!Array.isArray(value.availableMcpServers) || !value.availableMcpServers.every((entry) => isValidFlowBuilderMcpServer(entry)))
  ) {
    return false;
  }

  return true;
}

function normalizePendingMode(value: unknown): AiChatPendingMode | undefined {
  if (value === "ask" || value === "build") {
    return value;
  }
  return undefined;
}

function normalizeMessage(raw: unknown, fallbackIndex: number): AiChatMessage | null {
  if (!isObject(raw)) {
    return null;
  }

  if (!isValidRole(raw.role) || typeof raw.content !== "string") {
    return null;
  }

  const message: AiChatMessage = {
    id: typeof raw.id === "string" ? raw.id : `restored-${fallbackIndex}-${Date.now()}`,
    role: raw.role,
    content: raw.content,
    timestamp: typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now()
  };

  if (typeof raw.requestId === "string" && raw.requestId.trim().length > 0) {
    message.requestId = raw.requestId.trim();
  }

  if (raw.source === "model" || raw.source === "fallback") {
    message.source = raw.source;
  }

  if (isValidAction(raw.action)) {
    message.action = raw.action;
  }

  if (Array.isArray(raw.questions)) {
    const normalizedQuestions = raw.questions.filter((question): question is NonNullable<AiChatMessage["questions"]>[number] =>
      isValidQuestion(question)
    );
    if (normalizedQuestions.length > 0) {
      message.questions = normalizedQuestions;
    }
  }

  if (Array.isArray(raw.notes)) {
    message.notes = raw.notes.filter((note): note is string => typeof note === "string");
  }

  if (isPipelinePayload(raw.generatedDraft)) {
    message.generatedDraft = raw.generatedDraft;
  }

  return message;
}

function readAiChatHistory(workflowKey: string): AiChatMessage[] {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(workflowKey));
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry, index) => normalizeMessage(entry, index))
      .filter((entry): entry is AiChatMessage => entry !== null)
      .slice(-MAX_MESSAGES_PER_WORKFLOW);
  } catch {
    return [];
  }
}

export function loadAiChatHistory(workflowKey: string): AiChatMessage[] {
  return readAiChatHistory(workflowKey);
}

function normalizePageNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

export interface LoadAiChatHistoryPageOptions {
  offset?: number;
  limit?: number;
}

export interface AiChatHistoryPage {
  messages: AiChatMessage[];
  hasMore: boolean;
  total: number;
}

export function loadAiChatHistoryPage(
  workflowKey: string,
  options: LoadAiChatHistoryPageOptions = {}
): AiChatHistoryPage {
  const allMessages = readAiChatHistory(workflowKey);
  const total = allMessages.length;
  const offset = Math.min(normalizePageNumber(options.offset, 0), total);
  const limit = Math.max(1, normalizePageNumber(options.limit, DEFAULT_HISTORY_PAGE_SIZE));
  const end = Math.max(total - offset, 0);
  const start = Math.max(end - limit, 0);

  return {
    messages: allMessages.slice(start, end),
    hasMore: start > 0,
    total
  };
}

export function saveAiChatHistory(workflowKey: string, messages: AiChatMessage[]): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return;
  }

  try {
    window.localStorage.setItem(getStorageKey(workflowKey), JSON.stringify(messages.slice(-MAX_MESSAGES_PER_WORKFLOW)));
  } catch {
    // Ignore write errors (quota, private mode, etc.)
  }
}

export function loadAiChatDraft(workflowKey: string): string {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return "";
  }

  try {
    const raw = window.localStorage.getItem(getDraftKey(workflowKey));
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

export function saveAiChatDraft(workflowKey: string, draft: string): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return;
  }

  try {
    if (draft.length === 0) {
      window.localStorage.removeItem(getDraftKey(workflowKey));
    } else {
      window.localStorage.setItem(getDraftKey(workflowKey), draft);
    }
  } catch {
    // Ignore write errors (quota, private mode, etc.)
  }
}

export function loadAiChatPending(workflowKey: string): boolean {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return false;
  }

  try {
    return window.localStorage.getItem(getPendingKey(workflowKey)) === "1";
  } catch {
    return false;
  }
}

export function saveAiChatPending(workflowKey: string, pending: boolean): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return;
  }

  try {
    if (pending) {
      window.localStorage.setItem(getPendingKey(workflowKey), "1");
    } else {
      window.localStorage.removeItem(getPendingKey(workflowKey));
    }
    notifyAiChatLifecycle(workflowKey);
  } catch {
    // Ignore write errors (quota, private mode, etc.)
  }
}

export function loadAiChatPendingRequest(workflowKey: string): AiChatPendingRequest | null {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getPendingRequestKey(workflowKey));
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
      return null;
    }

    const requestId = typeof parsed.requestId === "string" ? parsed.requestId.trim() : "";
    if (requestId.length === 0 || !isFlowBuilderRequest(parsed.payload)) {
      return null;
    }

    const payload: FlowBuilderRequest =
      parsed.payload.requestId === requestId ? parsed.payload : { ...parsed.payload, requestId };

    const startedAt =
      typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt) ? parsed.startedAt : Date.now();

    return {
      requestId,
      payload,
      startedAt,
      mode: normalizePendingMode(parsed.mode)
    };
  } catch {
    return null;
  }
}

export function saveAiChatPendingRequest(workflowKey: string, request: AiChatPendingRequest | null): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return;
  }

  try {
    if (!request) {
      window.localStorage.removeItem(getPendingRequestKey(workflowKey));
    } else {
      const normalized: AiChatPendingRequest = {
        ...request,
        requestId: request.requestId.trim(),
        payload: {
          ...request.payload,
          requestId: request.requestId.trim()
        },
        mode: normalizePendingMode(request.mode)
      };

      if (normalized.requestId.length === 0 || !isFlowBuilderRequest(normalized.payload)) {
        window.localStorage.removeItem(getPendingRequestKey(workflowKey));
      } else {
        window.localStorage.setItem(getPendingRequestKey(workflowKey), JSON.stringify(normalized));
      }
    }

    notifyAiChatLifecycle(workflowKey);
  } catch {
    // Ignore write errors (quota, private mode, etc.)
  }
}

export function clearAiChatPendingRequest(workflowKey: string): void {
  saveAiChatPendingRequest(workflowKey, null);
}

export function moveAiChatHistory(sourceWorkflowKey: string, targetWorkflowKey: string): void {
  if (
    typeof window === "undefined" ||
    sourceWorkflowKey.trim().length === 0 ||
    targetWorkflowKey.trim().length === 0 ||
    sourceWorkflowKey === targetWorkflowKey
  ) {
    return;
  }

  try {
    const sourceMessages = loadAiChatHistory(sourceWorkflowKey);
    if (sourceMessages.length === 0) {
      return;
    }

    const targetMessages = loadAiChatHistory(targetWorkflowKey);
    const merged = [...targetMessages, ...sourceMessages].slice(-MAX_MESSAGES_PER_WORKFLOW);

    window.localStorage.setItem(getStorageKey(targetWorkflowKey), JSON.stringify(merged));
    window.localStorage.removeItem(getStorageKey(sourceWorkflowKey));
  } catch {
    // Ignore migration failures so save flow still succeeds.
  }
}
