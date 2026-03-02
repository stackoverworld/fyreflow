import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isCommandAvailable: vi.fn(async () => true),
  execFileAsync: vi.fn(async () => ({
    stdout: JSON.stringify({
      loggedIn: false
    }),
    stderr: ""
  }))
}));

vi.mock("../../server/oauth/commandUtils.js", () => ({
  isCommandAvailable: mocks.isCommandAvailable,
  execFileAsync: mocks.execFileAsync
}));

import { submitClaudeOAuthCode } from "../../server/oauth/providers/claude.js";

describe("submitClaudeOAuthCode", () => {
  beforeEach(() => {
    mocks.isCommandAvailable.mockReset();
    mocks.execFileAsync.mockReset();
    mocks.isCommandAvailable.mockResolvedValue(true);
    mocks.execFileAsync.mockResolvedValue({
      stdout: JSON.stringify({
        loggedIn: false
      }),
      stderr: ""
    });
  });

  it("rejects when Claude CLI is not installed", async () => {
    mocks.isCommandAvailable.mockResolvedValue(false);
    await expect(submitClaudeOAuthCode("claude", "abc#state")).rejects.toThrow(
      /Claude CLI command ".*" is not installed\./
    );
  });

  it("returns accepted when CLI is already authenticated", async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: JSON.stringify({
        loggedIn: true
      }),
      stderr: ""
    });

    await expect(submitClaudeOAuthCode("claude", "abc#state")).resolves.toEqual({
      providerId: "claude",
      accepted: true,
      message:
        "Claude CLI is already authenticated. Browser Authentication Code submit is not required here."
    });
  });

  it("returns setup-token guidance when CLI is not authenticated", async () => {
    await expect(submitClaudeOAuthCode("claude", "abc#state")).resolves.toEqual({
      providerId: "claude",
      accepted: false,
      message:
        "Browser Authentication Code submit is not supported in this dashboard for Claude. Click Connect, approve in browser, then Refresh status. For API fallback, run `claude setup-token`, paste token (sk-ant-oat01-...) in dashboard and Save changes."
    });
  });
});
