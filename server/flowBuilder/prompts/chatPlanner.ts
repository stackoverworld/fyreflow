import {
  clip,
  normalizeRef,
  normalizeRuntime,
  normalizeSchedule
} from "../normalizers.js";
import {
  maxHistoryCharsPerMessage,
  maxHistoryCompactionChars,
  maxHistoryContextChars,
  maxHistorySummaryLineChars
} from "../constants.js";
import type { PipelineInput } from "../../types.js";
import {
  formatProviderRuntimeContext,
  type FlowBuilderProviderRuntimeContext
} from "./providerRuntime.js";

interface PromptHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface PlannerRequest {
  prompt: string;
  providerRuntime?: FlowBuilderProviderRuntimeContext;
  availableMcpServers?: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    transport?: "stdio" | "http" | "sse";
    summary?: string;
  }>;
}

interface ChatRequest extends PlannerRequest {
  currentDraft?: PipelineInput;
  history?: PromptHistoryMessage[];
}

const REGENERATION_OUTPUT_CLIP_CHARS = 48_000;

function summarizeCurrentDraft(currentDraft: PipelineInput | undefined): string {
  if (!currentDraft) {
    return "No current flow is loaded in the editor.";
  }

  const nameById = new Map(currentDraft.steps.map((step) => [step.id, step.name]));
  const summary = {
    name: currentDraft.name,
    description: currentDraft.description,
    runtime: normalizeRuntime(currentDraft.runtime),
    schedule: normalizeSchedule(currentDraft.schedule),
    steps: currentDraft.steps.map((step) => ({
      name: step.name,
      role: step.role,
      prompt: clip(step.prompt, 320),
      enableDelegation: step.enableDelegation,
      delegationCount: step.delegationCount,
      enableIsolatedStorage: step.enableIsolatedStorage,
      enableSharedStorage: step.enableSharedStorage,
      enabledMcpServerIds: step.enabledMcpServerIds,
      outputFormat: step.outputFormat,
      requiredOutputFields: step.requiredOutputFields,
      requiredOutputFiles: step.requiredOutputFiles,
      scenarios: step.scenarios,
      skipIfArtifacts: step.skipIfArtifacts,
      policyProfileIds: step.policyProfileIds,
      cacheBypassInputKeys: step.cacheBypassInputKeys,
      cacheBypassOrchestratorPromptPatterns: step.cacheBypassOrchestratorPromptPatterns
    })),
    links: (currentDraft.links ?? []).map((link) => ({
      source: nameById.get(link.sourceStepId) ?? link.sourceStepId,
      target: nameById.get(link.targetStepId) ?? link.targetStepId,
      condition: link.condition ?? "always"
    })),
    qualityGates: (currentDraft.qualityGates ?? []).map((gate) => ({
      name: gate.name,
      target: gate.targetStepId === "any_step" ? "any_step" : nameById.get(gate.targetStepId) ?? gate.targetStepId,
      kind: gate.kind,
      blocking: gate.blocking,
      pattern: clip(gate.pattern ?? "", 220),
      flags: gate.flags ?? "",
      jsonPath: clip(gate.jsonPath ?? "", 220),
      artifactPath: clip(gate.artifactPath ?? "", 220),
      message: clip(gate.message ?? "", 220)
    }))
  };

  return clip(JSON.stringify(summary, null, 2), 22000);
}

function summarizeAvailableMcpServers(servers: ChatRequest["availableMcpServers"]): string {
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

function normalizeHistory(history: PromptHistoryMessage[] | undefined, prompt: string): PromptHistoryMessage[] {
  const sanitized = (history ?? [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: clip(message.content, maxHistoryCharsPerMessage)
    }));

  const latestPrompt = clip(prompt, maxHistoryCharsPerMessage);
  const last = sanitized[sanitized.length - 1];
  const hasPromptAlready = last?.role === "user" && normalizeRef(last.content) === normalizeRef(latestPrompt);

  if (!hasPromptAlready) {
    sanitized.push({ role: "user", content: latestPrompt });
  }

  return compactHistoryByContextBudget(sanitized);
}

function countHistoryChars(history: PromptHistoryMessage[]): number {
  return history.reduce((sum, message) => sum + message.content.length + 16, 0);
}

function compactHistoryByContextBudget(history: PromptHistoryMessage[]): PromptHistoryMessage[] {
  if (history.length <= 1) {
    return history;
  }
  if (countHistoryChars(history) <= maxHistoryContextChars) {
    return history;
  }

  const summaryReserveChars = Math.min(maxHistoryCompactionChars, Math.floor(maxHistoryContextChars * 0.4));
  const maxRecentChars = Math.max(4_000, maxHistoryContextChars - summaryReserveChars);
  const recent: PromptHistoryMessage[] = [];
  let recentChars = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) {
      continue;
    }
    const nextChars = recentChars + message.content.length + 16;
    if (recent.length > 0 && nextChars > maxRecentChars) {
      break;
    }
    recent.push(message);
    recentChars = nextChars;
  }
  recent.reverse();

  const compactedCount = Math.max(0, history.length - recent.length);
  if (compactedCount === 0) {
    return recent;
  }

  const compactedPrefix = history.slice(0, compactedCount);
  const compactedDetail = clip(
    compactedPrefix
      .map(
        (message, index) =>
          `${index + 1}. ${message.role.toUpperCase()}: ${clip(message.content, maxHistorySummaryLineChars)}`
      )
      .join("\n"),
    maxHistoryCompactionChars
  );
  const summaryMessage: PromptHistoryMessage = {
    role: "assistant",
    content: `Earlier conversation was compacted (${compactedCount} message(s)).\n${compactedDetail}`
  };
  const merged = [summaryMessage, ...recent];

  while (merged.length > 1 && countHistoryChars(merged) > maxHistoryContextChars) {
    merged.splice(1, 1);
  }

  if (countHistoryChars(merged) > maxHistoryContextChars) {
    const hardMaxSummaryChars = Math.max(1200, maxHistoryContextChars - 200);
    merged[0] = {
      ...summaryMessage,
      content: clip(summaryMessage.content, hardMaxSummaryChars)
    };
  }

  return merged;
}

function formatHistoryForContext(history: PromptHistoryMessage[]): string {
  if (history.length === 0) {
    return "No prior conversation.";
  }

  return history.map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

export function buildChatPlannerContext(request: ChatRequest): string {
  const normalizedHistory = normalizeHistory(request.history, request.prompt);
  const providerRuntime = request.providerRuntime
    ? formatProviderRuntimeContext(request.providerRuntime)
    : "Provider runtime profile is unavailable.";

  return [
    "You are an AI copilot inside a visual multi-agent flow editor.",
    "",
    "Return STRICT JSON only. No markdown. No explanation.",
    "Do not include any prose outside the JSON object.",
    "",
    "Decide exactly one action for the latest user message:",
    "- answer: respond conversationally, without changing the flow.",
    "- update_current_flow: modify the currently loaded flow.",
    "- replace_flow: create a brand new flow from scratch.",
    "",
    "Output schema:",
    "{",
    '  "action": "answer | update_current_flow | replace_flow",',
    '  "message": "assistant response to show in chat",',
    '  "questions": [',
    '    {',
    '      "id": "budget_profile",',
    '      "question": "What priority should I optimize for in this flow?",',
    '      "options": [',
    '        { "label": "Quality", "value": "Prioritize quality, expensive models are acceptable." },',
    '        { "label": "Balanced", "value": "Use a balanced approach across cost, speed, and quality." },',
    '        { "label": "Cost", "value": "Prioritize low cost with acceptable quality." }',
    "      ]",
    "    }",
    "  ],",
    '  "flow": {',
    '    "name": "Flow name",',
    '    "description": "One sentence",',
    '    "runtime": { "maxLoops": 2, "maxStepExecutions": 18, "stageTimeoutMs": 420000 },',
    '    "schedule": { "enabled": false, "cron": "0 9 * * 1-5", "timezone": "America/New_York", "task": "Run morning sync checks", "runMode": "smart", "inputs": {} },',
    '    "steps": [',
    '      { "name": "Main Orchestrator", "role": "orchestrator", "prompt": "...", "contextTemplate": "Task:\\n{{task}}\\nRun inputs:\\n{{run_inputs}}", "enableSharedStorage": true, "outputFormat": "markdown", "scenarios": [], "skipIfArtifacts": [], "policyProfileIds": [], "cacheBypassInputKeys": [], "cacheBypassOrchestratorPromptPatterns": [] },',
    '      { "name": "Builder", "role": "executor", "prompt": "...", "enableSharedStorage": true, "enableIsolatedStorage": true, "outputFormat": "json", "requiredOutputFiles": ["{{shared_storage_path}}/result.json"], "scenarios": ["default"], "skipIfArtifacts": ["{{shared_storage_path}}/result.json"], "policyProfileIds": ["design_deck_assets"], "cacheBypassInputKeys": ["force_refresh_design_assets"], "cacheBypassOrchestratorPromptPatterns": ["pdf content extraction.*runs always"] }',
    "    ],",
    '    "links": [',
    '      { "source": "Main Orchestrator", "target": "Builder", "condition": "always" }',
    "    ],",
    '    "qualityGates": [',
    '      { "name": "Gate", "target": "any_step", "kind": "regex_must_match", "pattern": "WORKFLOW_STATUS", "blocking": true }',
    "    ]",
    "  }",
    "}",
    "",
    "Rules:",
    "- Roles allowed: analysis, planner, orchestrator, executor, tester, review.",
    "- Link conditions allowed: always, on_pass, on_fail.",
    "- Always configure pipeline qualityGates. Add blocking status gates for review/tester steps.",
    "- qualityGate kinds supported: regex_must_match, regex_must_not_match, json_field_exists, artifact_exists, manual_approval.",
    "- Use json_field_exists for JSON outputs, or provide artifactPath when validating a JSON file artifact.",
    "- Use manual_approval when user asks for explicit human decision points in the loop.",
    "- Use step requiredOutputFields/requiredOutputFiles for per-step contracts and qualityGates for pipeline-level checks.",
    "- For every non-review/tester step with required outputs, outputFormat=json, or blocking quality gates targeted at that step, include at least one on_fail remediation route.",
    "- Do not create flows where a producer step can only pass if its own artifacts already existed before the first run.",
    "- For artifact-producing flows, enable shared storage on producer/consumer steps and use {{shared_storage_path}} for intermediate artifacts.",
    "- Use isolated storage for step-private scratch/temp artifacts that should not be shared downstream.",
    "- Prefer {{shared_storage_path}} for internal pipeline files and use {{input.output_dir}} only for final delivery/export.",
    "- Use step.scenarios when user wants selectable flow variants (same pipeline, different paths).",
    "- Use step.skipIfArtifacts when user wants cached steps to auto-skip if files already exist.",
    "- When scenario tags are used, align with runtime selector usage (run scenario or {{input.scenario}}).",
    "- Use contextTemplate for steps that depend on run-input mappings or specific runtime context blocks.",
    "- If key requirements are missing or ambiguous, use action=answer and include 1-3 questions with multiple-choice options.",
    "- questions[].options[].value must be a complete user reply sentence that can be sent back directly when clicked.",
    "- Ask only decision-critical questions (model budget, accuracy target, context size, required tools, output format, deadlines, constraints).",
    "- In update_current_flow, do not silently disable existing enableSharedStorage/enableIsolatedStorage unless user requested that change.",
    "- For update_current_flow, return the full updated flow result in flow (not a patch).",
    "- Preserve existing structure unless user asks for broader changes.",
    "- Use replace_flow only when the user explicitly asks for a new/rebuilt flow.",
    "- Do not place orchestrator preflight checks that require downstream artifacts before producer steps execute.",
    "- If required external tooling (for example Figma extraction) is unavailable in configured MCP servers, prefer action=answer with a clarification question over emitting a brittle flow.",
    "- flow must be omitted when action=answer.",
    "- questions must be omitted when no clarification is needed.",
    "- Platform supports startup-check and runtime needs_input prompts, including secure per-pipeline secret persistence.",
    "- Platform supports optional cron scheduling via schedule.enabled, schedule.cron, schedule.timezone, schedule.runMode (smart|quick), and optional schedule.inputs.",
    "- Only set schedule.enabled=true when user explicitly asks for scheduled execution.",
    "- Platform supports per-step MCP access via enabledMcpServerIds and isolated/shared storage toggles.",
    "- Parameterize runtime-specific values via placeholders like {{input.output_dir}} and {{input.source_links}}.",
    "- Keep run-input keys canonical and reusable (for example: source_links, source_api_token, source_pdf_path, output_dir).",
    "- Align requiredOutputFiles/quality-gate artifactPath with the same directory used in prompts (prefer {{shared_storage_path}}/artifact.json for internal artifacts).",
    "- For network-heavy or multi-artifact pipelines, prefer stageTimeoutMs >= 420000.",
    "- Use step.policyProfileIds to attach reusable backend policies (for example design_deck_assets for frame-map/assets-manifest contracts).",
    "- Use step.cacheBypassInputKeys for input-driven cache bypass controls.",
    "- Use step.cacheBypassOrchestratorPromptPatterns when orchestrator instructions should force a refresh.",
    "",
    providerRuntime,
    "",
    "Configured MCP servers (use exact ids in enabledMcpServerIds when needed):",
    summarizeAvailableMcpServers(request.availableMcpServers),
    "",
    "Current flow snapshot:",
    summarizeCurrentDraft(request.currentDraft),
    "",
    "Conversation history (oldest first):",
    formatHistoryForContext(normalizedHistory)
  ].join("\n");
}

export function buildChatRegenerationContext(
  request: ChatRequest,
  rawOutput: string,
  repairedOutput?: string
): string {
  const rawClip = clip(rawOutput, REGENERATION_OUTPUT_CLIP_CHARS);
  const repairedClip = repairedOutput ? clip(repairedOutput, REGENERATION_OUTPUT_CLIP_CHARS) : "";

  return [
    buildChatPlannerContext(request),
    "",
    "Previous output was invalid JSON. Regenerate the FULL response now.",
    "Return one JSON object only. No markdown. No comments.",
    "",
    "Invalid previous output:",
    rawClip,
    ...(repairedClip.length > 0 ? ["", "Invalid repair attempt:", repairedClip] : [])
  ].join("\n");
}
