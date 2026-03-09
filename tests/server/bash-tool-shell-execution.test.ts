import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUILTIN_SHELL_SERVER_ID,
  buildShellGuidance,
  executeBuiltinShellCall,
  isBuiltinShellServer,
  shouldEnableBuiltinShell
} from "../../server/runner/bashTool.js";

describe("bash tool – built-in shell execution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("identifies the built-in shell server ID", () => {
    expect(isBuiltinShellServer(BUILTIN_SHELL_SERVER_ID)).toBe(true);
    expect(isBuiltinShellServer("some-mcp-server")).toBe(false);
  });

  it("enables shell only for sandboxMode full", () => {
    expect(shouldEnableBuiltinShell("full")).toBe(true);
    expect(shouldEnableBuiltinShell("secure")).toBe(false);
    expect(shouldEnableBuiltinShell("auto")).toBe(false);
    expect(shouldEnableBuiltinShell(undefined)).toBe(false);
  });

  it("executes a simple command and returns stdout", async () => {
    const result = await executeBuiltinShellCall(
      "run_command",
      { command: "echo hello_world" },
      5000
    );

    expect(result.ok).toBe(true);
    expect(result.serverId).toBe(BUILTIN_SHELL_SERVER_ID);
    expect(result.tool).toBe("run_command");
    expect(typeof result.output === "string" && result.output.includes("hello_world")).toBe(true);
  });

  it("returns error for unknown tool", async () => {
    const result = await executeBuiltinShellCall("unknown_tool", {}, 5000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown shell tool");
  });

  it("returns error for empty command", async () => {
    const result = await executeBuiltinShellCall("run_command", { command: "" }, 5000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("captures exit code on non-zero exit", async () => {
    const result = await executeBuiltinShellCall(
      "run_command",
      { command: "exit 42" },
      5000
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("42");
  });

  it("blocks network-style shell commands by default", async () => {
    const result = await executeBuiltinShellCall(
      "run_command",
      { command: "curl https://example.com" },
      5000
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("disabled by default");
  });

  it("does not inherit arbitrary parent environment variables", async () => {
    vi.stubEnv("FYREFLOW_TEST_SECRET_ENV", "super-secret-value");

    const result = await executeBuiltinShellCall(
      "run_command",
      { command: "printf %s \"$FYREFLOW_TEST_SECRET_ENV\"" },
      5000
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe("(no output)");
  });

  it("shell guidance mentions server ID and run_command", () => {
    const guidance = buildShellGuidance();
    expect(guidance).toContain(BUILTIN_SHELL_SERVER_ID);
    expect(guidance).toContain("run_command");
    expect(guidance).toContain("typed MCP integrations");
  });
});
