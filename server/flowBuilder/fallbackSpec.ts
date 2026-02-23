import { defaultSchedule } from "./constants.js";
import type { LinkCondition } from "../types.js";
import type { GeneratedFlowSpec } from "./schema.js";

export function fallbackSpec(prompt: string): GeneratedFlowSpec {
  const input = prompt.toLowerCase();
  const includesDesignExtraction =
    input.includes("design") ||
    input.includes("ui kit") ||
    input.includes("assets manifest") ||
    input.includes("frame map");
  const includesHtml = input.includes("html");
  const includesPdf = input.includes("pdf");
  const disableOrchestrator =
    input.includes("without orchestrator") || input.includes("no orchestrator") || input.includes("without an orchestrator");
  const includeOrchestrator = !disableOrchestrator && (input.includes("orchestrator") || input.includes("loop"));

  if (includesDesignExtraction && includesHtml && includesPdf) {
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
              skipIfArtifacts: [],
              policyProfileIds: [],
              cacheBypassInputKeys: [],
              cacheBypassOrchestratorPromptPatterns: []
            }
          ]
        : []),
      {
        name: "Design Asset Extraction",
        role: "analysis" as const,
        prompt:
          "Extract reusable design tokens and assets from the source design links. Persist ui-kit.json, frame-map.json, assets-manifest.json, and dev-code.json with compact metadata and file references under shared assets.",
        outputFormat: "json" as const,
        enableSharedStorage: true,
        enableIsolatedStorage: true,
        scenarios: ["design_deck"],
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
        ],
        policyProfileIds: ["design_deck_assets"],
        cacheBypassInputKeys: ["force_refresh_design_assets"],
        cacheBypassOrchestratorPromptPatterns: []
      },
      {
        name: "Source Content Extraction",
        role: "analysis" as const,
        prompt:
          "Extract source content into pdf-content.json. Keep structure deterministic and preserve textual fidelity for downstream HTML synthesis.",
        outputFormat: "json" as const,
        enableSharedStorage: true,
        enableIsolatedStorage: true,
        requiredOutputFiles: ["{{shared_storage_path}}/pdf-content.json"],
        scenarios: ["design_deck"],
        skipIfArtifacts: ["{{shared_storage_path}}/pdf-content.json"],
        policyProfileIds: [],
        cacheBypassInputKeys: ["force_refresh_source_content"],
        cacheBypassOrchestratorPromptPatterns: [
          "source\\s+content\\s+extract(?:ion|or)[\\s\\S]{0,280}(?:runs?\\s+always|always\\s+regardless|must\\s+run\\s+always)",
          "(?:runs?\\s+always|always\\s+regardless|must\\s+run\\s+always)[\\s\\S]{0,280}source\\s+content\\s+extract(?:ion|or)"
        ]
      },
      {
        name: "HTML Builder",
        role: "executor" as const,
        prompt:
          "Synthesize HTML using frame-map/ui-kit/assets-manifest styling with content from pdf-content.json. Keep visible source content in DOM and avoid helper scripts for transformations.",
        outputFormat: "markdown" as const,
        enableSharedStorage: true,
        enableIsolatedStorage: true,
        requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.html"],
        scenarios: ["design_deck"],
        skipIfArtifacts: ["{{shared_storage_path}}/investor-deck.html"],
        policyProfileIds: [],
        cacheBypassInputKeys: [],
        cacheBypassOrchestratorPromptPatterns: []
      },
      {
        name: "HTML Reviewer",
        role: "review" as const,
        prompt:
          "Review generated HTML against design fidelity and content fidelity. Fail on hidden content, malformed backgrounds, or source-content mismatch.",
        outputFormat: "json" as const,
        requiredOutputFields: ["status", "blockingIssues"],
        enableSharedStorage: true,
        scenarios: ["design_deck"],
        skipIfArtifacts: [],
        policyProfileIds: [],
        cacheBypassInputKeys: [],
        cacheBypassOrchestratorPromptPatterns: []
      },
      {
        name: "PDF Renderer",
        role: "executor" as const,
        outputFormat: "markdown" as const,
        enableSharedStorage: true,
        enableIsolatedStorage: true,
        requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.pdf"],
        scenarios: ["design_deck"],
        skipIfArtifacts: ["{{shared_storage_path}}/investor-deck.pdf"],
        policyProfileIds: [],
        cacheBypassInputKeys: [],
        cacheBypassOrchestratorPromptPatterns: []
      },
      {
        name: "PDF Reviewer",
        role: "review" as const,
        prompt:
          "Validate PDF visual quality and content fidelity against HTML/source requirements. Report clear pass/fail with blocking issues.",
        outputFormat: "json" as const,
        requiredOutputFields: ["status", "blockingIssues"],
        enableSharedStorage: true,
        scenarios: ["design_deck"],
        skipIfArtifacts: [],
        policyProfileIds: [],
        cacheBypassInputKeys: [],
        cacheBypassOrchestratorPromptPatterns: []
      },
      {
        name: "Delivery / QA Report",
        role: "review" as const,
        outputFormat: "markdown" as const,
        enableSharedStorage: true,
        scenarios: ["design_deck"],
        skipIfArtifacts: [],
        policyProfileIds: [],
        cacheBypassInputKeys: [],
        cacheBypassOrchestratorPromptPatterns: []
      }
    ];

    const root = includeOrchestrator ? "Main Orchestrator" : "Design Asset Extraction";
    return {
      name: "Design to HTML to PDF Pipeline",
      description: "Design assets -> HTML -> PDF with verification and remediation loops.",
      runtime: {
        maxLoops: 3,
        maxStepExecutions: 30,
        stageTimeoutMs: 420000
      },
      schedule: { ...defaultSchedule },
      steps,
      links: [
        ...(includeOrchestrator
          ? [{ source: "Main Orchestrator", target: "Design Asset Extraction", condition: "always" as const }]
          : []),
        { source: root, target: "Source Content Extraction", condition: "always" },
        { source: "Source Content Extraction", target: "HTML Builder", condition: "always" },
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
      ? [
          {
            name: "Main Orchestrator",
            role: "orchestrator" as const,
            scenarios: [],
            skipIfArtifacts: [],
            policyProfileIds: [],
            cacheBypassInputKeys: [],
            cacheBypassOrchestratorPromptPatterns: []
          }
        ]
      : []),
    {
      name: "Analysis",
      role: "analysis" as const,
      outputFormat: "markdown" as const,
      scenarios: [],
      skipIfArtifacts: [],
      policyProfileIds: [],
      cacheBypassInputKeys: [],
      cacheBypassOrchestratorPromptPatterns: []
    },
    {
      name: "Planner",
      role: "planner" as const,
      outputFormat: "markdown" as const,
      scenarios: [],
      skipIfArtifacts: [],
      policyProfileIds: [],
      cacheBypassInputKeys: [],
      cacheBypassOrchestratorPromptPatterns: []
    },
    {
      name: "Executor",
      role: "executor" as const,
      outputFormat: "markdown" as const,
      scenarios: [],
      skipIfArtifacts: [],
      policyProfileIds: [],
      cacheBypassInputKeys: [],
      cacheBypassOrchestratorPromptPatterns: []
    },
    {
      name: "Tester",
      role: "tester" as const,
      outputFormat: "markdown" as const,
      scenarios: [],
      skipIfArtifacts: [],
      policyProfileIds: [],
      cacheBypassInputKeys: [],
      cacheBypassOrchestratorPromptPatterns: []
    },
    {
      name: "Reviewer",
      role: "review" as const,
      outputFormat: "markdown" as const,
      scenarios: [],
      skipIfArtifacts: [],
      policyProfileIds: [],
      cacheBypassInputKeys: [],
      cacheBypassOrchestratorPromptPatterns: []
    }
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
