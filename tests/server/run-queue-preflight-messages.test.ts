import { describe, expect, it } from "vitest";

import { formatFailedPreflightCheck, RunPreflightError } from "../../server/runtime/runQueue.js";

describe("run queue preflight messaging", () => {
  it("uses remediation-oriented message for recoverable input composition failures", () => {
    const error = new RunPreflightError([
      {
        id: "input:url_nested_scheme:step-1:prompt",
        title: "Input URL composition",
        status: "fail",
        message: "Rendered prompt contains a nested URL in endpoint path."
      }
    ]);

    expect(error.message).toContain("Run requires corrected runtime inputs");
    expect(formatFailedPreflightCheck(error.failedChecks[0])).toContain("Runtime inputs need correction");
  });

  it("keeps default messaging for ordinary preflight failures", () => {
    const error = new RunPreflightError([
      {
        id: "provider:openai",
        title: "Provider OpenAI",
        status: "fail",
        message: "Authentication is missing."
      }
    ]);

    expect(error.message).toContain("Run blocked by preflight");
    expect(formatFailedPreflightCheck(error.failedChecks[0])).toBe("Provider OpenAI: Authentication is missing.");
  });
});

