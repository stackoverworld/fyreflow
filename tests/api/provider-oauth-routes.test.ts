import { describe, expect, it, vi } from "vitest";

import { registerProviderRoutes } from "../../server/http/routes/pipelines/registerProviderRoutes.js";
import type { ProviderOAuthStatus } from "../../server/oauth.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";
import { createTempStore } from "../helpers/tempStore.js";

function buildStatus(providerId: "openai" | "claude"): ProviderOAuthStatus {
  return {
    providerId,
    loginSource: providerId === "openai" ? "codex-cli" : "claude-cli",
    cliCommand: providerId === "openai" ? "codex" : "claude",
    cliAvailable: true,
    loggedIn: false,
    tokenAvailable: false,
    canUseApi: false,
    canUseCli: false,
    checkedAt: "2026-02-26T03:00:00.000Z",
    message: "Not logged in."
  };
}

describe("Provider OAuth Routes", () => {
  it("submits browser authorization code to backend OAuth session", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    const submitProviderOAuthCode = vi.fn(async () => ({
      providerId: "claude" as const,
      accepted: true,
      message: "Authorization code submitted."
    }));
    const getProviderOAuthStatus = vi.fn(async () => buildStatus("claude"));

    try {
      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus,
        submitProviderOAuthCode,
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("POST", "/api/providers/:providerId/oauth/submit-code");
      const response = await invokeRoute(handler, {
        method: "POST",
        params: { providerId: "claude" },
        body: { code: "abc-123" }
      });

      expect(response.statusCode).toBe(202);
      expect(response.body).toEqual({
        result: {
          providerId: "claude",
          accepted: true,
          message: "Authorization code submitted."
        },
        status: buildStatus("claude")
      });
      expect(submitProviderOAuthCode).toHaveBeenCalledWith("claude", "abc-123");
      expect(getProviderOAuthStatus).toHaveBeenCalledWith("claude");
    } finally {
      await cleanup();
    }
  });

  it("rejects empty authorization code payload", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const submitProviderOAuthCode = vi.fn();

    try {
      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => buildStatus("claude")),
        submitProviderOAuthCode,
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("POST", "/api/providers/:providerId/oauth/submit-code");
      const response = await invokeRoute(handler, {
        method: "POST",
        params: { providerId: "claude" },
        body: { code: "" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          error: "Validation failed"
        })
      );
      expect(submitProviderOAuthCode).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("marks Claude OAuth as API-ready when setup-token is stored in dashboard", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      store.upsertProvider("claude", {
        authMode: "oauth",
        oauthToken: "sk-ant-oat01-example-token"
      });

      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => ({
          ...buildStatus("claude"),
          runtimeProbe: {
            status: "fail",
            message: "Claude CLI is not logged in.",
            checkedAt: "2026-02-26T03:00:01.000Z"
          }
        })),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("GET", "/api/providers/:providerId/oauth/status");
      const response = await invokeRoute(handler, {
        method: "GET",
        params: { providerId: "claude" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toEqual(
        expect.objectContaining({
          providerId: "claude",
          tokenAvailable: true,
          canUseApi: true,
          message: "Setup token is stored in dashboard. Claude API auth is ready without CLI login."
        })
      );
      expect(response.body.status.runtimeProbe).toEqual(
        expect.objectContaining({
          status: "pass",
          message: "Setup token is stored in dashboard. API runtime path is available."
        })
      );
    } finally {
      await cleanup();
    }
  });
});
