import { describe, expect, it } from "vitest";
import {
  getClaude1MContextUnavailableNote,
  canUseClaudeFastMode,
  canUseOpenAiFastMode,
  getClaudeFastModeUnavailableNote,
  getOpenAiFastModeUnavailableNote
} from "../../src/lib/providerCapabilities";
import type { ProviderConfig, ProviderOAuthStatus } from "../../src/lib/types";

function makeProvider(id: "openai" | "claude", partial: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    label: id === "openai" ? "OpenAI / Codex" : "Anthropic",
    authMode: "oauth",
    apiKey: "",
    oauthToken: "",
    baseUrl: id === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com/v1",
    defaultModel: id === "openai" ? "gpt-5.4" : "claude-sonnet-4-6",
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

function makeStatus(partial: Partial<ProviderOAuthStatus> = {}): ProviderOAuthStatus {
  return {
    providerId: "claude",
    loginSource: "claude-cli",
    cliCommand: "claude",
    cliAvailable: true,
    loggedIn: true,
    tokenAvailable: true,
    canUseApi: false,
    canUseCli: true,
    message: "Claude CLI is ready",
    checkedAt: new Date().toISOString(),
    ...partial
  };
}

describe("providerCapabilities", () => {
  it("allows OpenAI fast mode with active API key auth", () => {
    expect(canUseOpenAiFastMode(makeProvider("openai", { authMode: "api_key", apiKey: "" }))).toBe(false);
    expect(canUseOpenAiFastMode(makeProvider("openai", { authMode: "api_key", apiKey: "sk-openai-test" }))).toBe(true);
  });

  it("allows OpenAI fast mode with OAuth auth", () => {
    expect(canUseOpenAiFastMode(makeProvider("openai", { authMode: "oauth" }))).toBe(true);
  });

  it("allows Claude fast mode only for Opus 4.6 with an eligible auth path", () => {
    expect(canUseClaudeFastMode(makeProvider("claude", { authMode: "api_key", apiKey: "" }), "claude-opus-4-6")).toBe(false);
    expect(
      canUseClaudeFastMode(makeProvider("claude", { authMode: "api_key", apiKey: "sk-ant-test" }), "claude-opus-4-6")
    ).toBe(true);
    expect(
      canUseClaudeFastMode(makeProvider("claude", { authMode: "api_key", apiKey: "sk-ant-test" }), "claude-sonnet-4-6")
    ).toBe(false);
  });

  it("treats Claude OAuth fast mode as model-aware and best-effort", () => {
    expect(
      canUseClaudeFastMode(
        makeProvider("claude", { authMode: "oauth", oauthToken: "[secure]" }),
        "claude-opus-4-6",
        makeStatus()
      )
    ).toBe(true);
    expect(
      canUseClaudeFastMode(
        makeProvider("claude", { authMode: "oauth", oauthToken: "[secure]" }),
        "claude-sonnet-4-6",
        makeStatus()
      )
    ).toBe(false);
  });

  it("returns empty note when OpenAI fast mode is available", () => {
    expect(getOpenAiFastModeUnavailableNote(makeProvider("openai", { authMode: "oauth" }))).toBe("");
    expect(
      getOpenAiFastModeUnavailableNote(makeProvider("openai", { authMode: "api_key", apiKey: "sk-openai-test" }))
    ).toBe("");
  });

  it("returns account-gated guidance when Claude fast mode is only maybe available", () => {
    expect(
      getClaudeFastModeUnavailableNote(
        makeProvider("claude", { authMode: "oauth", oauthToken: "[secure]" }),
        "claude-opus-4-6",
        makeStatus()
      )
    ).toContain("may be available");
    expect(
      getClaudeFastModeUnavailableNote(
        makeProvider("claude", { authMode: "api_key", apiKey: "sk-ant-test" }),
        "claude-opus-4-6"
      )
    ).toContain("may be available");
  });

  it("returns actionable note when OpenAI fast mode is unavailable", () => {
    expect(getOpenAiFastModeUnavailableNote(null)).toContain("loading");
    expect(
      getOpenAiFastModeUnavailableNote(makeProvider("openai", { authMode: "api_key", apiKey: "" }))
    ).toContain("active OpenAI API key");
  });

  it("returns actionable note when Claude fast mode is unavailable", () => {
    expect(getClaudeFastModeUnavailableNote(null)).toContain("loading");
    expect(
      getClaudeFastModeUnavailableNote(makeProvider("claude", { authMode: "api_key", apiKey: "" }), "claude-opus-4-6")
    ).toContain("active Claude API key");
    expect(
      getClaudeFastModeUnavailableNote(makeProvider("claude", { authMode: "api_key", apiKey: "sk-ant-test" }), "claude-sonnet-4-6")
    ).toContain("Opus 4.6");
  });

  it("marks Claude 1M context unavailable on OAuth-authenticated paths", () => {
    expect(
      getClaude1MContextUnavailableNote(
        makeProvider("claude", { authMode: "oauth", oauthToken: "[secure]" }),
        "claude-opus-4-6",
        makeStatus()
      )
    ).toContain("skipped on OAuth");
  });
});
