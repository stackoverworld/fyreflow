import { describe, expect, it } from "vitest";

import type { PipelinePayload, PipelineRun } from "../../src/lib/types.ts";
import {
  deriveStepLiveActivityEvents,
  deriveStepLiveActivityLines
} from "../../src/components/dashboard/pipeline-editor/liveActivity.ts";

function createStep(partial: Partial<PipelinePayload["steps"][number]> = {}): PipelinePayload["steps"][number] {
  return {
    id: "step-html-reviewer",
    name: "HTML Reviewer",
    role: "review",
    prompt: "review output",
    providerId: "claude",
    model: "claude-opus-4-6",
    reasoningEffort: "high",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 200_000,
    position: { x: 0, y: 0 },
    contextTemplate: "Task:\n{{task}}",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: true,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    ...partial
  };
}

function createRun(partial: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-1",
    pipelineId: "pipeline-1",
    pipelineName: "Pipeline",
    task: "Task",
    inputs: {},
    status: "running",
    startedAt: "2026-02-22T00:00:00.000Z",
    logs: [],
    steps: [],
    approvals: [],
    ...partial
  };
}

describe("deriveStepLiveActivityEvents", () => {
  it("parses user-facing provider activity for selected step", () => {
    const step = createStep();
    const run = createRun({
      steps: [
        {
          stepId: step.id,
          stepName: step.name,
          role: step.role,
          status: "running",
          attempts: 1,
          workflowOutcome: "neutral",
          inputContext: "",
          output: "",
          subagentNotes: [],
          qualityGateResults: []
        }
      ],
      logs: [
        "HTML Reviewer started (attempt 1)",
        "HTML Reviewer [attempt 1] Provider dispatch started: provider=claude, authMode=oauth, model=claude-opus-4-6",
        "HTML Reviewer [attempt 1] CLI command started: /Users/moiseencov/.local/bin/claude --print --output-format stream-json --model claude-opus-4-6 <prompt> (cwd=/Users/moiseencov/Downloads/Projects/agents-dashboard, timeout=420000ms)",
        "HTML Reviewer [attempt 1] CLI command running: /Users/moiseencov/.local/bin/claude (30010ms elapsed, stdout=0 chars, stderr=0 chars, idle=30010ms, pid=123)",
        'HTML Reviewer [attempt 1] Model command: {"tool":"Read","command":"read /Users/moiseencov/Downloads/Projects/design-to-pdf-v2/investor-deck.html","cwd":"/Users/moiseencov/Downloads/Projects/agents-dashboard"}',
        'HTML Reviewer [attempt 1] Model command: {"tool":"Bash","command":"cd pdf-folder && ls -la","cwd":"/Users/moiseencov/Downloads/Projects/agents-dashboard"}',
        "HTML Reviewer [attempt 1] Model summary: Slide count preserved (12); typography and spacing aligned with UIKit baseline.",
        "HTML Reviewer [attempt 1] CLI stdout chunk: \"HTML_REVIEW_STATUS: PASS WORKFLOW_STATUS: PASS\"",
        "HTML Reviewer completed (pass)"
      ]
    });

    const events = deriveStepLiveActivityEvents(run, step);
    const lines = deriveStepLiveActivityLines(run, step);

    const commandEvent = events.find((event) => event.kind === "command");
    expect(commandEvent).toBeTruthy();
    expect(commandEvent?.command).toContain("/Users/moiseencov/.local/bin/claude");
    expect(commandEvent?.cwd).toBe("/Users/moiseencov/Downloads/Projects/agents-dashboard");
    expect(commandEvent?.timeoutMs).toBe(420000);
    const modelCommandEvent = events.find((event) => event.title.includes("Model shell command"));
    expect(modelCommandEvent).toBeTruthy();
    expect(modelCommandEvent?.command).toBe("cd pdf-folder && ls -la");
    expect(modelCommandEvent?.cwd).toBe("/Users/moiseencov/Downloads/Projects/agents-dashboard");
    const readActionEvent = events.find((event) => event.title.includes("Model tool action (Read file)"));
    expect(readActionEvent).toBeTruthy();
    expect(readActionEvent?.kind).toBe("tool");
    expect(readActionEvent?.detail).toContain("not terminal");
    const summaryEvent = events.find((event) => event.kind === "summary");
    expect(summaryEvent?.detail).toContain("Slide count preserved");
    expect(events.some((event) => event.kind === "command_progress")).toBe(false);

    expect(lines.some((line) => line.includes("Started attempt 1"))).toBe(true);
    expect(lines.some((line) => line.includes("Command started"))).toBe(true);
    expect(lines.some((line) => line.includes("Model summary: Slide count preserved"))).toBe(true);
    expect(lines.some((line) => line.includes("Model stream: HTML_REVIEW_STATUS: PASS WORKFLOW_STATUS: PASS"))).toBe(
      true
    );
    expect(lines.some((line) => line.includes("Completed (pass)"))).toBe(true);
  });

  it("keeps metadata-only stream chunks as heartbeat events", () => {
    const step = createStep();
    const run = createRun({
      steps: [
        {
          stepId: step.id,
          stepName: step.name,
          role: step.role,
          status: "running",
          attempts: 1,
          workflowOutcome: "neutral",
          inputContext: "",
          output: "",
          subagentNotes: [],
          qualityGateResults: []
        }
      ],
      logs: [
        "HTML Reviewer [attempt 1] CLI stdout chunk: \"\\\"session_id\\\":\\\"abc\\\",\\\"uuid\\\":\\\"def\\\",\\\"statusline\\\":[\\\"Explore\\\",\\\"Plan\\\"]\"",
        "HTML Reviewer [attempt 1] CLI stdout chunk: \"\\\"workflow_status\\\":\\\"PASS\\\"\""
      ]
    });

    const events = deriveStepLiveActivityEvents(run, step);

    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("thinking");
    expect(events[0]?.title).toContain("thinking");
    expect(events[0]?.detail).toContain("phase:");
    expect(events[1]?.kind).toBe("output");
    expect(events[1]?.detail).toContain("workflow_status");
  });

  it("respects max event cap", () => {
    const step = createStep();
    const logs = Array.from({ length: 12 }, (_, index) => `${step.name} [attempt 1] Provider round ${index + 1} started`);
    const run = createRun({
      steps: [
        {
          stepId: step.id,
          stepName: step.name,
          role: step.role,
          status: "running",
          attempts: 1,
          workflowOutcome: "neutral",
          inputContext: "",
          output: "",
          subagentNotes: [],
          qualityGateResults: []
        }
      ],
      logs
    });

    const events = deriveStepLiveActivityEvents(run, step, 5);

    expect(events).toHaveLength(5);
    expect(events[0]?.detail).toContain("Provider round 8 started");
    expect(events[4]?.detail).toContain("Provider round 12 started");
  });
});
