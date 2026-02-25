import { randomBytes, timingSafeEqual } from "node:crypto";

import { loadPairingState, savePairingState, type PairingSessionSnapshot } from "./state.js";

export type PairingSessionStatus = "pending" | "approved" | "claimed" | "cancelled" | "expired";

interface PairingSessionRecord {
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
}

export interface PairingSessionSummary {
  id: string;
  status: PairingSessionStatus;
  clientName: string;
  platform: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  approvedAt?: string;
  claimedAt?: string;
}

export interface CreatePairingSessionInput {
  clientName?: string;
  platform?: string;
  ttlSeconds?: number;
}

export interface PairingSessionCreated {
  id: string;
  code: string;
  status: PairingSessionStatus;
  clientName: string;
  platform: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface PairingSessionClaimed {
  session: PairingSessionSummary;
  deviceToken: string;
}

const DEFAULT_TTL_SECONDS = 10 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 30 * 60;
const MAX_ACTIVE_SESSIONS = 300;
const MAX_CODE_ATTEMPTS = 8;
const RETIRED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

function generatePairingCode(): string {
  const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return value.toString().padStart(6, "0");
}

function generateSessionId(): string {
  return randomBytes(18).toString("base64url");
}

function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizeTtlSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TTL_SECONDS;
  }

  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.floor(value as number)));
}

export class PairingError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "PairingError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface PairingServiceOptions {
  statePath?: string;
}

function toSummary(record: PairingSessionRecord): PairingSessionSummary {
  return {
    id: record.id,
    status: record.status,
    clientName: record.clientName,
    platform: record.platform,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    ...(record.approvedAt ? { approvedAt: record.approvedAt } : {}),
    ...(record.claimedAt ? { claimedAt: record.claimedAt } : {})
  };
}

export class PairingService {
  private readonly sessions = new Map<string, PairingSessionRecord>();
  private readonly attemptsBySessionId = new Map<string, number>();
  private readonly statePath: string | undefined;

  constructor(options: PairingServiceOptions = {}) {
    this.statePath = options.statePath;
    this.loadPersistedState();
  }

  createSession(input: CreatePairingSessionInput = {}): PairingSessionCreated {
    this.expireOldSessions();
    this.pruneRetiredSessions();

    const activeCount = [...this.sessions.values()].filter((session) => session.status === "pending").length;
    if (activeCount >= MAX_ACTIVE_SESSIONS) {
      throw new PairingError(
        "pairing_capacity_reached",
        429,
        "Too many active pairing sessions. Please retry in a minute."
      );
    }

    const createdAt = nowIso();
    const ttlSeconds = normalizeTtlSeconds(input.ttlSeconds);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const id = generateSessionId();
    const code = generatePairingCode();

    const record: PairingSessionRecord = {
      id,
      code,
      status: "pending",
      clientName: (input.clientName ?? "").trim().slice(0, 120),
      platform: (input.platform ?? "").trim().slice(0, 80),
      label: "",
      createdAt,
      updatedAt: createdAt,
      expiresAt
    };

    this.sessions.set(id, record);
    this.attemptsBySessionId.set(id, 0);
    this.persist();

    return {
      id: record.id,
      code,
      status: record.status,
      clientName: record.clientName,
      platform: record.platform,
      label: record.label,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt
    };
  }

  getSession(sessionId: string): PairingSessionSummary | null {
    const record = this.getRecordOrNull(sessionId);
    if (!record) {
      return null;
    }
    return toSummary(record);
  }

  approveSession(sessionId: string, codeInput: string, labelInput?: string): PairingSessionSummary {
    const record = this.getRecordOrThrow(sessionId);
    this.assertCode(record, codeInput);
    this.ensureActive(record);

    if (record.status === "cancelled") {
      throw new PairingError("pairing_cancelled", 409, "Pairing session has been cancelled.");
    }
    if (record.status === "claimed") {
      throw new PairingError("pairing_already_claimed", 409, "Pairing session has already been claimed.");
    }

    const now = nowIso();
    if (record.status !== "approved") {
      record.status = "approved";
      record.approvedAt = now;
      record.deviceToken = generateDeviceToken();
    }

    record.label = (labelInput ?? "").trim().slice(0, 120);
    record.updatedAt = now;
    this.persist();

    return toSummary(record);
  }

  claimSession(sessionId: string, codeInput: string): PairingSessionClaimed {
    const record = this.getRecordOrThrow(sessionId);
    this.assertCode(record, codeInput);
    this.ensureActive(record);

    if (record.status === "cancelled") {
      throw new PairingError("pairing_cancelled", 409, "Pairing session has been cancelled.");
    }

    if (record.status === "pending") {
      throw new PairingError("pairing_not_approved", 409, "Pairing session is not approved yet.");
    }

    if (record.status === "claimed") {
      throw new PairingError("pairing_already_claimed", 409, "Pairing session has already been claimed.");
    }

    const token = record.deviceToken;
    if (!token) {
      throw new PairingError("pairing_missing_token", 500, "Device token is unavailable for this pairing session.");
    }

    record.status = "claimed";
    record.claimedAt = nowIso();
    record.updatedAt = record.claimedAt;
    this.persist();

    return {
      session: toSummary(record),
      deviceToken: token
    };
  }

  cancelSession(sessionId: string): PairingSessionSummary {
    const record = this.getRecordOrThrow(sessionId);
    this.ensureActive(record);

    if (record.status === "claimed") {
      throw new PairingError("pairing_already_claimed", 409, "Pairing session has already been claimed.");
    }

    record.status = "cancelled";
    record.updatedAt = nowIso();
    record.deviceToken = undefined;
    this.persist();
    return toSummary(record);
  }

  isDeviceTokenValid(token: string): boolean {
    const candidate = token.trim();
    if (candidate.length === 0) {
      return false;
    }

    for (const session of this.sessions.values()) {
      if (session.status !== "claimed" || !session.deviceToken) {
        continue;
      }

      if (constantTimeEquals(session.deviceToken, candidate)) {
        return true;
      }
    }

    return false;
  }

  private getRecordOrNull(sessionId: string): PairingSessionRecord | null {
    const normalized = sessionId.trim();
    if (normalized.length === 0) {
      return null;
    }

    const record = this.sessions.get(normalized);
    if (!record) {
      return null;
    }
    if (this.refreshExpiry(record)) {
      this.persist();
    }
    return this.sessions.get(normalized) ?? null;
  }

  private getRecordOrThrow(sessionId: string): PairingSessionRecord {
    const normalized = sessionId.trim();
    if (normalized.length === 0) {
      throw new PairingError("pairing_session_invalid", 400, "Pairing session id is required.");
    }

    const record = this.getRecordOrNull(normalized);
    if (!record) {
      throw new PairingError("pairing_session_not_found", 404, "Pairing session not found.");
    }
    return record;
  }

  private refreshExpiry(record: PairingSessionRecord): boolean {
    if (record.status === "expired") {
      return false;
    }

    if (Date.now() <= Date.parse(record.expiresAt)) {
      return false;
    }

    record.status = "expired";
    record.updatedAt = nowIso();
    record.deviceToken = undefined;
    return true;
  }

  private ensureActive(record: PairingSessionRecord): void {
    if (this.refreshExpiry(record)) {
      this.persist();
    }
    if (record.status === "expired") {
      throw new PairingError("pairing_expired", 410, "Pairing session has expired.");
    }
  }

  private assertCode(record: PairingSessionRecord, rawCode: string): void {
    const normalizedCode = normalizeCode(rawCode);
    if (normalizedCode.length !== 6) {
      throw new PairingError("pairing_code_invalid", 400, "Pairing code must contain 6 digits.");
    }

    const attempts = this.attemptsBySessionId.get(record.id) ?? 0;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      throw new PairingError("pairing_code_locked", 429, "Too many invalid code attempts.");
    }

    if (constantTimeEquals(record.code, normalizedCode)) {
      this.attemptsBySessionId.set(record.id, 0);
      this.persist();
      return;
    }

    this.attemptsBySessionId.set(record.id, attempts + 1);
    this.persist();
    throw new PairingError("pairing_code_mismatch", 401, "Pairing code is incorrect.");
  }

  private expireOldSessions(): void {
    let changed = false;
    for (const record of this.sessions.values()) {
      if (record.status === "expired" || record.status === "claimed") {
        continue;
      }

      if (Date.now() > Date.parse(record.expiresAt)) {
        changed = this.refreshExpiry(record) || changed;
      }
    }

    if (changed) {
      this.persist();
    }
  }

  private loadPersistedState(): void {
    const persisted = loadPairingState(this.statePath);
    for (const session of persisted.sessions) {
      this.sessions.set(session.id, {
        ...session
      });
    }

    for (const [sessionId, attempts] of Object.entries(persisted.attemptsBySessionId)) {
      this.attemptsBySessionId.set(sessionId, attempts);
    }

    this.expireOldSessions();
    this.pruneRetiredSessions();
  }

  private pruneRetiredSessions(): void {
    const threshold = Date.now() - RETIRED_SESSION_RETENTION_MS;
    let changed = false;

    for (const session of this.sessions.values()) {
      if (session.status !== "expired" && session.status !== "cancelled") {
        continue;
      }

      const updatedAtMs = Date.parse(session.updatedAt);
      if (!Number.isFinite(updatedAtMs) || updatedAtMs > threshold) {
        continue;
      }

      this.sessions.delete(session.id);
      this.attemptsBySessionId.delete(session.id);
      changed = true;
    }

    if (changed) {
      this.persist();
    }
  }

  private persist(): void {
    const sessions: PairingSessionSnapshot[] = [...this.sessions.values()].map((session) => ({
      ...session
    }));
    const attemptsBySessionId = Object.fromEntries(this.attemptsBySessionId.entries());

    try {
      savePairingState(
        {
          sessions,
          attemptsBySessionId
        },
        this.statePath
      );
    } catch (error) {
      console.error("[pairing-state-persist-error]", error);
    }
  }
}
