import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionSettingsMocks = vi.hoisted(() => ({
  getActiveConnectionSettings: vi.fn()
}));

vi.mock("../../src/lib/connectionSettingsStorage.ts", () => ({
  getActiveConnectionSettings: connectionSettingsMocks.getActiveConnectionSettings
}));

import { mapInitialStateLoadErrorMessage } from "../../src/app/state/controller/effects.ts";

describe("loadInitialState error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bootstrap guidance for unauthorized remote mode without token", () => {
    connectionSettingsMocks.getActiveConnectionSettings.mockReturnValue({
      mode: "remote",
      apiBaseUrl: "https://fyreflow.example.com",
      apiToken: "",
      realtimePath: "/api/ws",
      deviceToken: ""
    });

    const message = mapInitialStateLoadErrorMessage(new Error("Unauthorized"));
    expect(message).toContain("Remote backend requires authorization");
    expect(message).toContain("Connection auth token");
  });

  it("returns token guidance for unauthorized remote mode with token", () => {
    connectionSettingsMocks.getActiveConnectionSettings.mockReturnValue({
      mode: "remote",
      apiBaseUrl: "https://fyreflow.example.com",
      apiToken: "wrong-token",
      realtimePath: "/api/ws",
      deviceToken: ""
    });

    const message = mapInitialStateLoadErrorMessage(new Error("Unauthorized"));
    expect(message).toContain("rejected current Connection auth token");
  });

  it("passes through non-authorization errors", () => {
    connectionSettingsMocks.getActiveConnectionSettings.mockReturnValue({
      mode: "remote",
      apiBaseUrl: "https://fyreflow.example.com",
      apiToken: "",
      realtimePath: "/api/ws",
      deviceToken: ""
    });

    const message = mapInitialStateLoadErrorMessage(new Error("Network error (GET /api/state): Failed to fetch"));
    expect(message).toBe("Network error (GET /api/state): Failed to fetch");
  });
});
