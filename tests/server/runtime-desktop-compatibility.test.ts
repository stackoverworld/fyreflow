import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDesktopCompatibilityPolicy } from "../../server/runtime/desktopCompatibility.js";

const tempPaths: string[] = [];

function createTempFile(content: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fyreflow-desktop-policy-"));
  const pathname = path.join(root, "desktop-compatibility.json");
  fs.writeFileSync(pathname, content, "utf8");
  tempPaths.push(root);
  return pathname;
}

afterEach(() => {
  for (const root of tempPaths.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("desktop compatibility policy loader", () => {
  it("returns fallback when file is missing", () => {
    const policy = loadDesktopCompatibilityPolicy("/tmp/non-existent-desktop-policy.json");
    expect(policy).toEqual({
      minimumDesktopVersion: "",
      downloadUrl: ""
    });
  });

  it("loads and normalizes policy values", () => {
    const pathname = createTempFile(
      JSON.stringify({
        minimumDesktopVersion: "v1.5",
        downloadUrl: "https://downloads.example.com/fyreflow/"
      })
    );

    const policy = loadDesktopCompatibilityPolicy(pathname);
    expect(policy).toEqual({
      minimumDesktopVersion: "1.5.0",
      downloadUrl: "https://downloads.example.com/fyreflow"
    });
  });

  it("returns fallback on malformed json", () => {
    const pathname = createTempFile("{invalid-json");
    const policy = loadDesktopCompatibilityPolicy(pathname);
    expect(policy).toEqual({
      minimumDesktopVersion: "",
      downloadUrl: ""
    });
  });
});
