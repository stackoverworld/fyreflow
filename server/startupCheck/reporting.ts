import type { Pipeline, RunInputRequest, RunStartupBlocker, RunStartupCheck } from "../types.js";

export function summarizePipelineForVerifier(pipeline: Pipeline): Record<string, unknown> {
  return {
    name: pipeline.name,
    description: pipeline.description,
    runtime: pipeline.runtime,
    steps: pipeline.steps.map((step) => ({
      id: step.id,
      name: step.name,
      role: step.role,
      prompt: step.prompt.slice(0, 1200),
      contextTemplate: step.contextTemplate.slice(0, 1000),
      requiredOutputFields: step.requiredOutputFields,
      requiredOutputFiles: step.requiredOutputFiles,
      scenarios: step.scenarios,
      skipIfArtifacts: step.skipIfArtifacts
    })),
    links: pipeline.links.map((link) => ({
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition
    })),
    qualityGates: pipeline.qualityGates.map((gate) => ({
      name: gate.name,
      targetStepId: gate.targetStepId,
      kind: gate.kind,
      blocking: gate.blocking,
      pattern: gate.pattern.slice(0, 300),
      jsonPath: gate.jsonPath,
      artifactPath: gate.artifactPath
    }))
  };
}

export function buildVerifierPrompt(): string {
  return [
    "You are a startup validator for a multi-agent workflow.",
    "Goal: detect missing user inputs that block a high-quality run.",
    "Return STRICT JSON only. No markdown fences.",
    "Schema:",
    "{",
    '  "status": "pass|needs_input|blocked",',
    '  "summary": "short summary",',
    '  "requests": [',
    "    {",
    '      "key": "input_key",',
    '      "label": "Human label",',
    '      "type": "text|multiline|secret|path|url|select",',
    '      "required": true,',
    '      "reason": "why it is needed",',
    '      "placeholder": "optional placeholder",',
    '      "options": [ { "value": "x", "label": "X", "description": "optional" } ],',
    '      "allowCustom": true',
    "    }",
    "  ],",
    '  "blockers": [ { "id": "id", "title": "title", "message": "message", "details": "optional" } ],',
    '  "notes": ["optional note"]',
    "}",
    "Rules:",
    "- Include requests only for MISSING or ambiguous values.",
    "- Do not request values already present in run_inputs.",
    "- Use type=secret for tokens/keys/passwords.",
    "- Secret requests are stored securely per pipeline and reused in future runs.",
    "- Use type=select only when there is a finite option set.",
    "- If no requests and no blockers, set status=pass."
  ].join("\n");
}

export function buildVerifierContext(
  pipeline: Pipeline,
  task: string,
  runInputs: Record<string, string>,
  deterministicRequests: RunInputRequest[],
  deterministicBlockers: RunStartupBlocker[]
): string {
  return [
    "Validate startup readiness for this flow.",
    "",
    `Task:\n${task || "(empty)"}`,
    "",
    `Run inputs:\n${JSON.stringify(runInputs, null, 2)}`,
    "",
    `Deterministic missing requests:\n${JSON.stringify(deterministicRequests, null, 2)}`,
    "",
    `Deterministic blockers:\n${JSON.stringify(deterministicBlockers, null, 2)}`,
    "",
    `Pipeline summary:\n${JSON.stringify(summarizePipelineForVerifier(pipeline), null, 2)}`
  ].join("\n");
}

export function summarizeStatus(
  status: RunStartupCheck["status"],
  requests: RunInputRequest[],
  blockers: RunStartupBlocker[],
  modelSummary?: string
): string {
  if (modelSummary && modelSummary.trim().length > 0) {
    return modelSummary.trim();
  }

  if (status === "blocked") {
    if (blockers.length > 0) {
      return blockers[0].message;
    }
    return "Startup is blocked by flow configuration issues.";
  }

  if (status === "needs_input") {
    if (requests.length === 0) {
      return "Additional run inputs are required.";
    }

    const names = requests.slice(0, 4).map((request) => request.label || request.key);
    return `Provide required inputs: ${names.join(", ")}${requests.length > 4 ? "..." : ""}`;
  }

  return "Startup checks passed.";
}
