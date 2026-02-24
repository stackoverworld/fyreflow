import { describe, expect, it } from "vitest";

import { formatRunInputsSummary } from "../../server/runInputs.js";
import { redactContextForRunState } from "../../server/runner/scheduling/state.js";

describe("run input redaction", () => {
  it("redacts sensitive values in run input summary", () => {
    const summary = formatRunInputsSummary({
      source_links: "https://example.com/a,https://example.com/b",
      source_api_key: "sk-live-secret",
      access_token: "token-123"
    });

    expect(summary).toContain("- source_links: https://example.com/a,https://example.com/b");
    expect(summary).toContain("- source_api_key: [REDACTED]");
    expect(summary).toContain("- access_token: [REDACTED]");
    expect(summary).not.toContain("sk-live-secret");
    expect(summary).not.toContain("token-123");
  });

  it("redacts sensitive run input values from persisted context", () => {
    const context = [
      "Task: analyze docs",
      "Run inputs:",
      "- source_api_key: sk-live-secret",
      "Direct token usage: sk-live-secret"
    ].join("\n");

    const redacted = redactContextForRunState(context, {
      source_api_key: "sk-live-secret",
      source_links: "https://example.com/a"
    });

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("sk-live-secret");
  });
});
