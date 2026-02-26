import { describe, expect, it } from "vitest";

import { oauthStatusLine } from "../../src/components/dashboard/provider-settings/validation";
import type { ProviderOAuthStatus } from "../../src/lib/types";

function buildStatus(message: string): ProviderOAuthStatus {
  return {
    providerId: "claude",
    loginSource: "claude-cli",
    cliCommand: "claude",
    cliAvailable: true,
    loggedIn: false,
    tokenAvailable: false,
    canUseApi: false,
    canUseCli: false,
    message,
    checkedAt: "2026-02-26T05:00:00.000Z"
  };
}

describe("oauthStatusLine", () => {
  it("uses explicit UI message when it differs from backend status", () => {
    const line = oauthStatusLine(buildStatus("Not logged in. Start browser login."), "Authorization code submitted.");
    expect(line).toContain("Authorization code submitted.");
    expect(line).not.toContain("Not logged in. Start browser login.");
  });

  it("uses backend status message when no explicit UI message is provided", () => {
    const line = oauthStatusLine(buildStatus("Logged in with Claude Code."), "");
    expect(line).toContain("Logged in with Claude Code.");
  });
});
