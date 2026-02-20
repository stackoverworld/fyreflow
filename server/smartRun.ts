import type {
  DashboardState,
  Pipeline,
  ProviderId,
  SmartRunCheck,
  SmartRunCheckStatus,
  SmartRunField,
  SmartRunFieldType,
  SmartRunPlan
} from "./types.js";
import { extractInputKeysFromText, normalizeRunInputs, type RunInputs } from "./runInputs.js";
import { getProviderOAuthStatus } from "./oauth.js";

interface MutableField {
  key: string;
  required: boolean;
  type?: SmartRunFieldType;
  description?: string;
  placeholder?: string;
  sources: Set<string>;
}

function toLabel(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk.slice(0, 1).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function inferFieldType(key: string): SmartRunFieldType {
  const normalized = key.toLowerCase();

  if (
    normalized.includes("token") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password")
  ) {
    return "secret";
  }

  if (
    normalized.includes("path") ||
    normalized.includes("dir") ||
    normalized.includes("file") ||
    normalized.includes("pdf") ||
    normalized.includes("html") ||
    normalized.includes("output")
  ) {
    return "path";
  }

  if (normalized.includes("url") || normalized.includes("link") || normalized.includes("endpoint")) {
    return "url";
  }

  if (normalized.includes("prompt") || normalized.includes("notes") || normalized.includes("instructions")) {
    return "multiline";
  }

  return "text";
}

function inferPlaceholderForKey(key: string, type: SmartRunFieldType): string {
  if (type === "path") {
    return "/path/to/file-or-dir";
  }
  if (type === "url") {
    return "https://example.com/resource";
  }
  if (type === "secret") {
    return "Enter secret value";
  }
  if (type === "multiline") {
    return "Enter multiline input";
  }
  return `Enter ${toLabel(key).toLowerCase()}`;
}

function inferDescriptionForKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized.includes("figma")) {
    return "Used by Figma extraction stages.";
  }
  if (normalized.includes("pdf")) {
    return "Used by PDF extraction/rendering/review stages.";
  }
  if (normalized.includes("output")) {
    return "Used as output destination for generated artifacts.";
  }
  return "Runtime input available to agents via {{input.<key>}} and run context.";
}

function addField(
  registry: Map<string, MutableField>,
  keyRaw: string,
  source: string,
  options?: Partial<Pick<SmartRunField, "required" | "type" | "description" | "placeholder">>
): void {
  const key = keyRaw.trim().toLowerCase();
  if (key.length === 0) {
    return;
  }

  const existing = registry.get(key);
  if (existing) {
    existing.sources.add(source);
    if (options?.required) {
      existing.required = true;
    }
    if (options?.type) {
      existing.type = options.type;
    }
    if (options?.description && existing.description === undefined) {
      existing.description = options.description;
    }
    if (options?.placeholder && existing.placeholder === undefined) {
      existing.placeholder = options.placeholder;
    }
    return;
  }

  registry.set(key, {
    key,
    required: options?.required ?? true,
    type: options?.type,
    description: options?.description,
    placeholder: options?.placeholder,
    sources: new Set([source])
  });
}

function collectFieldsFromPipeline(pipeline: Pipeline): SmartRunField[] {
  const registry = new Map<string, MutableField>();
  const collectFromText = (text: string, source: string) => {
    for (const key of extractInputKeysFromText(text)) {
      addField(registry, key, source, { required: true });
    }
  };

  collectFromText(pipeline.description, "pipeline.description");

  for (const step of pipeline.steps) {
    collectFromText(step.prompt, `${step.name}.prompt`);
    collectFromText(step.contextTemplate, `${step.name}.contextTemplate`);
    for (const filePath of step.requiredOutputFiles) {
      collectFromText(filePath, `${step.name}.requiredOutputFiles`);
    }
  }

  for (const gate of pipeline.qualityGates) {
    collectFromText(gate.pattern, `qualityGate:${gate.name}.pattern`);
    collectFromText(gate.jsonPath, `qualityGate:${gate.name}.jsonPath`);
    collectFromText(gate.artifactPath, `qualityGate:${gate.name}.artifactPath`);
    collectFromText(gate.message, `qualityGate:${gate.name}.message`);
  }

  const aggregateText = [
    pipeline.name,
    pipeline.description,
    ...pipeline.steps.map((step) => `${step.name}\n${step.prompt}\n${step.contextTemplate}`)
  ]
    .join("\n")
    .toLowerCase();

  if (aggregateText.includes("figma")) {
    addField(registry, "figma_links", "heuristic", {
      required: true,
      type: "multiline",
      description: "One Figma Dev Mode link per line."
    });
  }

  if (aggregateText.includes("figma token") || aggregateText.includes("figma api token")) {
    addField(registry, "figma_token", "heuristic", {
      required: true,
      type: "secret",
      description: "Token used to access Figma resources."
    });
  }

  if (aggregateText.includes("source-of-truth pdf") || (aggregateText.includes("source") && aggregateText.includes("pdf"))) {
    addField(registry, "source_pdf_path", "heuristic", {
      required: true,
      type: "path",
      description: "Path to the source PDF file."
    });
  }

  if (aggregateText.includes("output directory")) {
    addField(registry, "output_dir", "heuristic", {
      required: true,
      type: "path",
      description: "Directory where generated artifacts should be saved."
    });
  }

  if (aggregateText.includes("final html")) {
    addField(registry, "final_html_path", "heuristic", {
      required: false,
      type: "path"
    });
  }

  if (aggregateText.includes("final pdf")) {
    addField(registry, "final_pdf_path", "heuristic", {
      required: false,
      type: "path"
    });
  }

  if (aggregateText.includes("repo/workspace") || aggregateText.includes("workspace")) {
    addField(registry, "workspace_path", "heuristic", {
      required: false,
      type: "path"
    });
  }

  return [...registry.values()]
    .map((field) => {
      const type = field.type ?? inferFieldType(field.key);
      return {
        key: field.key,
        label: toLabel(field.key),
        type,
        required: field.required,
        description: field.description ?? inferDescriptionForKey(field.key),
        placeholder: field.placeholder ?? inferPlaceholderForKey(field.key, type),
        sources: [...field.sources].sort()
      } satisfies SmartRunField;
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function makeCheck(
  id: string,
  title: string,
  status: SmartRunCheckStatus,
  message: string,
  details?: string
): SmartRunCheck {
  return { id, title, status, message, details };
}

async function collectRuntimeChecks(pipeline: Pipeline, state: DashboardState): Promise<SmartRunCheck[]> {
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

function validateRequiredInputs(fields: SmartRunField[], runInputs: RunInputs): SmartRunCheck[] {
  const checks: SmartRunCheck[] = [];

  for (const field of fields.filter((entry) => entry.required)) {
    const value = runInputs[field.key];
    const ok = typeof value === "string" && value.trim().length > 0;
    checks.push(
      makeCheck(
        `input:${field.key}`,
        `Input ${field.label}`,
        ok ? "pass" : "fail",
        ok ? "Provided." : "Required input is missing."
      )
    );
  }

  return checks;
}

export async function buildSmartRunPlan(
  pipeline: Pipeline,
  state: DashboardState,
  rawInputs?: unknown
): Promise<SmartRunPlan> {
  const fields = collectFieldsFromPipeline(pipeline);
  const runInputs = normalizeRunInputs(rawInputs);
  const runtimeChecks = await collectRuntimeChecks(pipeline, state);
  const checks = [...runtimeChecks, ...validateRequiredInputs(fields, runInputs)];
  const canRun = checks.every((check) => check.status !== "fail");

  return {
    fields,
    checks,
    canRun
  };
}
