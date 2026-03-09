import { clearAiChatSession, loadAiChatHistory, moveAiChatHistory } from "@/lib/aiChatStorage";

const SESSIONS_PREFIX = "fyreflow:ai-chat-sessions:";
const ACTIVE_SESSION_PREFIX = "fyreflow:ai-chat-active-session:";
const MAX_SESSIONS = 50;
const MAX_TITLE_LENGTH = 60;

export interface AiChatSessionEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function getSessionsKey(workflowKey: string): string {
  return `${SESSIONS_PREFIX}${workflowKey}`;
}

function getActiveSessionKey(workflowKey: string): string {
  return `${ACTIVE_SESSION_PREFIX}${workflowKey}`;
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `chat-${crypto.randomUUID()}`;
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function deriveSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\n+/g, " ");
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  const cut = trimmed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_TITLE_LENGTH * 0.4 ? cut.slice(0, lastSpace) : cut) + "\u2026";
}

export function relativeTimeLabel(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEntry(raw: unknown, index: number): AiChatSessionEntry | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) return null;
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim().length > 0 ? raw.title : `Chat ${index + 1}`,
    createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

export function loadSessionIndex(workflowKey: string): AiChatSessionEntry[] {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) return [];
  try {
    const raw = window.localStorage.getItem(getSessionsKey(workflowKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry, i) => normalizeEntry(entry, i))
      .filter((e): e is AiChatSessionEntry => e !== null);
  } catch {
    return [];
  }
}

export function saveSessionIndex(workflowKey: string, sessions: AiChatSessionEntry[]): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) return;
  try {
    window.localStorage.setItem(getSessionsKey(workflowKey), JSON.stringify(sessions.slice(-MAX_SESSIONS)));
  } catch {}
}

export function loadActiveSessionId(workflowKey: string): string | null {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) return null;
  try {
    const raw = window.localStorage.getItem(getActiveSessionKey(workflowKey));
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function saveActiveSessionId(workflowKey: string, sessionId: string): void {
  if (typeof window === "undefined" || workflowKey.trim().length === 0) return;
  try {
    window.localStorage.setItem(getActiveSessionKey(workflowKey), sessionId);
  } catch {}
}

export function createSession(workflowKey: string, title = "New chat"): AiChatSessionEntry {
  const sessions = loadSessionIndex(workflowKey);
  const entry: AiChatSessionEntry = {
    id: createSessionId(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.push(entry);
  saveSessionIndex(workflowKey, sessions);
  saveActiveSessionId(workflowKey, entry.id);
  return entry;
}

export function updateSessionTitle(workflowKey: string, sessionId: string, title: string): void {
  const sessions = loadSessionIndex(workflowKey);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;
  session.title = title;
  saveSessionIndex(workflowKey, sessions);
}

export function updateSessionTimestamp(workflowKey: string, sessionId: string): void {
  const sessions = loadSessionIndex(workflowKey);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;
  session.updatedAt = Date.now();
  saveSessionIndex(workflowKey, sessions);
}

export function deleteSession(workflowKey: string, sessionId: string): void {
  const sessions = loadSessionIndex(workflowKey);
  saveSessionIndex(workflowKey, sessions.filter((s) => s.id !== sessionId));
  clearAiChatSession(sessionId);
}

export function resolveActiveSession(workflowKey: string): AiChatSessionEntry {
  const sessions = loadSessionIndex(workflowKey);
  const activeId = loadActiveSessionId(workflowKey);

  if (activeId) {
    const active = sessions.find((s) => s.id === activeId);
    if (active) return active;
  }

  if (sessions.length > 0) {
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    saveActiveSessionId(workflowKey, sorted[0].id);
    return sorted[0];
  }

  const legacyMessages = loadAiChatHistory(workflowKey);
  if (legacyMessages.length > 0) {
    const firstUserMsg = legacyMessages.find((m) => m.role === "user");
    const title = firstUserMsg ? deriveSessionTitle(firstUserMsg.content) : "Previous chat";
    const entry = createSession(workflowKey, title);
    moveAiChatHistory(workflowKey, entry.id);
    return entry;
  }

  return createSession(workflowKey);
}

export function moveSessionIndex(sourceWorkflowKey: string, targetWorkflowKey: string): void {
  if (
    typeof window === "undefined" ||
    sourceWorkflowKey.trim().length === 0 ||
    targetWorkflowKey.trim().length === 0 ||
    sourceWorkflowKey === targetWorkflowKey
  ) return;

  try {
    const sourceSessions = loadSessionIndex(sourceWorkflowKey);
    if (sourceSessions.length === 0) return;

    const targetSessions = loadSessionIndex(targetWorkflowKey);
    const existingIds = new Set(targetSessions.map((s) => s.id));
    const merged = [...targetSessions, ...sourceSessions.filter((s) => !existingIds.has(s.id))];
    saveSessionIndex(targetWorkflowKey, merged.slice(-MAX_SESSIONS));

    const activeId = loadActiveSessionId(sourceWorkflowKey);
    if (activeId) {
      saveActiveSessionId(targetWorkflowKey, activeId);
    }

    window.localStorage.removeItem(getSessionsKey(sourceWorkflowKey));
    window.localStorage.removeItem(getActiveSessionKey(sourceWorkflowKey));
  } catch {}
}
