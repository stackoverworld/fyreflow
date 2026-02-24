import { afterEach, describe, expect, it, vi } from "vitest";

import { generateFlowDraft } from "../../src/lib/api";
import type { FlowBuilderRequest, FlowBuilderResponse } from "../../src/lib/types";

const originalFetch = global.fetch;

const flowBuilderRequest: FlowBuilderRequest = {
  prompt: "Draft a simple QA workflow.",
  providerId: "claude",
  model: "claude-sonnet-4-6"
};

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generateFlowDraft", () => {
  it("retries once when the first attempt fails with a network error", async () => {
    const responsePayload: FlowBuilderResponse = {
      action: "answer",
      message: "Draft ready",
      source: "model",
      notes: []
    };

    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      ) as typeof fetch;

    await expect(generateFlowDraft(flowBuilderRequest)).resolves.toEqual(responsePayload);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the server responds with an HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    await expect(generateFlowDraft(flowBuilderRequest)).rejects.toThrow("Service unavailable");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails with timeout when flow builder request exceeds deadline", async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn().mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("Missing abort signal"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("Aborted"));
          },
          { once: true }
        );
      });
    }) as typeof fetch;

    const requestPromise = generateFlowDraft(flowBuilderRequest);
    void requestPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(480_000);

    await expect(requestPromise).rejects.toThrow(
      "Network timeout (POST /api/flow-builder/generate): Request timed out after 480000ms"
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
