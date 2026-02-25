import { describe, expect, it } from "vitest";

import { createApiAuthMiddleware, createSecurityHeadersMiddleware } from "../../server/http/middleware.js";
import { registerSystemRoutes } from "../../server/http/routes/system.js";
import { MASK_VALUE } from "../../server/secureInputs.js";
import type { DashboardState, McpServerConfig, ProviderConfig, ProviderId } from "../../server/types.js";
import { createRouteHarness, createMockResponse, invokeRoute } from "../helpers/routeHarness.js";
import { createTempStore } from "../helpers/tempStore.js";

function maskIfPresent(value: string): string {
  return value.trim().length > 0 ? MASK_VALUE : "";
}

function sanitizeProviderConfig(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: maskIfPresent(provider.apiKey),
    oauthToken: maskIfPresent(provider.oauthToken)
  };
}

function sanitizeProviderMap(
  providers: DashboardState["providers"]
): Record<ProviderId, ProviderConfig> {
  return {
    openai: sanitizeProviderConfig(providers.openai),
    claude: sanitizeProviderConfig(providers.claude)
  };
}

function sanitizeMcpServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    env: maskIfPresent(server.env),
    headers: maskIfPresent(server.headers)
  };
}

function sanitizeDashboardState(state: DashboardState): DashboardState {
  return {
    ...state,
    providers: sanitizeProviderMap(state.providers),
    mcpServers: state.mcpServers.map((server) => sanitizeMcpServer(server))
  };
}

describe("System and Auth Routes", () => {
  it("returns health payload with realtime capabilities when provided", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    try {
      registerSystemRoutes(app as never, {
        getState: () => store.getState(),
        sanitizeDashboardState,
        getVersion: () => "1.2.3",
        getRealtimeStatus: () => ({
          enabled: true,
          path: "/api/ws"
        })
      });

      const healthHandler = route("GET", "/api/health");
      const response = await invokeRoute(healthHandler, {
        path: "/api/health",
        method: "GET"
      });
      const payload = response.body as { ok: boolean; version?: string; realtime?: { enabled: boolean; path: string } };
      expect(response.statusCode).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.version).toBe("1.2.3");
      expect(payload.realtime).toEqual({
        enabled: true,
        path: "/api/ws"
      });
    } finally {
      await cleanup();
    }
  });

  it("keeps /api/health public and protects private API endpoints with token auth", async () => {
    const middleware = createApiAuthMiddleware("super-secret-token", {
      isAdditionalTokenValid: (token) => token === "device-token"
    });

    const healthResponse = createMockResponse();
    let healthNextCalled = false;
    middleware(
      {
        path: "/api/health",
        method: "GET",
        headers: {}
      } as never,
      healthResponse as never,
      () => {
        healthNextCalled = true;
      }
    );
    expect(healthNextCalled).toBe(true);

    const pairingResponse = createMockResponse();
    let pairingNextCalled = false;
    middleware(
      {
        path: "/api/pairing/sessions",
        method: "POST",
        headers: {}
      } as never,
      pairingResponse as never,
      () => {
        pairingNextCalled = true;
      }
    );
    expect(pairingNextCalled).toBe(true);

    const unauthorizedResponse = createMockResponse();
    let unauthorizedNextCalled = false;
    middleware(
      {
        path: "/api/state",
        method: "GET",
        headers: {}
      } as never,
      unauthorizedResponse as never,
      () => {
        unauthorizedNextCalled = true;
      }
    );
    expect(unauthorizedNextCalled).toBe(false);
    expect(unauthorizedResponse.statusCode).toBe(401);
    expect(unauthorizedResponse.body).toEqual({ error: "Unauthorized" });

    const bearerResponse = createMockResponse();
    let bearerNextCalled = false;
    middleware(
      {
        path: "/api/state",
        method: "GET",
        headers: {
          authorization: "Bearer super-secret-token"
        }
      } as never,
      bearerResponse as never,
      () => {
        bearerNextCalled = true;
      }
    );
    expect(bearerNextCalled).toBe(true);

    const headerResponse = createMockResponse();
    let headerNextCalled = false;
    middleware(
      {
        path: "/api/state",
        method: "GET",
        headers: {
          "x-api-token": "super-secret-token"
        }
      } as never,
      headerResponse as never,
      () => {
        headerNextCalled = true;
      }
    );
    expect(headerNextCalled).toBe(true);

    const pairingDeviceTokenResponse = createMockResponse();
    let pairingDeviceTokenNextCalled = false;
    middleware(
      {
        path: "/api/state",
        method: "GET",
        headers: {
          "x-api-token": "device-token"
        }
      } as never,
      pairingDeviceTokenResponse as never,
      () => {
        pairingDeviceTokenNextCalled = true;
      }
    );
    expect(pairingDeviceTokenNextCalled).toBe(true);

    const rawQueryResponse = createMockResponse();
    let rawQueryNextCalled = false;
    middleware(
      {
        path: "/api/files/raw/shared/pipeline-id/-/assets/logo.png",
        method: "GET",
        query: {
          api_token: "super-secret-token"
        },
        headers: {}
      } as never,
      rawQueryResponse as never,
      () => {
        rawQueryNextCalled = true;
      }
    );
    expect(rawQueryNextCalled).toBe(true);

    const stateQueryResponse = createMockResponse();
    let stateQueryNextCalled = false;
    middleware(
      {
        path: "/api/state",
        method: "GET",
        query: {
          api_token: "super-secret-token"
        },
        headers: {}
      } as never,
      stateQueryResponse as never,
      () => {
        stateQueryNextCalled = true;
      }
    );
    expect(stateQueryNextCalled).toBe(false);
    expect(stateQueryResponse.statusCode).toBe(401);
  });

  it("returns sanitized provider and MCP secrets from /api/state", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    try {
      store.upsertProvider("openai", {
        authMode: "oauth",
        apiKey: "sk-test-openai",
        oauthToken: "oauth-openai"
      });
      store.upsertProvider("claude", {
        authMode: "api_key",
        apiKey: "sk-test-claude"
      });
      store.createMcpServer({
        name: "Primary MCP",
        transport: "http",
        url: "http://localhost:4318",
        env: "API_TOKEN=secret",
        headers: "Authorization: Bearer token"
      });

      registerSystemRoutes(app as never, {
        getState: () => store.getState(),
        sanitizeDashboardState
      });
      const stateHandler = route("GET", "/api/state");
      const response = await invokeRoute(stateHandler, {
        path: "/api/state",
        method: "GET"
      });

      const headersMiddleware = createSecurityHeadersMiddleware();
      const headerResponse = createMockResponse();
      let nextCalled = false;
      headersMiddleware(
        {
          path: "/api/health"
        } as never,
        headerResponse as never,
        () => {
          nextCalled = true;
        }
      );

      const state = response.body as DashboardState;
      expect(response.statusCode).toBe(200);
      expect(state.providers.openai.apiKey).toBe(MASK_VALUE);
      expect(state.providers.openai.oauthToken).toBe(MASK_VALUE);
      expect(state.providers.claude.apiKey).toBe(MASK_VALUE);
      expect(state.mcpServers[0]?.env).toBe(MASK_VALUE);
      expect(state.mcpServers[0]?.headers).toBe(MASK_VALUE);
      expect(nextCalled).toBe(true);
      expect(headerResponse.getHeader("x-content-type-options")).toBe("nosniff");
      expect(headerResponse.getHeader("x-frame-options")).toBe("DENY");
      expect(headerResponse.getHeader("referrer-policy")).toBe("no-referrer");
    } finally {
      await cleanup();
    }
  });
});
