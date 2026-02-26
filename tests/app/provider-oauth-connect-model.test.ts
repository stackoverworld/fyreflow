import { describe, expect, it } from "vitest";

import {
  buildProviderOAuthStartErrorMessage,
  buildProviderOAuthStartMessage,
  getProviderOAuthLoginUrl,
  resolveProviderOAuthLoginUrl,
  shouldOpenProviderOAuthBrowser
} from "../../src/components/dashboard/providerOauthConnectModel";

describe("provider oauth connect model", () => {
  it("maps provider ids to deterministic login urls", () => {
    expect(getProviderOAuthLoginUrl("openai")).toBe("https://chatgpt.com");
    expect(getProviderOAuthLoginUrl("claude")).toBe("https://claude.ai/login");
  });

  it("prefers backend pairing url when oauth start returns one", () => {
    expect(resolveProviderOAuthLoginUrl("claude", "https://claude.ai/device?pairing=abc123")).toBe(
      "https://claude.ai/device?pairing=abc123"
    );
    expect(resolveProviderOAuthLoginUrl("claude", "  ")).toBe("https://claude.ai/login");
  });

  it("opens browser only when using remote connection mode", () => {
    expect(shouldOpenProviderOAuthBrowser("remote")).toBe(true);
    expect(shouldOpenProviderOAuthBrowser("local")).toBe(false);
  });

  it("keeps API message unchanged for local mode", () => {
    const message = buildProviderOAuthStartMessage({
      connectionMode: "local",
      providerId: "claude",
      apiMessage: "Claude browser login started.",
      command: "claude auth login"
    });

    expect(message).toBe("Claude browser login started.");
  });

  it("adds remote guidance with pairing url and command", () => {
    const message = buildProviderOAuthStartMessage({
      connectionMode: "remote",
      providerId: "claude",
      apiMessage: "Claude browser login started.",
      command: "claude auth login",
      authUrl: "https://claude.ai/device?pairing=abc123",
      authCode: "CLAUDE-PAIR-777"
    });

    expect(message).toContain("Remote mode is active");
    expect(message).toContain("https://claude.ai/device?pairing=abc123");
    expect(message).toContain("Enter one-time code");
    expect(message).toContain("Claude authorization page");
    expect(message).toContain("\"claude auth login\"");
  });

  it("includes one-time code and generic command hint when command is unavailable", () => {
    const message = buildProviderOAuthStartMessage({
      connectionMode: "remote",
      providerId: "openai",
      apiMessage: "",
      command: "",
      authCode: "ABC-123-XYZ"
    });

    expect(message).toContain("did not return an OAuth URL yet");
    expect(message).toContain("Enter one-time code ABC-123-XYZ on the Codex device page.");
    expect(message).toContain("Run the provider CLI login command on the remote server terminal");
    expect(message).toContain('Enable device code authorization');
    expect(message).toContain("ChatGPT Settings -> Security");
  });

  it("instructs manual remote CLI run when backend did not return auth url", () => {
    const message = buildProviderOAuthStartMessage({
      connectionMode: "remote",
      providerId: "claude",
      apiMessage: "Claude browser login started.",
      command: "claude auth login",
      authUrl: ""
    });

    expect(message).toContain("did not return an OAuth URL yet");
    expect(message).toContain("\"claude auth login\"");
    expect(message).not.toContain("https://claude.ai/login");
  });

  it("includes codex security setting troubleshooting for remote oauth", () => {
    const message = buildProviderOAuthStartMessage({
      connectionMode: "remote",
      providerId: "openai",
      apiMessage: "Codex browser login started.",
      command: "codex login --device-auth",
      authUrl: "https://chatgpt.com/codex/device",
      authCode: "CODE-1234"
    });

    expect(message).toContain("https://chatgpt.com/codex/device");
    expect(message).toContain("Enter one-time code CODE-1234 on the Codex device page.");
    expect(message).toContain("device code authorization");
  });

  it("explains that remote oauth requires cli on the server when missing", () => {
    const message = buildProviderOAuthStartErrorMessage({
      connectionMode: "remote",
      providerId: "claude",
      errorMessage: 'Claude CLI command "claude" is not installed.'
    });

    expect(message).toContain("remote server");
    expect(message).toContain("Install Claude CLI");
  });

  it("keeps raw error text in local mode", () => {
    const message = buildProviderOAuthStartErrorMessage({
      connectionMode: "local",
      providerId: "openai",
      errorMessage: "Network timeout."
    });

    expect(message).toBe("Network timeout.");
  });
});
