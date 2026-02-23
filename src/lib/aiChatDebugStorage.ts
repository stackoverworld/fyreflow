const AI_CHAT_DEBUG_PREFIX = "fyreflow:ai-chat-debug:";
const MAX_EVENTS_PER_WORKFLOW = 180;

export interface AiChatDebugEvent {
  id: string;
  timestamp: number;
  level: "info" | "error";
  event: string;
  message: string;
  meta?: Record<string, string | number | boolean>;
  details?: string;
}

type AiChatDebugListener = () => void;

const aiChatDebugListeners = new Map<string, Set<AiChatDebugListener>>();

function getStorageKey(workflowKey: string): string {
  return `${AI_CHAT_DEBUG_PREFIX}${workflowKey}`;
}

function notify(workflowKey: string): void {
  const listeners = aiChatDebugListeners.get(workflowKey);
  if (!listeners || listeners.size === 0) {
    return;
  }

  listeners.forEach((listener) => listener());
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeMeta(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, field]) => typeof field === "string" || typeof field === "number" || typeof field === "boolean"
  ) as Array<[string, string | number | boolean]>;

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function fallbackId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return fallbackId(prefix);
}

function normalizeEvent(raw: unknown, index: number): AiChatDebugEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const level = source.level === "error" ? "error" : "info";
  const event = asString(source.event);
  const message = asString(source.message);
  if (!event || !message) {
    return null;
  }

  return {
    id: asString(source.id) ?? fallbackId(`restored-${index}`),
    timestamp: asNumber(source.timestamp) ?? Date.now(),
    level,
    event,
    message,
    meta: normalizeMeta(source.meta),
    details: asString(source.details) ?? undefined
  };
}

export function subscribeAiChatDebug(workflowKey: string, listener: AiChatDebugListener): () => void {
  if (workflowKey.trim().length === 0) {
    return () => {};
  }

  let listeners = aiChatDebugListeners.get(workflowKey);
  if (!listeners) {
    listeners = new Set<AiChatDebugListener>();
    aiChatDebugListeners.set(workflowKey, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = aiChatDebugListeners.get(workflowKey);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      aiChatDebugListeners.delete(workflowKey);
    }
  };
}

export function loadAiChatDebugEvents(workflowKey: string): AiChatDebugEvent[] {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(workflowKey));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry, index) => normalizeEvent(entry, index))
      .filter((entry): entry is AiChatDebugEvent => entry !== null)
      .slice(-MAX_EVENTS_PER_WORKFLOW);
  } catch {
    return [];
  }
}

export function saveAiChatDebugEvents(workflowKey: string, events: AiChatDebugEvent[]): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return;
  }

  try {
    window.localStorage.setItem(getStorageKey(workflowKey), JSON.stringify(events.slice(-MAX_EVENTS_PER_WORKFLOW)));
    notify(workflowKey);
  } catch {
    // Ignore write failures.
  }
}

export function appendAiChatDebugEvent(
  workflowKey: string,
  input: Omit<AiChatDebugEvent, "id" | "timestamp"> & Partial<Pick<AiChatDebugEvent, "id" | "timestamp">>
): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return;
  }

  const nextEvent: AiChatDebugEvent = {
    id: input.id ?? createId("ai-chat-debug"),
    timestamp: input.timestamp ?? Date.now(),
    level: input.level === "error" ? "error" : "info",
    event: input.event.trim(),
    message: input.message.trim(),
    meta: input.meta,
    details: typeof input.details === "string" && input.details.trim().length > 0 ? input.details.trim() : undefined
  };

  if (nextEvent.event.length === 0 || nextEvent.message.length === 0) {
    return;
  }

  const events = loadAiChatDebugEvents(workflowKey);
  saveAiChatDebugEvents(workflowKey, [...events, nextEvent]);
}

export function clearAiChatDebugEvents(workflowKey: string): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) {
    return;
  }

  try {
    window.localStorage.removeItem(getStorageKey(workflowKey));
    notify(workflowKey);
  } catch {
    // Ignore write failures.
  }
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "invalid-time";
  }
  return date.toLocaleTimeString();
}

function formatMeta(meta: AiChatDebugEvent["meta"]): string {
  if (!meta) {
    return "";
  }

  const entries = Object.entries(meta);
  if (entries.length === 0) {
    return "";
  }

  return entries.map(([key, value]) => `${key}=${String(value)}`).join(" ");
}

export function formatAiChatDebugEvent(event: AiChatDebugEvent): string {
  const prefix = `[${formatTimestamp(event.timestamp)}] ${event.level.toUpperCase()} ${event.event}`;
  const meta = formatMeta(event.meta);
  const details = event.details ? `\n  details: ${event.details}` : "";
  return `${prefix} — ${event.message}${meta ? ` (${meta})` : ""}${details}`;
}
