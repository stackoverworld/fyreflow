import { describe, expect, it } from "vitest";

import { areRunInputKeysEquivalent, getRunInputValue } from "../../src/lib/runInputAliases.ts";

describe("runInputAliases", () => {
  it("treats source_token and source_personal_access_token as equivalent keys", () => {
    expect(areRunInputKeysEquivalent("source_token", "source_personal_access_token")).toBe(true);
    expect(areRunInputKeysEquivalent("source_personal_access_token", "source_token")).toBe(true);
  });

  it("resolves values across secret key aliases", () => {
    expect(
      getRunInputValue(
        {
          source_personal_access_token: "[secure]"
        },
        "source_token"
      )
    ).toBe("[secure]");

    expect(
      getRunInputValue(
        {
          source_token: "[secure]"
        },
        "source_personal_access_token"
      )
    ).toBe("[secure]");
  });
});
