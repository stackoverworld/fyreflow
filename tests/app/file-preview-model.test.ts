import { describe, expect, it } from "vitest";
import {
  chooseContentPreviewBytes,
  classifyFilePreviewByName,
  getRawPreviewLimitBytes,
  isRawPreviewTooLarge,
  resolveTextPreviewKind
} from "../../src/components/dashboard/file-preview/previewModel.ts";

describe("file preview model", () => {
  it("classifies common previewable extensions", () => {
    expect(classifyFilePreviewByName("index.html")).toMatchObject({ mode: "content", kind: "html" });
    expect(classifyFilePreviewByName("payload.json")).toMatchObject({ mode: "content", kind: "json" });
    expect(classifyFilePreviewByName("README.md")).toMatchObject({ mode: "content", kind: "markdown" });
    expect(classifyFilePreviewByName("script.ts")).toMatchObject({ mode: "content", kind: "text" });
    expect(classifyFilePreviewByName("image.webp")).toMatchObject({ mode: "raw", kind: "image" });
    expect(classifyFilePreviewByName("report.pdf")).toMatchObject({ mode: "raw", kind: "pdf" });
    expect(classifyFilePreviewByName("clip.mp4")).toMatchObject({ mode: "raw", kind: "video" });
    expect(classifyFilePreviewByName("sound.flac")).toMatchObject({ mode: "raw", kind: "audio" });
  });

  it("treats unknown or extensionless files as text-first preview", () => {
    expect(classifyFilePreviewByName("Dockerfile")).toMatchObject({ mode: "content", kind: "text" });
    expect(classifyFilePreviewByName("custom.unknown")).toMatchObject({ mode: "content", kind: "text" });
  });

  it("marks archive formats as unsupported preview", () => {
    expect(classifyFilePreviewByName("bundle.zip")).toMatchObject({ mode: "unsupported", kind: "binary" });
    expect(classifyFilePreviewByName("backup.tar")).toMatchObject({ mode: "unsupported", kind: "binary" });
  });

  it("normalizes text preview kind based on backend and mime", () => {
    expect(resolveTextPreviewKind("text/plain", "html")).toBe("html");
    expect(resolveTextPreviewKind("application/json", "text")).toBe("json");
    expect(resolveTextPreviewKind("text/markdown", "text")).toBe("markdown");
    expect(resolveTextPreviewKind("text/plain", "text")).toBe("text");
  });

  it("chooses bounded bytes for content previews", () => {
    expect(chooseContentPreviewBytes(null)).toBe(256 * 1024);
    expect(chooseContentPreviewBytes(8 * 1024)).toBe(32 * 1024);
    expect(chooseContentPreviewBytes(200 * 1024)).toBe(200 * 1024);
    expect(chooseContentPreviewBytes(700 * 1024)).toBe(512 * 1024);
    expect(chooseContentPreviewBytes(5 * 1024 * 1024)).toBe(1024 * 1024);
  });

  it("blocks raw preview when file is larger than per-type limit", () => {
    expect(isRawPreviewTooLarge("image", getRawPreviewLimitBytes("image"))).toBe(false);
    expect(isRawPreviewTooLarge("image", getRawPreviewLimitBytes("image") + 1)).toBe(true);
    expect(isRawPreviewTooLarge("pdf", getRawPreviewLimitBytes("pdf") + 1)).toBe(true);
    expect(isRawPreviewTooLarge("video", getRawPreviewLimitBytes("video") + 1)).toBe(true);
    expect(isRawPreviewTooLarge("audio", getRawPreviewLimitBytes("audio") + 1)).toBe(true);
  });
});
