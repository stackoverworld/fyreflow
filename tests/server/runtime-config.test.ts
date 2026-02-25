import { describe, expect, it } from "vitest";

import {
  parseBooleanEnv,
  resolveCorsOrigins,
  resolvePort,
  resolveRuntimeConfig,
  resolveRuntimeMode
} from "../../server/runtime/config.js";

describe("runtime config", () => {
  it("uses safe defaults when env is empty", () => {
    const config = resolveRuntimeConfig({});

    expect(config.mode).toBe("local");
    expect(config.port).toBe(8787);
    expect(config.enableScheduler).toBe(true);
    expect(config.enableRecovery).toBe(true);
    expect(config.enableRealtimeSocket).toBe(true);
    expect(config.realtimeSocketPath).toBe("/api/ws");
    expect(config.realtimeRunPollIntervalMs).toBe(400);
    expect(config.realtimeHeartbeatIntervalMs).toBe(15_000);
    expect(config.updaterBaseUrl).toBe("");
    expect(config.updaterAuthToken).toBe("");
    expect(config.updaterProxyTimeoutMs).toBe(15_000);
    expect(config.allowedCorsOrigins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "null"
    ]);
    expect(config.allowAnyCorsOrigin).toBe(false);
  });

  it("parses runtime env overrides", () => {
    const config = resolveRuntimeConfig({
      FYREFLOW_RUNTIME_MODE: "remote",
      PORT: "9999",
      DASHBOARD_API_TOKEN: "token-1",
      CORS_ORIGINS: "https://app.example.com,*",
      FYREFLOW_ENABLE_SCHEDULER: "0",
      FYREFLOW_ENABLE_RECOVERY: "false",
      FYREFLOW_ENABLE_REALTIME_WS: "no",
      FYREFLOW_WS_PATH: "/ws/remote",
      FYREFLOW_WS_RUN_POLL_INTERVAL_MS: "250",
      FYREFLOW_WS_HEARTBEAT_INTERVAL_MS: "12000",
      FYREFLOW_UPDATER_BASE_URL: "https://updates.example.com/",
      FYREFLOW_UPDATER_AUTH_TOKEN: "updater-token",
      FYREFLOW_UPDATER_TIMEOUT_MS: "18000"
    });

    expect(config.mode).toBe("remote");
    expect(config.port).toBe(9999);
    expect(config.apiAuthToken).toBe("token-1");
    expect(config.allowedCorsOrigins).toEqual(["https://app.example.com", "*"]);
    expect(config.allowAnyCorsOrigin).toBe(true);
    expect(config.enableScheduler).toBe(false);
    expect(config.enableRecovery).toBe(false);
    expect(config.enableRealtimeSocket).toBe(false);
    expect(config.realtimeSocketPath).toBe("/ws/remote");
    expect(config.realtimeRunPollIntervalMs).toBe(250);
    expect(config.realtimeHeartbeatIntervalMs).toBe(12_000);
    expect(config.updaterBaseUrl).toBe("https://updates.example.com");
    expect(config.updaterAuthToken).toBe("updater-token");
    expect(config.updaterProxyTimeoutMs).toBe(18_000);
  });

  it("normalizes helper parsers", () => {
    expect(resolveRuntimeMode("REMOTE")).toBe("remote");
    expect(resolveRuntimeMode("invalid")).toBe("local");
    expect(resolvePort("abc")).toBe(8787);
    expect(resolvePort("65536")).toBe(8787);
    expect(resolvePort("4321")).toBe(4321);
    expect(parseBooleanEnv("YES", false)).toBe(true);
    expect(parseBooleanEnv("no", true)).toBe(false);
    expect(parseBooleanEnv("oops", true)).toBe(true);
    expect(parseBooleanEnv(undefined, false)).toBe(false);
    expect(resolveRuntimeConfig({ FYREFLOW_WS_PATH: "ws-no-leading-slash" }).realtimeSocketPath).toBe("/api/ws");
    expect(resolveRuntimeConfig({ FYREFLOW_WS_RUN_POLL_INTERVAL_MS: "20" }).realtimeRunPollIntervalMs).toBe(100);
    expect(resolveRuntimeConfig({ FYREFLOW_WS_HEARTBEAT_INTERVAL_MS: "999999" }).realtimeHeartbeatIntervalMs).toBe(120_000);
    expect(resolveRuntimeConfig({ FYREFLOW_UPDATER_BASE_URL: "not-a-url" }).updaterBaseUrl).toBe("");
    expect(resolveRuntimeConfig({ UPDATER_AUTH_TOKEN: "fallback-token" }).updaterAuthToken).toBe("fallback-token");
    expect(resolveRuntimeConfig({ FYREFLOW_UPDATER_TIMEOUT_MS: "1500" }).updaterProxyTimeoutMs).toBe(2_000);
    expect(resolveCorsOrigins("https://a.example.com, https://b.example.com").allowedCorsOrigins).toEqual([
      "https://a.example.com",
      "https://b.example.com"
    ]);
  });

  it("requires DASHBOARD_API_TOKEN in remote mode", () => {
    expect(() =>
      resolveRuntimeConfig({
        FYREFLOW_RUNTIME_MODE: "remote"
      })
    ).toThrow("DASHBOARD_API_TOKEN is required when FYREFLOW_RUNTIME_MODE=remote.");
  });
});
