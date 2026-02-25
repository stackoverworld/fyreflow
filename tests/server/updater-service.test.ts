import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { UpdaterRuntimeConfig } from "../../server/updater/config.js";
import { UpdaterService } from "../../server/updater/service.js";

vi.mock("../../server/updater/dockerCompose.js", () => ({
  pullAndRestartCoreService: vi.fn(async () => undefined)
}));

const originalFetch = global.fetch;

function createTempFiles() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fyreflow-updater-test-"));
  const composeFilePath = path.join(root, "docker-compose.yml");
  const envFilePath = path.join(root, ".env.selfhost");
  const statePath = path.join(root, "updater-state.json");

  fs.writeFileSync(composeFilePath, "services:\n  core:\n    image: test\n", "utf8");
  fs.writeFileSync(envFilePath, "FYREFLOW_VERSION=1.0.0\n", "utf8");

  return {
    root,
    composeFilePath,
    envFilePath,
    statePath
  };
}

function createConfig(paths: ReturnType<typeof createTempFiles>): UpdaterRuntimeConfig {
  return {
    port: 8788,
    authToken: "secret",
    corsOrigins: ["*"],
    allowAnyCorsOrigin: true,
    dockerBinary: "docker",
    composeFilePath: paths.composeFilePath,
    composeEnvFilePath: paths.envFilePath,
    coreServiceName: "core",
    coreHealthUrl: "http://core:8787/api/health",
    githubOwner: "owner",
    githubRepo: "repo",
    githubToken: "",
    imageRepository: "ghcr.io/owner/fyreflow-core",
    channel: "stable",
    statePath: paths.statePath,
    healthTimeoutMs: 5000,
    releaseTimeoutMs: 5000,
    autoCheckIntervalMs: 60_000
  };
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("UpdaterService", () => {
  it("checks and applies latest release tag", async () => {
    const paths = createTempFiles();

    global.fetch = vi.fn().mockImplementation(async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/releases/latest")) {
        return new Response(
          JSON.stringify({
            tag_name: "v1.1.0",
            published_at: "2026-02-24T10:00:00.000Z"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          version: "1.1.0",
          now: "2026-02-24T10:05:00.000Z"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }) as typeof fetch;

    const service = new UpdaterService(createConfig(paths));
    const checked = await service.checkForUpdates();
    expect(checked.latestTag).toBe("1.1.0");
    expect(checked.updateAvailable).toBe(true);

    const applied = await service.applyUpdate();
    expect(applied.currentTag).toBe("1.1.0");
    expect(applied.updateAvailable).toBe(false);

    const envRaw = fs.readFileSync(paths.envFilePath, "utf8");
    expect(envRaw).toContain("FYREFLOW_VERSION=1.1.0");
  });

  it("fails rollback when no previous tag is available", async () => {
    const paths = createTempFiles();

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          version: "1.0.0"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    ) as typeof fetch;

    const service = new UpdaterService(createConfig(paths));
    await expect(service.rollbackUpdate()).rejects.toThrow("Rollback is unavailable");
  });
});
