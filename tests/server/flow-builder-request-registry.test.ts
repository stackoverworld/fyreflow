import { describe, expect, it, vi } from "vitest";
import {
  createFlowBuilderRequestRegistry,
  FlowBuilderRequestConflictError
} from "../../server/http/routes/pipelines/flowBuilderRequestRegistry.js";
import type { FlowBuilderRequest, FlowBuilderResponse } from "../../server/flowBuilder/contracts.js";

type FlowBuilderRequestPayload = Omit<FlowBuilderRequest, "requestId">;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createPayload(partial: Partial<FlowBuilderRequestPayload> = {}): FlowBuilderRequestPayload {
  return {
    prompt: "Build a flow",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    ...partial
  };
}

function createResponse(partial: Partial<FlowBuilderResponse> = {}): FlowBuilderResponse {
  return {
    action: "answer",
    message: "Done",
    source: "fallback",
    notes: ["ok"],
    ...partial
  };
}

describe("flowBuilderRequestRegistry", () => {
  it("deduplicates in-flight requests by requestId and payload", async () => {
    const registry = createFlowBuilderRequestRegistry();
    const deferred = createDeferred<FlowBuilderResponse>();
    const execute = vi.fn(async () => deferred.promise);
    const payload = createPayload();

    const first = registry.resolve({ requestId: "req-1", payload, execute });
    const second = registry.resolve({ requestId: "req-1", payload, execute });

    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);

    const response = createResponse({ message: "Shared response" });
    deferred.resolve(response);

    await expect(first).resolves.toEqual(response);
    await expect(second).resolves.toEqual(response);
  });

  it("returns cached completion for matching requestId and payload", async () => {
    const registry = createFlowBuilderRequestRegistry();
    const payload = createPayload();
    const execute = vi.fn(async () => createResponse({ message: "First result" }));

    const first = await registry.resolve({ requestId: "req-cache", payload, execute });
    const second = await registry.resolve({ requestId: "req-cache", payload, execute });

    expect(first.message).toBe("First result");
    expect(second.message).toBe("First result");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects requestId reuse with a different payload", async () => {
    const registry = createFlowBuilderRequestRegistry();
    const execute = vi.fn(async () => createResponse());

    await registry.resolve({
      requestId: "req-conflict",
      payload: createPayload({ prompt: "Original" }),
      execute
    });

    await expect(
      registry.resolve({
        requestId: "req-conflict",
        payload: createPayload({ prompt: "Different" }),
        execute
      })
    ).rejects.toBeInstanceOf(FlowBuilderRequestConflictError);
  });

  it("replays the same failure for duplicate retries", async () => {
    const registry = createFlowBuilderRequestRegistry();
    const payload = createPayload();
    const execute = vi.fn(async () => {
      throw new Error("provider timeout");
    });

    await expect(
      registry.resolve({ requestId: "req-error", payload, execute })
    ).rejects.toThrow("provider timeout");

    await expect(
      registry.resolve({ requestId: "req-error", payload, execute })
    ).rejects.toThrow("provider timeout");

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
