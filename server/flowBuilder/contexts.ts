import { clip } from "./normalizers.js";

export { buildChatPlannerContext, buildChatRegenerationContext } from "./prompts/chatPlanner.js";
export { buildPlannerContext, buildPlannerRegenerationContext } from "./prompts/planner.js";
export { buildJsonRepairContext } from "./prompts/repair.js";

export function buildChatRepairContext(rawOutput: string): string {
  const clipped = clip(rawOutput, 24000);
  return [
    "Repair the output below into STRICT JSON for the copilot schema.",
    "Return JSON only. No markdown. No explanation.",
    "",
    "Expected shape:",
    "{",
    '  "action": "answer | update_current_flow | replace_flow",',
    '  "message": "assistant response",',
    '  "questions": [',
    '    { "id": "question_id", "question": "Clarifying question", "options": [',
    '      { "label": "Option A", "value": "Full reply sentence for option A" }',
    "    ] }",
    "  ],",
    '  "flow": { "name": "...", "description": "...", "runtime": {...}, "schedule": {...}, "steps": [...], "links": [...], "qualityGates": [...] }',
    "}",
    "",
    "Rules:",
    "- action must be one of answer, update_current_flow, replace_flow.",
    "- Include flow only for update_current_flow or replace_flow.",
    "- Include questions only when clarification is required.",
    "- Keep questions to 1-3 entries. Each question needs id, question, and at least one option with label/value.",
    "- For questions, option value must be a complete reply sentence usable as the next user message.",
    "- Ensure flow fields match allowed roles and link conditions.",
    "- Ensure qualityGate kinds use supported values, including manual_approval when needed.",
    "- Preserve runtime fields when present.",
    "- Keep schedule fields valid and preserve schedule controls where present.",
    "- Preserve schedule.inputs and runMode for scheduling behavior.",
    "- Preserve step.scenarios and step.skipIfArtifacts when present.",
    "- Preserve enableSharedStorage/enableIsolatedStorage and do not disable storage unless user intent requests it.",
    "- Preserve storage placeholders in requiredOutputFiles, skipIfArtifacts, and artifactPath fields.",
    "- If a field is unknown, omit it instead of inventing unsupported fields.",
    "",
    "Input to repair:",
    clipped
  ].join("\n");
}
