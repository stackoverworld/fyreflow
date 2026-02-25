import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getState: vi.fn(),
  getSmartRunPlan: vi.fn()
}));

vi.mock("../../src/lib/api.ts", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/api.ts")>("../../src/lib/api.ts");
  return {
    ...actual,
    getHealth: apiMocks.getHealth,
    getState: apiMocks.getState,
    getSmartRunPlan: apiMocks.getSmartRunPlan
  };
});

import { loadInitialState } from "../../src/app/state/controller/effects.ts";

function createLoadArgs() {
  return {
    setPipelines: vi.fn(),
    setProviders: vi.fn(),
    setMcpServers: vi.fn(),
    setStorageConfig: vi.fn(),
    setRuns: vi.fn(),
    setSelectedPipelineId: vi.fn(),
    setDraftWorkflowKey: vi.fn(),
    resetDraftHistory: vi.fn(),
    setBaselineDraft: vi.fn(),
    setIsNewDraft: vi.fn(),
    setNotice: vi.fn(),
    isCancelled: () => false
  };
}

describe("loadInitialState compatibility checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks bootstrap when backend requires a newer desktop app", async () => {
    apiMocks.getHealth.mockResolvedValue({
      ok: true,
      now: "2026-02-25T12:00:00.000Z",
      client: {
        minimumDesktopVersion: "1.5.0",
        clientVersion: "1.4.0",
        updateRequired: true,
        message: "Backend requires desktop version 1.5.0 or newer.",
        downloadUrl: "https://downloads.example.com/fyreflow"
      }
    });
    apiMocks.getState.mockResolvedValue({});

    const args = createLoadArgs();
    await loadInitialState(args);

    expect(apiMocks.getHealth).toHaveBeenCalledTimes(1);
    expect(apiMocks.getState).not.toHaveBeenCalled();
    expect(args.setNotice).toHaveBeenCalledWith(
      "Backend requires desktop version 1.5.0 or newer. Download latest desktop app: https://downloads.example.com/fyreflow"
    );
  });

  it("continues bootstrap when client version is compatible", async () => {
    apiMocks.getHealth.mockResolvedValue({
      ok: true,
      now: "2026-02-25T12:00:00.000Z",
      client: {
        minimumDesktopVersion: "1.5.0",
        clientVersion: "1.5.1",
        updateRequired: false,
        message: "Client is compatible."
      }
    });
    apiMocks.getState.mockResolvedValue({
      pipelines: [],
      providers: {
        openai: {
          id: "openai",
          label: "OpenAI",
          authMode: "api_key",
          apiKey: "",
          oauthToken: "",
          baseUrl: "",
          defaultModel: "",
          updatedAt: "2026-02-25T12:00:00.000Z"
        },
        claude: {
          id: "claude",
          label: "Claude",
          authMode: "api_key",
          apiKey: "",
          oauthToken: "",
          baseUrl: "",
          defaultModel: "",
          updatedAt: "2026-02-25T12:00:00.000Z"
        }
      },
      mcpServers: [],
      storage: {
        enabled: false,
        rootPath: "",
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs",
        updatedAt: "2026-02-25T12:00:00.000Z"
      },
      runs: []
    });

    const args = createLoadArgs();
    await loadInitialState(args);

    expect(apiMocks.getHealth).toHaveBeenCalledTimes(1);
    expect(apiMocks.getState).toHaveBeenCalledTimes(1);
    expect(args.setNotice).toHaveBeenLastCalledWith("");
  });
});
