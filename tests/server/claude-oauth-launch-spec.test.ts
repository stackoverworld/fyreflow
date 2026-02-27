import { describe, expect, it } from "vitest";

import { resolveClaudeLoginLaunchSpecForPlatform } from "../../server/oauth/providers/claude.js";

describe("resolveClaudeLoginLaunchSpecForPlatform", () => {
  it("uses direct cli command when script is unavailable", () => {
    const spec = resolveClaudeLoginLaunchSpecForPlatform(false, "linux", "claude");

    expect(spec).toEqual({
      command: "claude",
      args: ["auth", "login"],
      usesPtyShim: false
    });
  });

  it("uses script flush mode on linux for reliable prompt capture", () => {
    const spec = resolveClaudeLoginLaunchSpecForPlatform(true, "linux", "claude");

    expect(spec.command).toBe("script");
    expect(spec.usesPtyShim).toBe(true);
    expect(spec.args).toContain("-f");
    expect(spec.args).toContain("-e");
    expect(spec.args).toContain("-c");
  });

  it("uses BSD script flush flag on darwin", () => {
    const spec = resolveClaudeLoginLaunchSpecForPlatform(true, "darwin", "claude");

    expect(spec.command).toBe("script");
    expect(spec.usesPtyShim).toBe(true);
    expect(spec.args).toContain("-F");
    expect(spec.args).toEqual(["-q", "-F", "/dev/null", "claude", "auth", "login"]);
  });
});
