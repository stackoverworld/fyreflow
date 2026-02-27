import { describe, expect, it } from "vitest";

import {
  hasProviderDraftChanges,
  isLikelyClaudeSetupToken,
  oauthStatusLine,
  shouldShowOAuthTokenInput
} from "../../src/components/dashboard/provider-settings/validation";
import type { ProviderConfig, ProviderOAuthStatus } from "../../src/lib/types";

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

function buildProvider(partial: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "claude",
    label: "Anthropic",
    authMode: "oauth",
    apiKey: "",
    oauthToken: "",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
    updatedAt: "2026-02-26T05:00:00.000Z",
    ...partial
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

describe("hasProviderDraftChanges", () => {
  it("returns false when editable provider fields are unchanged", () => {
    const saved = buildProvider({ oauthToken: "[secure]" });
    const draft = buildProvider({ oauthToken: "[secure]" });
    expect(hasProviderDraftChanges(draft, saved)).toBe(false);
  });

  it("returns true when auth mode or credentials are edited", () => {
    const saved = buildProvider({ authMode: "api_key", apiKey: "" });
    const draft = buildProvider({ authMode: "oauth", oauthToken: "sk-ant-oat01-updated" });
    expect(hasProviderDraftChanges(draft, saved)).toBe(true);
  });
});

describe("isLikelyClaudeSetupToken", () => {
  it("detects setup-token prefix", () => {
    expect(isLikelyClaudeSetupToken("sk-ant-oat01-example")).toBe(true);
  });

  it("does not flag non setup-token browser code", () => {
    expect(isLikelyClaudeSetupToken("abc123#state-1")).toBe(false);
  });
});
