import { describe, expect, it } from "vitest";

import {
  extractClaudeAuthorizationStateInput,
  normalizeClaudeAuthorizationCodeInput
} from "../../server/oauth/providers/claude.js";

describe("normalizeClaudeAuthorizationCodeInput", () => {
  it("keeps plain authorization code unchanged", () => {
    expect(normalizeClaudeAuthorizationCodeInput("  abcDEF123  ")).toBe("abcDEF123");
  });

  it("extracts code from full callback url", () => {
    const input =
      "https://platform.claude.com/oauth/code/callback?code=abc123%2Bz&state=state-value";
    expect(normalizeClaudeAuthorizationCodeInput(input)).toBe("abc123+z#state-value");
  });

  it("extracts code from raw query payload", () => {
    expect(normalizeClaudeAuthorizationCodeInput("code=token-value-1&state=foo")).toBe(
      "token-value-1#foo"
    );
  });

  it("returns trimmed raw input when callback code is absent", () => {
    expect(normalizeClaudeAuthorizationCodeInput("   just-some-string   ")).toBe("just-some-string");
  });

  it("appends fallback state when raw code has no state suffix", () => {
    expect(normalizeClaudeAuthorizationCodeInput("raw-code-only", "session-state-1")).toBe(
      "raw-code-only#session-state-1"
    );
  });
});

describe("extractClaudeAuthorizationStateInput", () => {
  it("extracts state from callback url", () => {
    expect(
      extractClaudeAuthorizationStateInput(
        "https://platform.claude.com/oauth/code/callback?code=abc123%2Bz&state=state-value-1"
      )
    ).toBe("state-value-1");
  });

  it("extracts state from code#state input", () => {
    expect(extractClaudeAuthorizationStateInput("abc123#state-value-2")).toBe("state-value-2");
  });

  it("returns undefined when state is missing", () => {
    expect(extractClaudeAuthorizationStateInput("abc123")).toBeUndefined();
  });
});
