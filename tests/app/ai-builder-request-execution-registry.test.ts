import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearFlowBuilderRequestExecutionsForTest,
  executeFlowBuilderRequestOnce
} from "../../src/components/dashboard/ai-builder/requestExecutionRegistry";

afterEach(() => {
  clearFlowBuilderRequestExecutionsForTest();
});

describe("AI builder request execution registry", () => {
  it("joins duplicate in-flight request executions", async () => {
    let resolveExecution: (() => void) | null = null;
    const execute = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveExecution = resolve;
        })
    );

    const first = executeFlowBuilderRequestOnce("req-1", execute);
    const second = executeFlowBuilderRequestOnce("req-1", execute);

    expect(first.joinedExisting).toBe(false);
    expect(second.joinedExisting).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);

    resolveExecution?.();
    await Promise.all([first.promise, second.promise]);
  });

  it("allows a request id to execute again after completion", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);

    const first = executeFlowBuilderRequestOnce("req-2", execute);
    await first.promise;
    const second = executeFlowBuilderRequestOnce("req-2", execute);
    await second.promise;

    expect(first.joinedExisting).toBe(false);
    expect(second.joinedExisting).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
