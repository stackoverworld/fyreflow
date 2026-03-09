import { clip } from "../normalizers.js";
import {
  formatProviderRuntimeContext,
  type FlowBuilderProviderRuntimeContext
} from "./providerRuntime.js";

interface PlannerRequest {
  prompt: string;
  providerRuntime?: FlowBuilderProviderRuntimeContext;
  availableMcpServers?: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    transport?: "stdio" | "http";
    summary?: string;
  }>;
}

const REGENERATION_OUTPUT_CLIP_CHARS = 48_000;

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
  const providerRuntime = request.providerRuntime
    ? formatProviderRuntimeContext(request.providerRuntime)
    : "Provider runtime profile is unavailable.";

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
    '    { "name": "Main Orchestrator", "role": "orchestrator", "prompt": "...", "contextTemplate": "Task:\\n{{task}}\\nRun inputs:\\n{{run_inputs}}", "enableDelegation": true, "delegationCount": 3, "enableSharedStorage": true, "sandboxMode": "secure", "outputFormat": "markdown", "policyProfileIds": [], "cacheBypassInputKeys": [], "cacheBypassOrchestratorPromptPatterns": [] },',
    '    { "name": "Builder", "role": "executor", "prompt": "...", "contextTemplate": "Task:\\n{{task}}\\nIncoming:\\n{{incoming_outputs}}", "enableIsolatedStorage": true, "enableSharedStorage": true, "enabledMcpServerIds": ["design-mcp-id"], "sandboxMode": "secure", "outputFormat": "json", "requiredOutputFields": ["status", "artifacts.html"], "requiredOutputFiles": ["{{shared_storage_path}}/artifacts.html"], "scenarios": ["default"], "skipIfArtifacts": ["{{shared_storage_path}}/artifacts.html"], "policyProfileIds": ["design_deck_assets"], "cacheBypassInputKeys": ["force_refresh_design_assets"], "cacheBypassOrchestratorPromptPatterns": ["pdf content extraction.*runs always"] }',
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
    "- Use json_field_exists for JSON outputs, or provide artifactPath when validating a JSON file artifact.",
    "- Use manual_approval for explicit human checkpoints; these gates pause run execution until approved or rejected.",
    "- Use step requiredOutputFields/requiredOutputFiles for step contracts; use qualityGates for pipeline-level blocking checks.",
    "- For every non-review/tester step with required outputs, outputFormat=json, or blocking quality gates targeted at that step, include at least one on_fail remediation route.",
    "- Do not create flows where producer steps can only pass if their artifacts already existed before the first run.",
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
    "- Set step.sandboxMode to secure for local-only steps and full for steps that must access external network targets (GitHub/GitLab/APIs/publish/deploy).",
    "- sandboxMode allowed values: auto, secure, full.",
    "- For multi-file repository publish/update steps, use one atomic commit operation (for GitLab: /repository/commits with actions[]) instead of per-file commit loops.",
    "- For code/site generation flows that publish to a repo, add a blocking validation step before publish (import/build integrity) and route on_fail back to generator.",
    "- Parameterize runtime-specific values via placeholders like {{input.source_pdf_path}} instead of hardcoding secrets/paths.",
    "- Keep run-input keys canonical and reusable (for example: source_links, source_api_token, source_pdf_path, output_dir).",
    "- For GitHub credential guidance, distinguish token types explicitly: classic PAT scope list uses repo/public_repo and does NOT include Contents: Read; fine-grained PAT uses repository permissions such as Contents: Read and Metadata: Read.",
    "- For GitLab credential guidance, use read_repository for read/fetch steps and write_repository for publish/update steps.",
    "- Never invent or rename provider permission/scope names. If uncertain, request clarification about token type instead of guessing.",
    "- Mirror artifact locations in requiredOutputFiles/quality-gate artifactPath placeholders (prefer {{shared_storage_path}}/file.json for intermediate files).",
    "- For network-heavy or multi-artifact pipelines, prefer stageTimeoutMs >= 420000.",
    "- Use step.policyProfileIds to enable reusable backend policies (for example design_deck_assets for frame-map/assets-manifest contracts).",
    "- For deterministic fetch/diff/validate/publish work, prefer policyProfileIds deterministic_fetch / deterministic_diff / deterministic_validate / deterministic_publish instead of another agent step.",
    '- When using deterministic_* profiles, make step.prompt a strict JSON config object, not prose.',
    "- Use step.cacheBypassInputKeys when a step must bypass skip-cache on explicit run inputs.",
    "- Use step.cacheBypassOrchestratorPromptPatterns when orchestrator instructions should force a step refresh.",
    "- If required external tooling is unavailable in configured MCP servers, add an explicit prerequisite/manual approval checkpoint instead of pretending extraction already happened.",
    "- For parallel multi-agent workflows, set enableDelegation=true on the orchestrator step and delegationCount (1-8) to control max parallel workers.",
    "- Fan-out pattern: one orchestrator step linked to multiple executor/analysis steps with condition=always. All parallel targets run concurrently.",
    "- Fan-in pattern: multiple parallel steps linked to a single aggregation/review step with condition=always. The fan-in step waits for all sources.",
    "- Orchestrator loop pattern: reviewer emits pass/fail, on_fail routes back to orchestrator or parallel agents, on_pass proceeds to next phase.",
    "- For multi-agent parallel pipelines, increase maxLoops (3-5) and maxStepExecutions (24-40) to allow sufficient execution budget.",
    "",
    providerRuntime,
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
  const rawClip = clip(rawOutput, REGENERATION_OUTPUT_CLIP_CHARS);
  const repairedClip = repairedOutput ? clip(repairedOutput, REGENERATION_OUTPUT_CLIP_CHARS) : "";

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
