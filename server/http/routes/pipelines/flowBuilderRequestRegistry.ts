import { isDeepStrictEqual } from "node:util";
import type { FlowBuilderRequest, FlowBuilderResponse } from "../../../flowBuilder/contracts.js";

type FlowBuilderRequestPayload = Omit<FlowBuilderRequest, "requestId">;
type FlowBuilderRequestStatus = "pending" | "fulfilled" | "rejected";

interface FlowBuilderRequestEntry {
  payload: FlowBuilderRequestPayload;
  status: FlowBuilderRequestStatus;
  promise: Promise<FlowBuilderResponse>;
  result?: FlowBuilderResponse;
  error?: Error;
  createdAt: number;
  updatedAt: number;
}

export interface FlowBuilderRequestRegistryOptions {
  maxEntries?: number;
  pendingTtlMs?: number;
  fulfilledTtlMs?: number;
  rejectedTtlMs?: number;
  now?: () => number;
}

export class FlowBuilderRequestConflictError extends Error {
  constructor() {
    super("Flow Builder requestId cannot be reused with a different payload.");
    this.name = "FlowBuilderRequestConflictError";
  }
}

export interface ResolveFlowBuilderRequestOptions {
  requestId: string;
  payload: FlowBuilderRequestPayload;
  execute: () => Promise<FlowBuilderResponse>;
}

interface FlowBuilderRequestRegistry {
  resolve: (options: ResolveFlowBuilderRequestOptions) => Promise<FlowBuilderResponse>;
  clear: () => void;
  size: () => number;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_PENDING_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FULFILLED_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REJECTED_TTL_MS = 2 * 60 * 1000;

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error("Flow Builder request failed.");
}

function getEntryTtlMs(entry: FlowBuilderRequestEntry, options: Required<Pick<FlowBuilderRequestRegistryOptions, "pendingTtlMs" | "fulfilledTtlMs" | "rejectedTtlMs">>): number {
  if (entry.status === "pending") {
    return options.pendingTtlMs;
  }
  if (entry.status === "fulfilled") {
    return options.fulfilledTtlMs;
  }
  return options.rejectedTtlMs;
}

export function stripFlowBuilderRequestId(request: FlowBuilderRequest): FlowBuilderRequestPayload {
  const { requestId: _ignored, ...payload } = request;
  return payload;
}

export function createFlowBuilderRequestRegistry(
  options: FlowBuilderRequestRegistryOptions = {}
): FlowBuilderRequestRegistry {
  const maxEntries = Math.max(10, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  const pendingTtlMs = Math.max(30_000, Math.floor(options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS));
  const fulfilledTtlMs = Math.max(30_000, Math.floor(options.fulfilledTtlMs ?? DEFAULT_FULFILLED_TTL_MS));
  const rejectedTtlMs = Math.max(30_000, Math.floor(options.rejectedTtlMs ?? DEFAULT_REJECTED_TTL_MS));
  const now = options.now ?? (() => Date.now());

  const entries = new Map<string, FlowBuilderRequestEntry>();

  const cleanupExpiredEntries = (): void => {
    const currentTime = now();
    for (const [requestId, entry] of entries.entries()) {
      const ttlMs = getEntryTtlMs(entry, { pendingTtlMs, fulfilledTtlMs, rejectedTtlMs });
      if (currentTime - entry.updatedAt > ttlMs) {
        entries.delete(requestId);
      }
    }
  };

  const trimToMaxEntries = (): void => {
    cleanupExpiredEntries();
    if (entries.size <= maxEntries) {
      return;
    }

    const sortedEntries = Array.from(entries.entries()).sort((left, right) => left[1].updatedAt - right[1].updatedAt);

    for (const [requestId, entry] of sortedEntries) {
      if (entries.size <= maxEntries) {
        break;
      }
      if (entry.status !== "pending") {
        entries.delete(requestId);
      }
    }

    // Keep pending entries intact so retries can still attach to in-flight work.
  };

  return {
    async resolve({
      requestId,
      payload,
      execute
    }: ResolveFlowBuilderRequestOptions): Promise<FlowBuilderResponse> {
      cleanupExpiredEntries();

      const existing = entries.get(requestId);
      if (existing) {
        if (!isDeepStrictEqual(existing.payload, payload)) {
          throw new FlowBuilderRequestConflictError();
        }

        existing.updatedAt = now();
        if (existing.status === "fulfilled" && existing.result) {
          return existing.result;
        }
        if (existing.status === "rejected" && existing.error) {
          throw existing.error;
        }
        return existing.promise;
      }

      const createdAt = now();
      const entry: FlowBuilderRequestEntry = {
        payload,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        promise: Promise.resolve()
      };

      entry.promise = Promise.resolve()
        .then(execute)
        .then((result) => {
          entry.status = "fulfilled";
          entry.result = result;
          entry.updatedAt = now();
          trimToMaxEntries();
          return result;
        })
        .catch((error) => {
          const normalizedError = normalizeError(error);
          entry.status = "rejected";
          entry.error = normalizedError;
          entry.updatedAt = now();
          trimToMaxEntries();
          throw normalizedError;
        });

      entries.set(requestId, entry);
      trimToMaxEntries();
      return entry.promise;
    },
    clear(): void {
      entries.clear();
    },
    size(): number {
      cleanupExpiredEntries();
      return entries.size;
    }
  };
}
