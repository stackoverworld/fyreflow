import { describe, expect, it } from "vitest";

import {
  oauthStatusLine,
  shouldShowOAuthTokenInput
} from "../../src/components/dashboard/provider-settings/validation";
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

describe("shouldShowOAuthTokenInput", () => {
  it("shows token input for Claude in OAuth mode (setup-token fallback)", () => {
    expect(shouldShowOAuthTokenInput("oauth", "claude")).toBe(true);
  });

  it("keeps token input hidden only for providers without OAuth token support", () => {
    expect(shouldShowOAuthTokenInput("oauth", "openai")).toBe(true);
    expect(shouldShowOAuthTokenInput("api_key", "claude")).toBe(true);
  });
});
