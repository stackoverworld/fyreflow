import { describe, expect, it } from "vitest";
import { DROPDOWN_MENU_CONTENT_CLASS, SELECT_DROPDOWN_CONTENT_CLASS } from "../../src/components/optics/overlay-classes.ts";

describe("overlay surface blur", () => {
  it("keeps dropdown menu surfaces frosted", () => {
    expect(DROPDOWN_MENU_CONTENT_CLASS).toContain("bg-ink-900/55");
    expect(DROPDOWN_MENU_CONTENT_CLASS).toContain("backdrop-blur-xl");
    expect(DROPDOWN_MENU_CONTENT_CLASS).toContain("backdrop-saturate-150");
  });

  it("keeps select dropdown surfaces frosted", () => {
    expect(SELECT_DROPDOWN_CONTENT_CLASS).toContain("bg-ink-900/55");
    expect(SELECT_DROPDOWN_CONTENT_CLASS).toContain("backdrop-blur-xl");
    expect(SELECT_DROPDOWN_CONTENT_CLASS).toContain("backdrop-saturate-150");
  });
});
