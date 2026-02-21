import { defaultSchedule } from "./constants.js";
import type { LinkCondition } from "../types.js";
import type { GeneratedFlowSpec } from "./schema.js";

export function fallbackSpec(prompt: string): GeneratedFlowSpec {
  const input = prompt.toLowerCase();
  const includesFigma = input.includes("figma");
  const includesHtml = input.includes("html");
  const includesPdf = input.includes("pdf");
  const disableOrchestrator =
    input.includes("without orchestrator") || input.includes("no orchestrator") || input.includes("without an orchestrator");
  const includeOrchestrator = !disableOrchestrator && (input.includes("orchestrator") || input.includes("loop"));

  if (includesFigma && includesHtml && includesPdf) {
    const steps = [
      ...(includeOrchestrator
        ? [
            {
              name: "Main Orchestrator",
              role: "orchestrator" as const,
              outputFormat: "markdown" as const,
              enableSharedStorage: true,
              enableIsolatedStorage: true,
              scenarios: [],
              skipIfArtifacts: []
            }
          ]
        : []),
      {
        name: "Figma Extraction / UI Kit",
        role: "analysis" as const,
        outputFormat: "json" as const,
        enableSharedStorage: true,
        enableIsolatedStorage: true,
        requiredOutputFiles: [
          "{{shared_storage_path}}/ui-kit.json",
          "{{shared_storage_path}}/dev-code.json",
          "{{shared_storage_path}}/assets-manifest.json",
          "{{shared_storage_path}}/frame-map.json"
        ],
        skipIfArtifacts: [
          "{{shared_storage_path}}/ui-kit.json",
          "{{shared_storage_path}}/dev-code.json",
          "{{shared_storage_path}}/assets-manifest.json",
          "{{shared_storage_path}}/frame-map.json"
        ]
      },
      {
        name: "HTML Builder",
        role: "executor" as const,
        outputFormat: "markdown" as const,
        enableSharedStorage: true,
        enableIsolatedStorage: true,
        requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.html"],
        scenarios: [],
        skipIfArtifacts: ["{{shared_storage_path}}/investor-deck.html"]
      },
      {
        name: "HTML Reviewer",
        role: "review" as const,
        outputFormat: "json" as const,
        requiredOutputFields: ["status", "blockingIssues"],
        enableSharedStorage: true,
        scenarios: [],
        skipIfArtifacts: []
      },
      {
        name: "PDF Renderer",
        role: "executor" as const,
        outputFormat: "markdown" as const,
        enableSharedStorage: true,
        enableIsolatedStorage: true,
        requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.pdf"],
        scenarios: [],
        skipIfArtifacts: ["{{shared_storage_path}}/investor-deck.pdf"]
      },
      {
        name: "PDF Reviewer",
        role: "review" as const,
        outputFormat: "json" as const,
        requiredOutputFields: ["status", "blockingIssues"],
        enableSharedStorage: true,
        scenarios: [],
        skipIfArtifacts: []
      },
      {
        name: "Delivery / QA Report",
        role: "review" as const,
        outputFormat: "markdown" as const,
        enableSharedStorage: true,
        scenarios: [],
        skipIfArtifacts: []
      }
    ];

    const root = includeOrchestrator ? "Main Orchestrator" : "Figma Extraction / UI Kit";
    return {
      name: "Investor Deck Pipeline",
      description: "Figma -> HTML -> PDF with independent verification and remediation loops.",
      runtime: {
        maxLoops: 3,
        maxStepExecutions: 30,
        stageTimeoutMs: 420000
      },
      schedule: { ...defaultSchedule },
      steps,
      links: [
        ...(includeOrchestrator
          ? [{ source: "Main Orchestrator", target: "Figma Extraction / UI Kit", condition: "always" as const }]
          : []),
        { source: root, target: "HTML Builder", condition: "always" },
        { source: "HTML Builder", target: "HTML Reviewer", condition: "always" },
        { source: "HTML Reviewer", target: "HTML Builder", condition: "on_fail" },
        { source: "HTML Reviewer", target: "PDF Renderer", condition: "on_pass" },
        { source: "PDF Renderer", target: "PDF Reviewer", condition: "always" },
        { source: "PDF Reviewer", target: "HTML Builder", condition: "on_fail" },
        { source: "PDF Reviewer", target: "Delivery / QA Report", condition: "on_pass" }
      ] satisfies Array<{ source: string; target: string; condition: LinkCondition }>,
      qualityGates: [
        {
          name: "HTML reviewer must emit status",
          target: "HTML Reviewer",
          kind: "json_field_exists",
          jsonPath: "status",
          blocking: true
        },
        {
          name: "PDF reviewer must emit status",
          target: "PDF Reviewer",
          kind: "json_field_exists",
          jsonPath: "status",
          blocking: true
        }
      ]
    };
  }

  const steps = [
    ...(includeOrchestrator
      ? [{ name: "Main Orchestrator", role: "orchestrator" as const, scenarios: [], skipIfArtifacts: [] }]
      : []),
    { name: "Analysis", role: "analysis" as const, outputFormat: "markdown" as const, scenarios: [], skipIfArtifacts: [] },
    { name: "Planner", role: "planner" as const, outputFormat: "markdown" as const, scenarios: [], skipIfArtifacts: [] },
    { name: "Executor", role: "executor" as const, outputFormat: "markdown" as const, scenarios: [], skipIfArtifacts: [] },
    { name: "Tester", role: "tester" as const, outputFormat: "markdown" as const, scenarios: [], skipIfArtifacts: [] },
    { name: "Reviewer", role: "review" as const, outputFormat: "markdown" as const, scenarios: [], skipIfArtifacts: [] }
  ];

  const linearLinks: Array<{ source: string; target: string; condition: LinkCondition }> = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    linearLinks.push({
      source: steps[index].name,
      target: steps[index + 1].name,
      condition: "always"
    });
  }

  return {
    name: "Generated Agent Flow",
    description: "Auto-generated workflow from prompt.",
    schedule: { ...defaultSchedule },
    steps,
    links: linearLinks,
    qualityGates: [
      {
        name: "Reviewer emits workflow status",
        target: "Reviewer",
        kind: "regex_must_match",
        pattern: "WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)",
        blocking: true
      }
    ]
  };
}
