import { describe, expect, it } from "vitest";

import { parseBooleanEnv, resolveUpdaterRuntimeConfig } from "../../server/updater/config.js";

describe("updater config", () => {
  it("uses defaults", () => {
    const config = resolveUpdaterRuntimeConfig({});

    expect(config.port).toBe(8788);
    expect(config.channel).toBe("stable");
    expect(config.coreServiceName).toBe("core");
    expect(config.coreHealthUrl).toBe("http://core:8787/api/health");
    expect(config.autoCheckIntervalMs).toBe(300_000);
  });

  it("parses overrides", () => {
    const config = resolveUpdaterRuntimeConfig({
      UPDATER_PORT: "9876",
      UPDATER_CHANNEL: "prerelease",
      UPDATER_GITHUB_OWNER: "acme",
      UPDATER_GITHUB_REPO: "fyreflow",
      UPDATER_IMAGE_REPOSITORY: "ghcr.io/acme/fyreflow-core",
      UPDATER_CORS_ORIGINS: "https://app.example.com,*",
      UPDATER_AUTO_CHECK_INTERVAL_MS: "90000"
    });

    expect(config.port).toBe(9876);
    expect(config.channel).toBe("prerelease");
    expect(config.githubOwner).toBe("acme");
    expect(config.githubRepo).toBe("fyreflow");
    expect(config.imageRepository).toBe("ghcr.io/acme/fyreflow-core");
    expect(config.corsOrigins).toEqual(["https://app.example.com", "*"]);
    expect(config.allowAnyCorsOrigin).toBe(true);
    expect(config.autoCheckIntervalMs).toBe(90_000);
  });

  it("normalizes boolean parsing helper", () => {
    expect(parseBooleanEnv("true", false)).toBe(true);
    expect(parseBooleanEnv("NO", true)).toBe(false);
    expect(parseBooleanEnv(undefined, true)).toBe(true);
    expect(parseBooleanEnv("unknown", false)).toBe(false);
  });
});
