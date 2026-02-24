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
      FYREFLOW_ENABLE_RECOVERY: "false"
    });

    expect(config.mode).toBe("remote");
    expect(config.port).toBe(9999);
    expect(config.apiAuthToken).toBe("token-1");
    expect(config.allowedCorsOrigins).toEqual(["https://app.example.com", "*"]);
    expect(config.allowAnyCorsOrigin).toBe(true);
    expect(config.enableScheduler).toBe(false);
    expect(config.enableRecovery).toBe(false);
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
    expect(resolveCorsOrigins("https://a.example.com, https://b.example.com").allowedCorsOrigins).toEqual([
      "https://a.example.com",
      "https://b.example.com"
    ]);
  });
});
