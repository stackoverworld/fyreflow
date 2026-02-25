import fs from "node:fs";
import path from "node:path";

import type { PairingSessionStatus } from "./service.js";

export const PAIRING_STATE_PATH = path.resolve(process.cwd(), "data", "pairing-state.json");

export interface PairingSessionSnapshot {
  id: string;
  code: string;
  status: PairingSessionStatus;
  clientName: string;
  platform: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  approvedAt?: string;
  claimedAt?: string;
  deviceToken?: string;
  deviceTokenExpiresAt?: string;
}

export interface PairingStateSnapshot {
  sessions: PairingSessionSnapshot[];
  attemptsBySessionId: Record<string, number>;
}

interface PairingStateFile {
  version: 1;
  updatedAt: string;
  sessions: PairingSessionSnapshot[];
  attemptsBySessionId: Record<string, number>;
}

const VALID_STATUSES = new Set<PairingSessionStatus>(["pending", "approved", "claimed", "cancelled", "expired"]);
const MAX_PERSISTED_SESSIONS = 2_000;

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function normalizeSessionSnapshot(value: unknown): PairingSessionSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const code = typeof value.code === "string" ? value.code.trim() : "";
  const status = typeof value.status === "string" ? value.status : "";
  const clientName = typeof value.clientName === "string" ? value.clientName.slice(0, 120) : "";
  const platform = typeof value.platform === "string" ? value.platform.slice(0, 80) : "";
  const label = typeof value.label === "string" ? value.label.slice(0, 120) : "";
  const createdAt = normalizeIsoDate(value.createdAt);
  const updatedAt = normalizeIsoDate(value.updatedAt);
  const expiresAt = normalizeIsoDate(value.expiresAt);

  if (
    id.length === 0 ||
    code.length !== 6 ||
    !VALID_STATUSES.has(status as PairingSessionStatus) ||
    !createdAt ||
    !updatedAt ||
    !expiresAt
  ) {
    return null;
  }

  const approvedAt = normalizeIsoDate(value.approvedAt);
  const claimedAt = normalizeIsoDate(value.claimedAt);
  const deviceToken = typeof value.deviceToken === "string" && value.deviceToken.trim().length > 0
    ? value.deviceToken.trim()
    : undefined;
  const deviceTokenExpiresAt = normalizeIsoDate(value.deviceTokenExpiresAt);

  return {
    id,
    code,
    status: status as PairingSessionStatus,
    clientName,
    platform,
    label,
    createdAt,
    updatedAt,
    expiresAt,
    ...(approvedAt ? { approvedAt } : {}),
    ...(claimedAt ? { claimedAt } : {}),
    ...(deviceToken ? { deviceToken } : {}),
    ...(deviceTokenExpiresAt ? { deviceTokenExpiresAt } : {})
  };
}

function normalizeAttempts(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, number> = {};
  for (const [rawSessionId, rawAttempts] of Object.entries(value)) {
    const sessionId = rawSessionId.trim();
    if (sessionId.length === 0) {
      continue;
    }

    if (typeof rawAttempts !== "number" || !Number.isFinite(rawAttempts)) {
      continue;
    }

    output[sessionId] = Math.max(0, Math.floor(rawAttempts));
  }

  return output;
}

export function loadPairingState(statePath = PAIRING_STATE_PATH): PairingStateSnapshot {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {
        sessions: [],
        attemptsBySessionId: {}
      };
    }

    const rawSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const sessions = rawSessions
      .map((session) => normalizeSessionSnapshot(session))
      .filter((session): session is PairingSessionSnapshot => session !== null)
      .slice(0, MAX_PERSISTED_SESSIONS);

    const attemptsBySessionId = normalizeAttempts(parsed.attemptsBySessionId);

    return {
      sessions,
      attemptsBySessionId
    };
  } catch {
    return {
      sessions: [],
      attemptsBySessionId: {}
    };
  }
}

export function savePairingState(
  state: PairingStateSnapshot,
  statePath = PAIRING_STATE_PATH
): void {
  const deduped = new Map<string, PairingSessionSnapshot>();
  for (const session of state.sessions) {
    deduped.set(session.id, session);
  }

  const sessions = Array.from(deduped.values())
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_PERSISTED_SESSIONS);

  const allowedIds = new Set(sessions.map((session) => session.id));
  const attemptsBySessionId: Record<string, number> = {};
  for (const [sessionId, attempts] of Object.entries(state.attemptsBySessionId ?? {})) {
    if (!allowedIds.has(sessionId)) {
      continue;
    }
    attemptsBySessionId[sessionId] = Math.max(0, Math.floor(attempts));
  }

  const payload: PairingStateFile = {
    version: 1,
    updatedAt: nowIso(),
    sessions,
    attemptsBySessionId
  };

  const dirPath = path.dirname(statePath);
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  try {
    fs.chmodSync(statePath, 0o600);
  } catch {
    // Ignore chmod errors on non-POSIX filesystems.
  }
}
