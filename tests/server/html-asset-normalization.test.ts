import { describe, expect, it } from "vitest";
import { fixDuplicatedDataUriPrefixes, rewriteFrameBackgroundReferences } from "../../server/runner/execution.js";

describe("HTML asset normalization", () => {
  it("removes duplicated data URI prefixes for embedded backgrounds", () => {
    const html =
      "<section class=\"slide\" style=\"background-image:url('data:image/png;base64,data:image/png;base64,AAAA')\"></section>";

    const result = fixDuplicatedDataUriPrefixes(html);
    expect(result.replacements).toBe(1);
    expect(result.normalized).toContain("data:image/png;base64,AAAA");
    expect(result.normalized).not.toContain("data:image/png;base64,data:image/png;base64,");
  });

  it("keeps valid data URI untouched", () => {
    const html =
      "<section class=\"slide\" style=\"background-image:url('data:image/png;base64,AAAA')\"></section>";

    const result = fixDuplicatedDataUriPrefixes(html);
    expect(result.replacements).toBe(0);
    expect(result.normalized).toBe(html);
  });

  it("rewrites frame backgrounds to zero-based slide background assets when available", () => {
    const html =
      "<section class=\"slide\" style=\"background-image:url('assets/frame-1.png')\"></section>" +
      "<section class=\"slide\" style=\"background-image:url('assets/frame-2.png')\"></section>";
    const available = new Set(["assets/slide-0-bg.png", "assets/slide-1-bg.png"]);

    const result = rewriteFrameBackgroundReferences(html, available);
    expect(result.replacements).toBe(2);
    expect(result.normalized).toContain("assets/slide-0-bg.png");
    expect(result.normalized).toContain("assets/slide-1-bg.png");
    expect(result.normalized).not.toContain("assets/frame-1.png");
    expect(result.normalized).not.toContain("assets/frame-2.png");
  });

  it("falls back to one-based slide background assets when zero-based variant does not exist", () => {
    const html = "<section class=\"slide\" style=\"background-image:url('assets/frame-4.png')\"></section>";
    const available = new Set(["assets/slide-4-bg.webp"]);

    const result = rewriteFrameBackgroundReferences(html, available);
    expect(result.replacements).toBe(1);
    expect(result.normalized).toContain("assets/slide-4-bg.webp");
  });

  it("keeps frame background refs unchanged when no matching slide background exists", () => {
    const html = "<section class=\"slide\" style=\"background-image:url('assets/frame-9.png')\"></section>";

    const result = rewriteFrameBackgroundReferences(html, new Set());
    expect(result.replacements).toBe(0);
    expect(result.normalized).toBe(html);
  });
});
