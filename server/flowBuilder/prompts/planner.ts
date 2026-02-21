import { clip } from "../normalizers.js";

interface PlannerRequest {
  prompt: string;
  availableMcpServers?: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    transport?: "stdio" | "http" | "sse";
    summary?: string;
  }>;
}

function summarizeAvailableMcpServers(servers: PlannerRequest["availableMcpServers"]): string {
  if (!Array.isArray(servers) || servers.length === 0) {
    return "No MCP servers configured.";
  }

  const normalized = servers
    .filter((server) => typeof server.id === "string" && server.id.trim().length > 0)
    .slice(0, 24)
    .map((server) => ({
      id: server.id.trim(),
      name: typeof server.name === "string" ? server.name.trim() : server.id.trim(),
      enabled: server.enabled !== false,
      transport: server.transport ?? "http",
      summary: typeof server.summary === "string" ? clip(server.summary, 220) : undefined
    }));

  if (normalized.length === 0) {
    return "No MCP servers configured.";
  }

  return clip(JSON.stringify(normalized, null, 2), 6000);
}

export function buildPlannerContext(request: PlannerRequest): string {
  return [
    "Generate a workflow graph for the request below.",
    "",
    "Return STRICT JSON only. No markdown. No explanation.",
    "Do not include any prose outside the JSON object.",
    "",
    "JSON schema:",
    "{",
    '  "name": "Flow name",',
    '  "description": "One sentence",',
    '  "runtime": { "maxLoops": 2, "maxStepExecutions": 18, "stageTimeoutMs": 420000 },',
    '  "schedule": { "enabled": false, "cron": "0 9 * * 1-5", "timezone": "America/New_York", "task": "Run morning sync checks", "runMode": "smart", "inputs": { "source_pdf_path": "/tmp/source.pdf" } },',
    '  "steps": [',
    '    { "name": "Main Orchestrator", "role": "orchestrator", "prompt": "...", "contextTemplate": "Task:\\n{{task}}\\nRun inputs:\\n{{run_inputs}}", "enableSharedStorage": true, "outputFormat": "markdown" },',
    '    { "name": "Builder", "role": "executor", "prompt": "...", "contextTemplate": "Task:\\n{{task}}\\nIncoming:\\n{{incoming_outputs}}", "enableIsolatedStorage": true, "enableSharedStorage": true, "enabledMcpServerIds": ["figma-mcp-id"], "outputFormat": "json", "requiredOutputFields": ["status", "artifacts.html"], "requiredOutputFiles": ["{{shared_storage_path}}/artifacts.html"], "scenarios": ["full"], "skipIfArtifacts": ["{{shared_storage_path}}/investor-deck.html"] }',
    "  ],",
    '  "links": [',
    '    { "source": "Main Orchestrator", "target": "Builder", "condition": "always" }',
    "  ],",
    '  "qualityGates": [',
    '    { "name": "Builder JSON has status", "target": "Builder", "kind": "json_field_exists", "jsonPath": "status", "blocking": true }',
    "  ]",
    "}",
    "",
    "Rules:",
    "- Roles allowed: analysis, planner, orchestrator, executor, tester, review.",
    "- Use on_fail/on_pass links for remediation loops when reviewers exist.",
    "- Always configure pipeline qualityGates. At minimum, add one blocking status gate per review/tester step.",
    "- qualityGate kinds supported: regex_must_match, regex_must_not_match, json_field_exists, artifact_exists, manual_approval.",
    "- Use manual_approval for explicit human checkpoints; these gates pause run execution until approved or rejected.",
    "- Use step requiredOutputFields/requiredOutputFiles for step contracts; use qualityGates for pipeline-level blocking checks.",
    "- For artifact-producing flows, enable shared storage on producer/consumer steps and write intermediate files under {{shared_storage_path}}.",
    "- Use isolated storage for step-private scratch/temp artifacts and caches that should remain local to one step.",
    "- Prefer {{shared_storage_path}} for internal pipeline artifacts; reserve {{input.output_dir}} for final user-facing deliverables.",
    "- Use step.scenarios tags when user asks for selectable scenario-specific paths from one pipeline.",
    "- Use step.skipIfArtifacts to skip expensive steps when artifacts already exist from previous runs.",
    "- When scenario tags are used, align with a runtime selector (for example run scenario or {{input.scenario}}).",
    "- Use contextTemplate when step needs custom context windows or explicit run-input/storage/tool visibility.",
    "- Keep step names unique.",
    "- Each step must have a concise actionable prompt.",
    "- Prefer orchestrator for multi-stage complex pipelines unless explicitly not requested.",
    "- Platform supports startup-check and runtime needs_input prompts with secure secret persistence per pipeline.",
    "- Platform supports optional cron scheduling via schedule.enabled, schedule.cron, schedule.timezone, schedule.runMode (smart|quick), and optional schedule.inputs.",
    "- Only set schedule.enabled=true when user explicitly asks for automatic scheduled runs.",
    "- Platform supports per-step MCP access via enabledMcpServerIds and per-step isolated/shared storage.",
    "- Parameterize runtime-specific values via placeholders like {{input.source_pdf_path}} instead of hardcoding secrets/paths.",
    "- Keep run-input keys canonical and reusable (for example: figma_links, figma_token, source_pdf_path, output_dir).",
    "- Mirror artifact locations in requiredOutputFiles/quality-gate artifactPath placeholders (prefer {{shared_storage_path}}/file.json for intermediate files).",
    "- For network-heavy or multi-artifact pipelines, prefer stageTimeoutMs >= 420000.",
    "",
    "Configured MCP servers (use exact ids in enabledMcpServerIds when needed):",
    summarizeAvailableMcpServers(request.availableMcpServers),
    "",
    "User request:",
    request.prompt.trim()
  ].join("\n");
}

export function buildPlannerRegenerationContext(
  request: PlannerRequest,
  rawOutput: string,
  repairedOutput?: string
): string {
  const rawClip = clip(rawOutput, 12000);
  const repairedClip = repairedOutput ? clip(repairedOutput, 12000) : "";

  return [
    buildPlannerContext(request),
    "",
    "Previous output was invalid JSON. Regenerate the FULL response now.",
    "Return one JSON object only. No markdown. No comments.",
    "",
    "Invalid previous output:",
    rawClip,
    ...(repairedClip.length > 0 ? ["", "Invalid repair attempt:", repairedClip] : [])
  ].join("\n");
}
