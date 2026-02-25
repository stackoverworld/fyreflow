import { describe, expect, it } from "vitest";

import { extractDeviceCode, extractFirstAuthUrl } from "../../server/oauth/loginOutputParser.js";

describe("OAuth Login Output Parser", () => {
  it("extracts first auth url from mixed cli output", () => {
    const raw = [
      "\u001b[32mAuthenticate your account at:\u001b[0m",
      "https://claude.ai/device?pairing=abc123).",
      "Waiting for confirmation..."
    ].join("\n");

    expect(extractFirstAuthUrl(raw)).toBe("https://claude.ai/device?pairing=abc123");
  });

  it("returns undefined when no auth url is present", () => {
    expect(extractFirstAuthUrl("No url here.")).toBeUndefined();
  });

  it("extracts device code from same hint line", () => {
    const raw = "Enter this code: OPEN-AI-1234";

    expect(extractDeviceCode(raw)).toBe("OPEN-AI-1234");
  });

  it("extracts device code from the line after a hint", () => {
    const raw = ["One-time code", "CLAUDE-PAIR-777"].join("\n");

    expect(extractDeviceCode(raw)).toBe("CLAUDE-PAIR-777");
  });

  it("returns undefined when no code-like token exists", () => {
    expect(extractDeviceCode("Complete login in browser only.")).toBeUndefined();
  });
});
