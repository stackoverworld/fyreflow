import type {
  DashboardState,
  Pipeline,
  ProviderId,
  SmartRunCheck,
  SmartRunCheckStatus
} from "../types.js";
import { getProviderOAuthStatus } from "../oauth.js";

function makeCheck(
  id: string,
  title: string,
  status: SmartRunCheckStatus,
  message: string,
  details?: string
): SmartRunCheck {
  return { id, title, status, message, details };
}

export async function collectRuntimeChecks(pipeline: Pipeline, state: DashboardState): Promise<SmartRunCheck[]> {
  const checks: SmartRunCheck[] = [];

  const providerIds = [...new Set(pipeline.steps.map((step) => step.providerId))] as ProviderId[];
  for (const providerId of providerIds) {
    const provider = state.providers[providerId];
    if (!provider) {
      checks.push(
        makeCheck(
          `provider:${providerId}`,
          `Provider ${providerId}`,
          "fail",
          "Provider config is missing."
        )
      );
      continue;
    }

    let available = false;
    let message = `No credentials configured (${provider.authMode}).`;
    let details = "Open Provider Auth and configure credentials.";

    if (provider.authMode === "oauth") {
      const hasStoredOAuthToken = provider.oauthToken.trim().length > 0;
      if (hasStoredOAuthToken) {
        available = true;
        message = "Authentication configured.";
        details = provider.defaultModel;
      } else {
        try {
          const oauthStatus = await getProviderOAuthStatus(providerId);
          if (oauthStatus.canUseCli || oauthStatus.canUseApi) {
            available = true;
            message = "Authentication configured via provider CLI.";
            details = oauthStatus.message;
          } else {
            details = oauthStatus.message || details;
          }
        } catch {
          // Fallback: keep the default fail message/details.
        }
      }
    } else {
      const hasApiKey = provider.apiKey.trim().length > 0;
      available = hasApiKey;
      if (available) {
        message = "Authentication configured.";
        details = provider.defaultModel;
      }
    }

    checks.push(
      makeCheck(
        `provider:${providerId}`,
        `Provider ${provider.label}`,
        available ? "pass" : "fail",
        message,
        details
      )
    );
  }

  const enabledMcpServerIds = new Set<string>();
  for (const step of pipeline.steps) {
    for (const serverId of step.enabledMcpServerIds) {
      enabledMcpServerIds.add(serverId);
    }
  }

  for (const serverId of enabledMcpServerIds) {
    const server = state.mcpServers.find((entry) => entry.id === serverId);
    if (!server) {
      checks.push(
        makeCheck(`mcp:${serverId}`, `MCP ${serverId}`, "fail", "Server is referenced by a step but not configured.")
      );
      continue;
    }

    if (!server.enabled) {
      checks.push(
        makeCheck(`mcp:${server.id}`, `MCP ${server.name}`, "fail", "Server is configured but disabled.")
      );
      continue;
    }

    if (server.transport === "stdio" && server.command.trim().length === 0) {
      checks.push(
        makeCheck(`mcp:${server.id}`, `MCP ${server.name}`, "fail", "Stdio transport requires command.")
      );
      continue;
    }

    if ((server.transport === "http" || server.transport === "sse") && server.url.trim().length === 0) {
      checks.push(
        makeCheck(`mcp:${server.id}`, `MCP ${server.name}`, "fail", "HTTP/SSE transport requires URL.")
      );
      continue;
    }

    checks.push(makeCheck(`mcp:${server.id}`, `MCP ${server.name}`, "pass", "Server is enabled."));
  }

  const requiresStorage =
    pipeline.steps.some(
      (step) =>
        step.enableSharedStorage ||
        step.enableIsolatedStorage ||
        step.requiredOutputFiles.length > 0
    ) || pipeline.qualityGates.some((gate) => gate.kind === "artifact_exists");

  if (requiresStorage && !state.storage.enabled) {
    checks.push(
      makeCheck(
        "storage:enabled",
        "Storage",
        "fail",
        "Storage is required by this flow but disabled.",
        "Enable storage in MCP & Storage tab."
      )
    );
  } else {
    checks.push(
      makeCheck(
        "storage:enabled",
        "Storage",
        state.storage.enabled ? "pass" : "warn",
        state.storage.enabled ? "Storage is enabled." : "Storage disabled (flow may still run if not needed).",
        state.storage.rootPath
      )
    );
  }

  return checks;
}
