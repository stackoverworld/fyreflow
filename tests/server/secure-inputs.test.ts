import { describe, expect, it } from "vitest";

import {
  MASK_VALUE,
  isSensitiveInputKey,
  maskSensitiveInputs,
  mergeRunInputsWithSecure,
  pickSensitiveInputs
} from "../../server/secureInputs.js";

describe("Secure Input Utilities", () => {
  it("detects sensitive input keys", () => {
    expect(isSensitiveInputKey("api_key")).toBe(true);
    expect(isSensitiveInputKey("sessionToken")).toBe(true);
    expect(isSensitiveInputKey("password")).toBe(true);
    expect(isSensitiveInputKey("notes")).toBe(false);
  });

  it("picks only sensitive non-empty inputs", () => {
    const picked = pickSensitiveInputs({
      api_key: "sk-test",
      release_branch: "main",
      password: "s3cr3t",
      empty_token: "  ",
      already_masked: MASK_VALUE
    });

    expect(picked).toEqual({
      api_key: "sk-test",
      password: "s3cr3t"
    });
  });

  it("masks sensitive keys and explicitly forced keys", () => {
    const masked = maskSensitiveInputs(
      {
        api_key: "sk-test",
        branch: "main",
        release_notes: "ship it"
      },
      ["release_notes"]
    );

    expect(masked).toEqual({
      api_key: MASK_VALUE,
      branch: "main",
      release_notes: MASK_VALUE
    });
  });

  it("merges secure inputs and ignores masked placeholders from raw input", () => {
    const merged = mergeRunInputsWithSecure(
      {
        api_key: MASK_VALUE,
        branch: "release/v1",
        extra: "value"
      },
      {
        api_key: "real-secret",
        token: "oauth-secret"
      }
    );

    expect(merged).toEqual({
      api_key: "real-secret",
      token: "oauth-secret",
      branch: "release/v1",
      extra: "value"
    });
  });
});
