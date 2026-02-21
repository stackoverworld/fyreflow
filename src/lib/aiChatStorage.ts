import type { AiChatMessage, PipelinePayload } from "@/lib/types";

const AI_CHAT_STORAGE_PREFIX = "fyreflow:ai-chat:";
const AI_CHAT_DRAFT_PREFIX = "fyreflow:ai-chat-draft:";
const AI_CHAT_PENDING_PREFIX = "fyreflow:ai-chat-pending:";
const MAX_MESSAGES_PER_WORKFLOW = 60;

type AiChatLifecycleListener = () => void;

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
      Array.isArray(step.skipIfArtifacts)
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

export function loadAiChatHistory(workflowKey: string): AiChatMessage[] {
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
