import { describe, expect, it } from "vitest";

import { compareSemverLikeVersions, normalizeSemverLikeVersion } from "../../server/runtime/versioning.js";

describe("runtime versioning helpers", () => {
  it("normalizes semver-like strings", () => {
    expect(normalizeSemverLikeVersion("v1")).toBe("1.0.0");
    expect(normalizeSemverLikeVersion("1.2")).toBe("1.2.0");
    expect(normalizeSemverLikeVersion("1.2.3")).toBe("1.2.3");
    expect(normalizeSemverLikeVersion("1.2.3-beta.1")).toBe("1.2.3-beta.1");
    expect(normalizeSemverLikeVersion("not-a-version")).toBe("");
  });

  it("compares normalized semver-like strings", () => {
    expect(compareSemverLikeVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareSemverLikeVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareSemverLikeVersions("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
    expect(compareSemverLikeVersions("1.2.0", "1.2.0-beta.1")).toBeGreaterThan(0);
    expect(compareSemverLikeVersions("1.2.0", "oops")).toBeNull();
  });
});
