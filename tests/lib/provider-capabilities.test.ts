import { describe, expect, it } from "vitest";
import {
  canUseClaudeFastMode,
  getClaudeFastModeUnavailableNote
} from "../../src/lib/providerCapabilities";
import type { ProviderConfig } from "../../src/lib/types";

function makeClaudeProvider(partial: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "claude",
    label: "Anthropic",
    authMode: "oauth",
    apiKey: "",
    oauthToken: "",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

describe("providerCapabilities", () => {
  it("allows Claude fast mode only with active API key auth", () => {
    expect(canUseClaudeFastMode(makeClaudeProvider())).toBe(false);
    expect(canUseClaudeFastMode(makeClaudeProvider({ authMode: "api_key", apiKey: "" }))).toBe(false);
    expect(canUseClaudeFastMode(makeClaudeProvider({ authMode: "api_key", apiKey: "sk-ant-test" }))).toBe(true);
  });

  it("returns actionable note when fast mode is unavailable", () => {
    expect(getClaudeFastModeUnavailableNote(null)).toContain("loading");
    expect(getClaudeFastModeUnavailableNote(makeClaudeProvider())).toContain("API key auth");
    expect(
      getClaudeFastModeUnavailableNote(makeClaudeProvider({ authMode: "api_key", apiKey: "" }))
    ).toContain("active Claude API key");
  });
});
