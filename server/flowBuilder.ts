import { nanoid } from "nanoid";
import { z } from "zod";
import { resolveDefaultContextWindow, resolveReasoning } from "./modelCatalog.js";
import { executeProviderStep } from "./providers.js";
import type {
  AgentRole,
  LinkCondition,
  PipelineInput,
  PipelineStep,
  ProviderConfig,
  ProviderId,
  QualityGateKind,
  ReasoningEffort
} from "./types.js";

export interface FlowChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type FlowBuilderAction = "answer" | "update_current_flow" | "replace_flow";

export interface FlowBuilderRequest {
  prompt: string;
  providerId: ProviderId;
  model: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  use1MContext?: boolean;
  history?: FlowChatMessage[];
  currentDraft?: PipelineInput;
}

export interface FlowBuilderResponse {
  action: FlowBuilderAction;
  message: string;
  draft?: PipelineInput;
  source: "model" | "fallback";
  notes: string[];
  rawOutput?: string;
}

const generatedFlowSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  runtime: z
    .object({
      maxLoops: z.number().int().min(0).max(12).optional(),
      maxStepExecutions: z.number().int().min(4).max(120).optional(),
      stageTimeoutMs: z.number().int().min(10000).max(1200000).optional()
    })
    .partial()
    .optional(),
  steps: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        role: z.enum(["analysis", "planner", "orchestrator", "executor", "tester", "review"]).optional(),
        prompt: z.string().min(1).max(8000).optional(),
        enableDelegation: z.boolean().optional(),
        delegationCount: z.number().int().min(1).max(8).optional(),
        enableIsolatedStorage: z.boolean().optional(),
        enableSharedStorage: z.boolean().optional(),
        enabledMcpServerIds: z.array(z.string().min(1)).max(16).optional(),
        outputFormat: z.enum(["markdown", "json"]).optional(),
        requiredOutputFields: z.array(z.string().min(1)).max(40).optional(),
        requiredOutputFiles: z.array(z.string().min(1)).max(40).optional()
      })
    )
    .min(1)
    .max(18),
  links: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        condition: z.enum(["always", "on_pass", "on_fail"]).optional()
      })
    )
    .optional(),
  qualityGates: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        target: z.string().min(1).optional(),
        kind: z.enum(["regex_must_match", "regex_must_not_match", "json_field_exists", "artifact_exists"]),
        blocking: z.boolean().optional(),
        pattern: z.string().max(2000).optional(),
        flags: z.string().max(12).optional(),
        jsonPath: z.string().max(2000).optional(),
        artifactPath: z.string().max(4000).optional(),
        message: z.string().max(2000).optional()
      })
    )
    .max(80)
    .optional()
});

const flowDecisionSchema = z.object({
  action: z.enum(["answer", "update_current_flow", "replace_flow"]),
  message: z.string().min(1).max(6000),
  flow: generatedFlowSchema.optional()
});

type GeneratedFlowSpec = z.infer<typeof generatedFlowSchema>;
type FlowDecision = z.infer<typeof flowDecisionSchema>;

const defaultRolePrompts: Record<AgentRole, string> = {
  analysis: "Analyze the request, constraints, and acceptance criteria. Produce structured inputs for downstream steps.",
  planner: "Turn requirements into an execution plan with concrete stage outputs and dependencies.",
  orchestrator:
    "Act as main orchestrator. Route work to connected agents, enforce quality gates, and drive pass/fail remediation loops.",
  executor: "Execute implementation tasks and produce concrete artifacts for the next stage.",
  tester: "Run validation and detect defects or regressions before approval.",
  review:
    "Review quality against requirements and output WORKFLOW_STATUS: PASS or WORKFLOW_STATUS: FAIL with actionable issues."
};

const defaultRuntime = {
  maxLoops: 2,
  maxStepExecutions: 18,
  stageTimeoutMs: 240000
};

const defaultContextTemplate =
  "Task:\n{{task}}\n\nAttempt:\n{{attempt}}\n\nIncoming outputs:\n{{incoming_outputs}}\n\nAll outputs:\n{{all_outputs}}";

const maxHistoryMessages = 16;
const maxHistoryCharsPerMessage = 1400;

function normalizeRuntime(runtime: Partial<typeof defaultRuntime> | undefined): typeof defaultRuntime {
  return {
    maxLoops:
      typeof runtime?.maxLoops === "number" ? Math.max(0, Math.min(12, Math.floor(runtime.maxLoops))) : defaultRuntime.maxLoops,
    maxStepExecutions:
      typeof runtime?.maxStepExecutions === "number"
        ? Math.max(4, Math.min(120, Math.floor(runtime.maxStepExecutions)))
        : defaultRuntime.maxStepExecutions,
    stageTimeoutMs:
      typeof runtime?.stageTimeoutMs === "number"
        ? Math.max(10000, Math.min(1200000, Math.floor(runtime.stageTimeoutMs)))
        : defaultRuntime.stageTimeoutMs
  };
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}\n...[truncated due to length]`;
}

function normalizeRole(value: unknown): AgentRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "analysis") return "analysis";
  if (normalized === "planner") return "planner";
  if (normalized === "orchestrator") return "orchestrator";
  if (normalized === "executor") return "executor";
  if (normalized === "tester") return "tester";
  if (normalized === "review") return "review";

  if (normalized === "reviewer" || normalized === "qa" || normalized === "validator") return "review";
  if (normalized === "implementer" || normalized === "builder") return "executor";
  if (normalized === "coordinator" || normalized === "manager") return "orchestrator";
  if (normalized === "test") return "tester";

  return undefined;
}

function normalizeCondition(value: unknown): LinkCondition | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "always") return "always";
  if (normalized === "on_pass" || normalized === "pass" || normalized === "success" || normalized === "on_success") {
    return "on_pass";
  }
  if (normalized === "on_fail" || normalized === "fail" || normalized === "failure" || normalized === "on_error") {
    return "on_fail";
  }

  return undefined;
}

function normalizeQualityGateKind(value: unknown): QualityGateKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "regex_must_match" || normalized === "must_match" || normalized === "regex_match") {
    return "regex_must_match";
  }

  if (normalized === "regex_must_not_match" || normalized === "must_not_match" || normalized === "regex_block") {
    return "regex_must_not_match";
  }

  if (normalized === "json_field_exists" || normalized === "json_path_exists" || normalized === "field_exists") {
    return "json_field_exists";
  }

  if (normalized === "artifact_exists" || normalized === "file_exists" || normalized === "path_exists") {
    return "artifact_exists";
  }

  return undefined;
}

function normalizeStringArray(value: unknown, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, maxLength);

  return normalized.length > 0 ? normalized : [];
}

function normalizeAction(value: unknown): FlowBuilderAction | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (
    normalized === "answer" ||
    normalized === "reply" ||
    normalized === "qa" ||
    normalized === "question" ||
    normalized === "analysis" ||
    normalized === "chat"
  ) {
    return "answer";
  }

  if (
    normalized === "update_current_flow" ||
    normalized === "update_current" ||
    normalized === "update" ||
    normalized === "edit" ||
    normalized === "modify" ||
    normalized === "patch" ||
    normalized === "refine"
  ) {
    return "update_current_flow";
  }

  if (
    normalized === "replace_flow" ||
    normalized === "replace" ||
    normalized === "rebuild" ||
    normalized === "new" ||
    normalized === "new_flow" ||
    normalized === "create_new" ||
    normalized === "recreate" ||
    normalized === "from_scratch"
  ) {
    return "replace_flow";
  }

  return undefined;
}

function sanitizeJsonCandidate(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}

function removeTrailingCommas(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookAhead = index + 1;
      while (lookAhead < value.length && /\s/.test(value[lookAhead])) {
        lookAhead += 1;
      }

      const nextChar = value[lookAhead];
      if (nextChar === "}" || nextChar === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function stripJsonComments(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < value.length && value[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < value.length && !(value[index] === "*" && value[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function quoteUnquotedKeys(value: string): string {
  return value.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, "$1\"$2\"$3");
}

function convertSingleQuotedStrings(value: string): string {
  return value.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => {
    const escaped = inner.replace(/"/g, "\\\"");
    return `"${escaped}"`;
  });
}

function normalizePythonJsonLiterals(value: string): string {
  return value
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function normalizeGeneratedFlow(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const normalized: Record<string, unknown> = {
    name: typeof raw.name === "string" ? raw.name.trim() : raw.name,
    description: typeof raw.description === "string" ? raw.description.trim() : raw.description
  };

  if (isRecord(raw.runtime)) {
    normalized.runtime = {
      maxLoops: typeof raw.runtime.maxLoops === "number" ? raw.runtime.maxLoops : undefined,
      maxStepExecutions: typeof raw.runtime.maxStepExecutions === "number" ? raw.runtime.maxStepExecutions : undefined,
      stageTimeoutMs: typeof raw.runtime.stageTimeoutMs === "number" ? raw.runtime.stageTimeoutMs : undefined
    };
  } else if (raw.runtime !== undefined) {
    normalized.runtime = raw.runtime;
  }

  if (Array.isArray(raw.steps)) {
    const seenNames = new Set<string>();
    normalized.steps = raw.steps
      .map((step, index) => {
        if (!isRecord(step)) {
          return null;
        }

        const baseName = typeof step.name === "string" && step.name.trim().length > 0 ? step.name.trim() : `Step ${index + 1}`;
        let name = baseName;
        let suffix = 2;

        while (seenNames.has(normalizeRef(name))) {
          name = `${baseName} ${suffix}`;
          suffix += 1;
        }
        seenNames.add(normalizeRef(name));

        const prompt = typeof step.prompt === "string" ? step.prompt.trim() : undefined;
        const delegationCount = typeof step.delegationCount === "number" ? Math.floor(step.delegationCount) : undefined;

        return {
          name,
          role: normalizeRole(step.role),
          prompt: prompt && prompt.length > 0 ? prompt : undefined,
          enableDelegation: typeof step.enableDelegation === "boolean" ? step.enableDelegation : undefined,
          delegationCount,
          enableIsolatedStorage: typeof step.enableIsolatedStorage === "boolean" ? step.enableIsolatedStorage : undefined,
          enableSharedStorage: typeof step.enableSharedStorage === "boolean" ? step.enableSharedStorage : undefined,
          enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
            ? step.enabledMcpServerIds
                .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                .map((entry) => entry.trim())
                .slice(0, 16)
            : undefined,
          outputFormat: step.outputFormat === "json" ? "json" : step.outputFormat === "markdown" ? "markdown" : undefined,
          requiredOutputFields: normalizeStringArray(step.requiredOutputFields, 40),
          requiredOutputFiles: normalizeStringArray(step.requiredOutputFiles, 40)
        };
      })
      .filter((step): step is NonNullable<typeof step> => step !== null);
  } else if (raw.steps !== undefined) {
    normalized.steps = raw.steps;
  }

  if (Array.isArray(raw.links)) {
    normalized.links = raw.links
      .map((link) => {
        if (!isRecord(link)) {
          return null;
        }

        const source = typeof link.source === "string" ? link.source.trim() : "";
        const target = typeof link.target === "string" ? link.target.trim() : "";
        if (source.length === 0 || target.length === 0) {
          return null;
        }

        return {
          source,
          target,
          condition: normalizeCondition(link.condition)
        };
      })
      .filter((link): link is NonNullable<typeof link> => link !== null);
  } else if (raw.links !== undefined) {
    normalized.links = raw.links;
  }

  if (Array.isArray(raw.qualityGates)) {
    normalized.qualityGates = raw.qualityGates
      .map((gate) => {
        if (!isRecord(gate)) {
          return null;
        }

        const name = typeof gate.name === "string" ? gate.name.trim() : "";
        if (name.length === 0) {
          return null;
        }

        return {
          name,
          target: typeof gate.target === "string" && gate.target.trim().length > 0 ? gate.target.trim() : undefined,
          kind: normalizeQualityGateKind(gate.kind),
          blocking: typeof gate.blocking === "boolean" ? gate.blocking : undefined,
          pattern: typeof gate.pattern === "string" ? gate.pattern : undefined,
          flags: typeof gate.flags === "string" ? gate.flags : undefined,
          jsonPath: typeof gate.jsonPath === "string" ? gate.jsonPath : undefined,
          artifactPath: typeof gate.artifactPath === "string" ? gate.artifactPath : undefined,
          message: typeof gate.message === "string" ? gate.message : undefined
        };
      })
      .filter((gate): gate is NonNullable<typeof gate> => gate !== null);
  } else if (raw.qualityGates !== undefined) {
    normalized.qualityGates = raw.qualityGates;
  }

  return normalized;
}

function normalizeFlowDecision(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const messageValue =
    typeof raw.message === "string"
      ? raw.message
      : typeof raw.reply === "string"
        ? raw.reply
        : typeof raw.response === "string"
          ? raw.response
          : raw.answer;

  const flowValue =
    raw.flow ??
    raw.workflow ??
    raw.graph ??
    (isRecord(raw.result) ? raw.result.flow ?? raw.result.workflow : undefined);

  const normalized: Record<string, unknown> = {
    action: normalizeAction(raw.action ?? raw.intent ?? raw.mode ?? raw.type),
    message: typeof messageValue === "string" ? messageValue.trim() : messageValue
  };

  if (flowValue !== undefined) {
    normalized.flow = normalizeGeneratedFlow(flowValue);
  }

  return normalized;
}

function collectJsonCandidates(rawOutput: string): string[] {
  const candidates = new Set<string>();
  const addCandidate = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }

    const normalized = sanitizeJsonCandidate(candidate);
    if (normalized.length > 0) {
      candidates.add(normalized);
    }
  };

  addCandidate(rawOutput);

  const fenced = [...rawOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of fenced) {
    addCandidate(block[1]);
  }

  addCandidate(extractFirstJsonObject(rawOutput));

  const initial = [...candidates];
  for (const candidate of initial) {
    const noComments = stripJsonComments(candidate);
    addCandidate(noComments);
    addCandidate(removeTrailingCommas(noComments));
    addCandidate(quoteUnquotedKeys(noComments));
    addCandidate(convertSingleQuotedStrings(noComments));
    addCandidate(normalizePythonJsonLiterals(noComments));
    addCandidate(removeTrailingCommas(quoteUnquotedKeys(noComments)));
    addCandidate(removeTrailingCommas(convertSingleQuotedStrings(noComments)));
    addCandidate(removeTrailingCommas(normalizePythonJsonLiterals(noComments)));

    const extracted = extractFirstJsonObject(noComments);
    addCandidate(extracted);
    addCandidate(extracted ? removeTrailingCommas(extracted) : null);
    addCandidate(extracted ? quoteUnquotedKeys(extracted) : null);
    addCandidate(extracted ? convertSingleQuotedStrings(extracted) : null);
    addCandidate(extracted ? normalizePythonJsonLiterals(extracted) : null);
    addCandidate(extracted ? removeTrailingCommas(quoteUnquotedKeys(extracted)) : null);
    addCandidate(extracted ? removeTrailingCommas(convertSingleQuotedStrings(extracted)) : null);
    addCandidate(extracted ? removeTrailingCommas(normalizePythonJsonLiterals(extracted)) : null);
  }

  return [...candidates];
}

function parseGeneratedFlow(rawOutput: string): GeneratedFlowSpec | null {
  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = generatedFlowSchema.safeParse(normalizeGeneratedFlow(parsed));
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // Continue trying other candidates.
    }
  }

  return null;
}

function parseFlowDecision(rawOutput: string): FlowDecision | null {
  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = flowDecisionSchema.safeParse(normalizeFlowDecision(parsed));
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // Continue trying other candidates.
    }
  }

  return null;
}

function isSimulatedProviderOutput(rawOutput: string): boolean {
  return rawOutput.trimStart().startsWith("[Simulated ");
}

function fallbackSpec(prompt: string): GeneratedFlowSpec {
  const input = prompt.toLowerCase();
  const includesFigma = input.includes("figma");
  const includesHtml = input.includes("html");
  const includesPdf = input.includes("pdf");
  const disableOrchestrator =
    input.includes("without orchestrator") || input.includes("no orchestrator") || input.includes("without an orchestrator");
  const includeOrchestrator = !disableOrchestrator && (input.includes("orchestrator") || input.includes("loop"));

  if (includesFigma && includesHtml && includesPdf) {
    const steps = [
      ...(includeOrchestrator ? [{ name: "Main Orchestrator", role: "orchestrator" as const, outputFormat: "markdown" as const }] : []),
      { name: "Figma Extraction / UI Kit", role: "analysis" as const, outputFormat: "json" as const },
      { name: "HTML Builder", role: "executor" as const, outputFormat: "markdown" as const },
      {
        name: "HTML Reviewer",
        role: "review" as const,
        outputFormat: "json" as const,
        requiredOutputFields: ["status", "blockingIssues"]
      },
      { name: "PDF Renderer", role: "executor" as const, outputFormat: "markdown" as const },
      {
        name: "PDF Reviewer",
        role: "review" as const,
        outputFormat: "json" as const,
        requiredOutputFields: ["status", "blockingIssues"]
      },
      { name: "Delivery / QA Report", role: "review" as const, outputFormat: "markdown" as const }
    ];

    const root = includeOrchestrator ? "Main Orchestrator" : "Figma Extraction / UI Kit";
    return {
      name: "Investor Deck Pipeline",
      description: "Figma -> HTML -> PDF with independent verification and remediation loops.",
      runtime: {
        maxLoops: 3,
        maxStepExecutions: 30,
        stageTimeoutMs: 300000
      },
      steps,
      links: [
        ...(includeOrchestrator ? [{ source: "Main Orchestrator", target: "Figma Extraction / UI Kit", condition: "always" as const }] : []),
        { source: root, target: "HTML Builder", condition: "always" },
        { source: "HTML Builder", target: "HTML Reviewer", condition: "always" },
        { source: "HTML Reviewer", target: "HTML Builder", condition: "on_fail" },
        { source: "HTML Reviewer", target: "PDF Renderer", condition: "on_pass" },
        { source: "PDF Renderer", target: "PDF Reviewer", condition: "always" },
        { source: "PDF Reviewer", target: "HTML Builder", condition: "on_fail" },
        { source: "PDF Reviewer", target: "Delivery / QA Report", condition: "on_pass" }
      ],
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
    ...(includeOrchestrator ? [{ name: "Main Orchestrator", role: "orchestrator" as const }] : []),
    { name: "Analysis", role: "analysis" as const, outputFormat: "markdown" as const },
    { name: "Planner", role: "planner" as const, outputFormat: "markdown" as const },
    { name: "Executor", role: "executor" as const, outputFormat: "markdown" as const },
    { name: "Tester", role: "tester" as const, outputFormat: "markdown" as const },
    { name: "Reviewer", role: "review" as const, outputFormat: "markdown" as const }
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

function defaultDelegationCount(role: AgentRole): number {
  if (role === "orchestrator") return 3;
  if (role === "executor") return 2;
  return 1;
}

function clampDelegationCount(value: number): number {
  return Math.max(1, Math.min(8, Math.floor(value)));
}

function buildLinks(spec: GeneratedFlowSpec, stepRecords: PipelineInput["steps"]): PipelineInput["links"] {
  const idByName = new Map(
    stepRecords
      .filter((step): step is PipelineInput["steps"][number] & { id: string } => typeof step.id === "string" && step.id.length > 0)
      .map((step) => [normalizeRef(step.name), step.id])
  );
  const links: PipelineInput["links"] = [];
  const seen = new Set<string>();

  for (const link of spec.links ?? []) {
    const sourceId = idByName.get(normalizeRef(link.source));
    const targetId = idByName.get(normalizeRef(link.target));

    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }

    const condition: LinkCondition = link.condition ?? "always";
    const dedupeKey = `${sourceId}->${targetId}:${condition}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    links.push({
      id: nanoid(),
      sourceStepId: sourceId,
      targetStepId: targetId,
      condition
    });
  }

  if (links.length === 0 && stepRecords.length > 1) {
    for (let index = 0; index < stepRecords.length - 1; index += 1) {
      const sourceStepId = stepRecords[index].id;
      const targetStepId = stepRecords[index + 1].id;
      if (typeof sourceStepId !== "string" || sourceStepId.length === 0) {
        continue;
      }
      if (typeof targetStepId !== "string" || targetStepId.length === 0) {
        continue;
      }

      links.push({
        id: nanoid(),
        sourceStepId,
        targetStepId,
        condition: "always"
      });
    }
  }

  return links;
}

function buildQualityGates(
  spec: GeneratedFlowSpec,
  stepRecords: PipelineInput["steps"]
): PipelineInput["qualityGates"] {
  if (!Array.isArray(spec.qualityGates) || spec.qualityGates.length === 0) {
    return [];
  }

  const idByName = new Map(
    stepRecords
      .filter((step): step is PipelineInput["steps"][number] & { id: string } => typeof step.id === "string" && step.id.length > 0)
      .map((step) => [normalizeRef(step.name), step.id])
  );
  const seen = new Set<string>();
  const gates: NonNullable<PipelineInput["qualityGates"]> = [];

  for (const gate of spec.qualityGates) {
    const targetStepId =
      typeof gate.target === "string" && gate.target.trim().length > 0
        ? idByName.get(normalizeRef(gate.target)) ?? "any_step"
        : "any_step";

    const normalized = {
      id: nanoid(),
      name: gate.name.trim(),
      targetStepId,
      kind: gate.kind,
      blocking: gate.blocking !== false,
      pattern: gate.pattern?.trim() ?? "",
      flags: gate.flags?.trim() ?? "",
      jsonPath: gate.jsonPath?.trim() ?? "",
      artifactPath: gate.artifactPath?.trim() ?? "",
      message: gate.message?.trim() ?? ""
    } satisfies NonNullable<PipelineInput["qualityGates"]>[number];

    const dedupeKey = `${normalized.name.toLowerCase()}|${normalized.kind}|${normalized.targetStepId}|${normalized.pattern}|${normalized.jsonPath}|${normalized.artifactPath}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    gates.push(normalized);
  }

  return gates.slice(0, 80);
}

function buildFlowDraft(spec: GeneratedFlowSpec, request: FlowBuilderRequest): PipelineInput {
  const reasoningEffort = resolveReasoning(request.providerId, request.reasoningEffort, request.model, "medium");
  const baseContext = resolveDefaultContextWindow(request.providerId, request.model);
  const use1MContext = request.providerId === "claude" && request.use1MContext === true;
  const contextWindowTokens = use1MContext ? Math.max(baseContext, 1_000_000) : baseContext;
  const fastMode = request.providerId === "claude" ? request.fastMode === true : false;
  const runtime = normalizeRuntime(spec.runtime);

  const stepRecords: PipelineInput["steps"] = spec.steps.map((step, index) => {
    const role = step.role ?? (index === 0 ? "analysis" : "executor");
    const row = Math.floor(index / 4);
    const col = index % 4;

    return {
      id: nanoid(),
      name: step.name,
      role,
      prompt: step.prompt?.trim() || defaultRolePrompts[role],
      providerId: request.providerId,
      model: request.model,
      reasoningEffort,
      fastMode,
      use1MContext,
      contextWindowTokens,
      position: {
        x: 80 + col * 280,
        y: 120 + row * 180
      },
      contextTemplate: defaultContextTemplate,
      enableDelegation:
        typeof step.enableDelegation === "boolean" ? step.enableDelegation : role === "executor" || role === "orchestrator",
      delegationCount:
        typeof step.delegationCount === "number" ? clampDelegationCount(step.delegationCount) : defaultDelegationCount(role),
      enableIsolatedStorage:
        typeof step.enableIsolatedStorage === "boolean"
          ? step.enableIsolatedStorage
          : role === "orchestrator" || role === "executor",
      enableSharedStorage:
        typeof step.enableSharedStorage === "boolean"
          ? step.enableSharedStorage
          : role === "orchestrator" || role === "executor" || role === "review",
      enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
        ? step.enabledMcpServerIds
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .slice(0, 16)
        : [],
      outputFormat: step.outputFormat === "json" ? "json" : "markdown",
      requiredOutputFields: normalizeStringArray(step.requiredOutputFields, 40) ?? [],
      requiredOutputFiles: normalizeStringArray(step.requiredOutputFiles, 40) ?? []
    };
  });

  return {
    name: spec.name?.trim() || "Generated Agent Flow",
    description: spec.description?.trim() || "AI-generated workflow graph.",
    steps: stepRecords,
    links: buildLinks(spec, stepRecords),
    qualityGates: buildQualityGates(spec, stepRecords),
    runtime
  };
}

function buildFlowDraftFromExisting(spec: GeneratedFlowSpec, request: FlowBuilderRequest, currentDraft: PipelineInput): PipelineInput {
  const existingByName = new Map<string, PipelineInput["steps"][number]>();
  for (const step of currentDraft.steps) {
    const key = normalizeRef(step.name);
    if (!existingByName.has(key)) {
      existingByName.set(key, step);
    }
  }

  const stepRecords: PipelineInput["steps"] = spec.steps.map((step, index) => {
    const existing = existingByName.get(normalizeRef(step.name));
    const role = step.role ?? existing?.role ?? (index === 0 ? "analysis" : "executor");

    const providerId =
      existing?.providerId === "openai" || existing?.providerId === "claude" ? existing.providerId : request.providerId;

    const model =
      typeof existing?.model === "string" && existing.model.trim().length > 0 ? existing.model : request.model;

    const reasoningEffort = resolveReasoning(providerId, existing?.reasoningEffort ?? request.reasoningEffort, model, "medium");
    const baseContext = resolveDefaultContextWindow(providerId, model);

    const use1MContext =
      providerId === "claude"
        ? typeof existing?.use1MContext === "boolean"
          ? existing.use1MContext
          : request.use1MContext === true
        : false;

    const fastMode =
      providerId === "claude"
        ? typeof existing?.fastMode === "boolean"
          ? existing.fastMode
          : request.fastMode === true
        : false;

    const existingContextWindow =
      typeof existing?.contextWindowTokens === "number" && Number.isFinite(existing.contextWindowTokens)
        ? Math.floor(existing.contextWindowTokens)
        : undefined;

    const contextWindowTokens =
      existingContextWindow && existingContextWindow > 0
        ? existingContextWindow
        : use1MContext
          ? Math.max(baseContext, 1_000_000)
          : baseContext;

    const row = Math.floor(index / 4);
    const col = index % 4;

    const position =
      existing?.position &&
      typeof existing.position.x === "number" &&
      Number.isFinite(existing.position.x) &&
      typeof existing.position.y === "number" &&
      Number.isFinite(existing.position.y)
        ? existing.position
        : {
            x: 80 + col * 280,
            y: 120 + row * 180
          };

    const delegationCount =
      typeof step.delegationCount === "number"
        ? clampDelegationCount(step.delegationCount)
        : typeof existing?.delegationCount === "number" && Number.isFinite(existing.delegationCount)
          ? clampDelegationCount(existing.delegationCount)
          : defaultDelegationCount(role);

    return {
      id: typeof existing?.id === "string" && existing.id.trim().length > 0 ? existing.id : nanoid(),
      name: step.name,
      role,
      prompt: step.prompt?.trim() || existing?.prompt || defaultRolePrompts[role],
      providerId,
      model,
      reasoningEffort,
      fastMode,
      use1MContext,
      contextWindowTokens,
      position,
      contextTemplate:
        typeof existing?.contextTemplate === "string" && existing.contextTemplate.trim().length > 0
          ? existing.contextTemplate
          : defaultContextTemplate,
      enableDelegation:
        typeof step.enableDelegation === "boolean"
          ? step.enableDelegation
          : typeof existing?.enableDelegation === "boolean"
            ? existing.enableDelegation
            : role === "executor" || role === "orchestrator",
      delegationCount,
      enableIsolatedStorage:
        typeof step.enableIsolatedStorage === "boolean"
          ? step.enableIsolatedStorage
          : typeof existing?.enableIsolatedStorage === "boolean"
            ? existing.enableIsolatedStorage
            : role === "orchestrator" || role === "executor",
      enableSharedStorage:
        typeof step.enableSharedStorage === "boolean"
          ? step.enableSharedStorage
          : typeof existing?.enableSharedStorage === "boolean"
            ? existing.enableSharedStorage
            : role === "orchestrator" || role === "executor" || role === "review",
      enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
        ? step.enabledMcpServerIds
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .slice(0, 16)
        : Array.isArray(existing?.enabledMcpServerIds)
          ? existing.enabledMcpServerIds
              .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
              .map((entry) => entry.trim())
              .slice(0, 16)
          : [],
      outputFormat:
        step.outputFormat === "json"
          ? "json"
          : step.outputFormat === "markdown"
            ? "markdown"
            : existing?.outputFormat === "json"
              ? "json"
              : "markdown",
      requiredOutputFields:
        normalizeStringArray(step.requiredOutputFields, 40) ??
        (Array.isArray(existing?.requiredOutputFields) ? existing.requiredOutputFields.slice(0, 40) : []),
      requiredOutputFiles:
        normalizeStringArray(step.requiredOutputFiles, 40) ??
        (Array.isArray(existing?.requiredOutputFiles) ? existing.requiredOutputFiles.slice(0, 40) : [])
    };
  });

  return {
    name: spec.name?.trim() || currentDraft.name || "Generated Agent Flow",
    description: spec.description?.trim() || currentDraft.description || "AI-generated workflow graph.",
    steps: stepRecords,
    links: buildLinks(spec, stepRecords),
    qualityGates:
      Array.isArray(spec.qualityGates) && spec.qualityGates.length > 0
        ? buildQualityGates(spec, stepRecords)
        : Array.isArray(currentDraft.qualityGates)
          ? currentDraft.qualityGates
          : [],
    runtime: normalizeRuntime(spec.runtime ?? currentDraft.runtime)
  };
}

function summarizeCurrentDraft(currentDraft: PipelineInput | undefined): string {
  if (!currentDraft) {
    return "No current flow is loaded in the editor.";
  }

  const nameById = new Map(currentDraft.steps.map((step) => [step.id, step.name]));
  const summary = {
    name: currentDraft.name,
    description: currentDraft.description,
    runtime: normalizeRuntime(currentDraft.runtime),
    steps: currentDraft.steps.map((step) => ({
      name: step.name,
      role: step.role,
      prompt: clip(step.prompt, 320),
      enableDelegation: step.enableDelegation,
      delegationCount: step.delegationCount,
      outputFormat: step.outputFormat,
      requiredOutputFields: step.requiredOutputFields,
      requiredOutputFiles: step.requiredOutputFiles
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
      blocking: gate.blocking
    }))
  };

  return clip(JSON.stringify(summary, null, 2), 22000);
}

function normalizeHistory(history: FlowChatMessage[] | undefined, prompt: string): FlowChatMessage[] {
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

  return sanitized.slice(-maxHistoryMessages);
}

function formatHistoryForContext(history: FlowChatMessage[]): string {
  if (history.length === 0) {
    return "No prior conversation.";
  }

  return history.map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function buildPlannerContext(prompt: string): string {
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
    '  "runtime": { "maxLoops": 2, "maxStepExecutions": 18, "stageTimeoutMs": 240000 },',
    '  "steps": [',
    '    { "name": "Main Orchestrator", "role": "orchestrator", "prompt": "...", "outputFormat": "markdown" },',
    '    { "name": "Builder", "role": "executor", "prompt": "...", "outputFormat": "json", "requiredOutputFields": ["status", "artifacts.html"] }',
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
    "- Keep step names unique.",
    "- Each step must have a concise actionable prompt.",
    "- Prefer orchestrator for multi-stage complex pipelines unless explicitly not requested.",
    "- Parameterize runtime-specific values via placeholders like {{input.source_pdf_path}} instead of hardcoding secrets/paths.",
    "",
    "User request:",
    prompt.trim()
  ].join("\n");
}

function buildJsonRepairContext(rawOutput: string): string {
  const clipped = clip(rawOutput, 24000);

  return [
    "Repair the model output below into STRICT JSON for the workflow schema.",
    "Return JSON only. No markdown. No explanation.",
    "",
    "Rules:",
    "- Keep original intent and step ordering whenever possible.",
    "- Ensure fields are valid for this schema.",
    "- Roles allowed: analysis, planner, orchestrator, executor, tester, review.",
    "- Link conditions allowed: always, on_pass, on_fail.",
    "- If a field is unknown, omit it instead of inventing unsupported fields.",
    "",
    "Expected shape:",
    "{",
    '  "name": "Flow name",',
    '  "description": "One sentence",',
    '  "runtime": { "maxLoops": 2, "maxStepExecutions": 18, "stageTimeoutMs": 240000 },',
    '  "steps": [',
    '    { "name": "Main Orchestrator", "role": "orchestrator", "prompt": "...", "outputFormat": "markdown" }',
    "  ],",
    '  "links": [',
    '    { "source": "Main Orchestrator", "target": "Builder", "condition": "always" }',
    "  ],",
    '  "qualityGates": [',
    '    { "name": "Required gate", "kind": "regex_must_match", "target": "any_step", "pattern": "WORKFLOW_STATUS" }',
    "  ]",
    "}",
    "",
    "Input to repair:",
    clipped
  ].join("\n");
}

function buildPlannerRegenerationContext(prompt: string, rawOutput: string, repairedOutput?: string): string {
  const rawClip = clip(rawOutput, 12000);
  const repairedClip = repairedOutput ? clip(repairedOutput, 12000) : "";

  return [
    buildPlannerContext(prompt),
    "",
    "Previous output was invalid JSON. Regenerate the FULL response now.",
    "Return one JSON object only. No markdown. No comments.",
    "",
    "Invalid previous output:",
    rawClip,
    ...(repairedClip.length > 0 ? ["", "Invalid repair attempt:", repairedClip] : [])
  ].join("\n");
}

function buildChatPlannerContext(request: FlowBuilderRequest): string {
  const normalizedHistory = normalizeHistory(request.history, request.prompt);

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
    '  "flow": {',
    '    "name": "Flow name",',
    '    "description": "One sentence",',
    '    "runtime": { "maxLoops": 2, "maxStepExecutions": 18, "stageTimeoutMs": 240000 },',
    '    "steps": [',
    '      { "name": "Main Orchestrator", "role": "orchestrator", "prompt": "...", "outputFormat": "markdown" }',
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
    "- For update_current_flow, return the full updated flow result in flow (not a patch).",
    "- Preserve existing structure unless user asks for broader changes.",
    "- Use replace_flow only when the user explicitly asks for a new/rebuilt flow.",
    "- flow must be omitted when action=answer.",
    "- Parameterize runtime-specific values via placeholders like {{input.output_dir}} and {{input.figma_links}}.",
    "",
    "Current flow snapshot:",
    summarizeCurrentDraft(request.currentDraft),
    "",
    "Conversation history (oldest first):",
    formatHistoryForContext(normalizedHistory)
  ].join("\n");
}

function buildChatRepairContext(rawOutput: string): string {
  const clipped = clip(rawOutput, 24000);

  return [
    "Repair the output below into STRICT JSON for the copilot schema.",
    "Return JSON only. No markdown. No explanation.",
    "",
    "Expected shape:",
    "{",
    '  "action": "answer | update_current_flow | replace_flow",',
    '  "message": "assistant response",',
    '  "flow": { "name": "...", "description": "...", "steps": [...], "links": [...], "qualityGates": [...] }',
    "}",
    "",
    "Rules:",
    "- action must be one of answer, update_current_flow, replace_flow.",
    "- Include flow only for update_current_flow or replace_flow.",
    "- Ensure flow fields match allowed roles and link conditions.",
    "- Preserve any {{input.<key>}} placeholders and do not convert them into literals.",
    "",
    "Input to repair:",
    clipped
  ].join("\n");
}

function buildChatRegenerationContext(
  request: FlowBuilderRequest,
  rawOutput: string,
  repairedOutput?: string
): string {
  const rawClip = clip(rawOutput, 12000);
  const repairedClip = repairedOutput ? clip(repairedOutput, 12000) : "";

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

function createGeneratorStep(
  request: FlowBuilderRequest,
  name: string,
  prompt: string
): PipelineStep {
  const use1MContext = request.providerId === "claude" && request.use1MContext === true;
  const baseContext = resolveDefaultContextWindow(request.providerId, request.model);

  return {
    id: nanoid(),
    name,
    role: "planner",
    prompt,
    providerId: request.providerId,
    model: request.model,
    reasoningEffort: resolveReasoning(request.providerId, request.reasoningEffort, request.model, "medium"),
    fastMode: request.providerId === "claude" ? request.fastMode === true : false,
    use1MContext,
    contextWindowTokens: use1MContext ? Math.max(baseContext, 1_000_000) : baseContext,
    position: { x: 80, y: 120 },
    contextTemplate: "Task:\n{{task}}\n\nContext:\n{{previous_output}}",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: []
  };
}

interface DraftOnlyResult {
  draft: PipelineInput;
  source: "model" | "fallback";
  notes: string[];
  rawOutput?: string;
}

function isReplaceIntent(prompt: string): boolean {
  const input = prompt.toLowerCase();
  return (
    input.includes("replace flow") ||
    input.includes("replace this flow") ||
    input.includes("from scratch") ||
    input.includes("start over") ||
    input.includes("brand new") ||
    input.includes("recreate") ||
    input.includes("new flow")
  );
}

function isMutationIntent(prompt: string): boolean {
  const input = prompt.toLowerCase();
  return (
    input.includes("build") ||
    input.includes("create") ||
    input.includes("generate") ||
    input.includes("make") ||
    input.includes("update") ||
    input.includes("modify") ||
    input.includes("change") ||
    input.includes("edit") ||
    input.includes("add") ||
    input.includes("remove") ||
    input.includes("delete") ||
    input.includes("rework") ||
    isReplaceIntent(prompt)
  );
}

function defaultMessageForAction(action: FlowBuilderAction, draft?: PipelineInput): string {
  if (action === "answer") {
    return "Answered without changing the current flow.";
  }

  if (!draft) {
    return action === "update_current_flow" ? "Updated the current flow." : "Created a new flow.";
  }

  if (action === "update_current_flow") {
    return `Updated current flow: ${draft.steps.length} step(s), ${(draft.links ?? []).length} link(s).`;
  }

  return `Created a new flow: ${draft.steps.length} step(s), ${(draft.links ?? []).length} link(s).`;
}

function buildDraftForAction(
  action: FlowBuilderAction,
  spec: GeneratedFlowSpec,
  request: FlowBuilderRequest
): { action: FlowBuilderAction; draft?: PipelineInput; notes: string[] } {
  if (action === "answer") {
    return { action, draft: undefined, notes: [] };
  }

  if (action === "update_current_flow") {
    if (request.currentDraft) {
      return {
        action,
        draft: buildFlowDraftFromExisting(spec, request, request.currentDraft),
        notes: []
      };
    }

    return {
      action: "replace_flow",
      draft: buildFlowDraft(spec, request),
      notes: ["No current flow was loaded, so update_current_flow was treated as replace_flow."]
    };
  }

  return {
    action,
    draft: buildFlowDraft(spec, request),
    notes: []
  };
}

async function generateDraftOnly(
  request: FlowBuilderRequest,
  provider: ProviderConfig
): Promise<DraftOnlyResult> {
  const generatorStep = createGeneratorStep(
    request,
    "AI Flow Architect",
    "You are a workflow architect. Output strict JSON that defines an agent graph with steps and links for the requested flow."
  );

  const rawOutput = await executeProviderStep({
    provider,
    step: generatorStep,
    task: "Generate an agent workflow graph",
    context: buildPlannerContext(request.prompt),
    outputMode: "json"
  });

  if (isSimulatedProviderOutput(rawOutput)) {
    throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
  }

  const parsed = parseGeneratedFlow(rawOutput);
  if (parsed) {
    return {
      draft: buildFlowDraft(parsed, request),
      source: "model",
      notes: ["Generated from selected AI model."]
    };
  }

  let repairedOutput: string | undefined;
  let regeneratedOutput: string | undefined;
  try {
    repairedOutput = await executeProviderStep({
      provider,
      step: {
        ...generatorStep,
        id: nanoid(),
        name: "AI Flow JSON Repair",
        prompt:
          "You are a JSON repair assistant. Convert the provided content into strict workflow JSON with no markdown."
      },
      task: "Repair workflow JSON",
      context: buildJsonRepairContext(rawOutput),
      outputMode: "json"
    });

    if (isSimulatedProviderOutput(repairedOutput)) {
      throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
    }

    const repaired = parseGeneratedFlow(repairedOutput);
    if (repaired) {
      return {
        draft: buildFlowDraft(repaired, request),
        source: "model",
        notes: ["Generated from selected AI model.", "Applied JSON repair pass before building the flow."]
      };
    }
  } catch {
    // Continue to deterministic fallback.
  }

  try {
    regeneratedOutput = await executeProviderStep({
      provider,
      step: {
        ...generatorStep,
        id: nanoid(),
        name: "AI Flow JSON Regeneration",
        prompt: "Generate strict workflow JSON from scratch. Return exactly one valid JSON object and nothing else."
      },
      task: "Regenerate workflow JSON",
      context: buildPlannerRegenerationContext(request.prompt, rawOutput, repairedOutput),
      outputMode: "json"
    });

    if (isSimulatedProviderOutput(regeneratedOutput)) {
      throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
    }

    const regenerated = parseGeneratedFlow(regeneratedOutput);
    if (regenerated) {
      return {
        draft: buildFlowDraft(regenerated, request),
        source: "model",
        notes: [
          "Generated from selected AI model.",
          "Applied JSON regeneration pass after repair to recover valid workflow JSON."
        ]
      };
    }
  } catch {
    // Continue to deterministic fallback.
  }

  const fallback = fallbackSpec(request.prompt);
  return {
    draft: buildFlowDraft(fallback, request),
    source: "fallback",
    notes: ["Model output was not valid JSON after repair/regeneration. Applied deterministic fallback flow."],
    rawOutput: [rawOutput, repairedOutput ? `[repair-pass-output]\n${repairedOutput}` : "", regeneratedOutput ? `[regeneration-pass-output]\n${regeneratedOutput}` : ""]
      .filter((entry) => entry.length > 0)
      .join("\n\n")
  };
}

async function generateConversationResponse(
  request: FlowBuilderRequest,
  provider: ProviderConfig
): Promise<FlowBuilderResponse> {
  const copilotStep = createGeneratorStep(
    request,
    "AI Flow Copilot",
    "You are a workflow copilot. Decide whether to answer, update current flow, or replace flow. Return strict JSON only."
  );

  const rawOutput = await executeProviderStep({
    provider,
    step: copilotStep,
    task: "Respond to user and decide flow action",
    context: buildChatPlannerContext(request),
    outputMode: "json"
  });

  if (isSimulatedProviderOutput(rawOutput)) {
    throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
  }

  const parsedDecision = parseFlowDecision(rawOutput);
  if (parsedDecision) {
    const flowSpec = parsedDecision.flow;
    if (parsedDecision.action === "answer" || flowSpec) {
      const next = buildDraftForAction(parsedDecision.action, flowSpec ?? fallbackSpec(request.prompt), request);
      const message = parsedDecision.message.trim() || defaultMessageForAction(next.action, next.draft);

      return {
        action: next.action,
        message,
        draft: next.draft,
        source: "model",
        notes: ["Generated from selected AI model.", ...next.notes]
      };
    }
  }

  let repairedOutput: string | undefined;
  let regeneratedOutput: string | undefined;
  try {
    repairedOutput = await executeProviderStep({
      provider,
      step: {
        ...copilotStep,
        id: nanoid(),
        name: "AI Copilot JSON Repair",
        prompt: "You are a JSON repair assistant. Return strict copilot JSON with no markdown."
      },
      task: "Repair copilot JSON",
      context: buildChatRepairContext(rawOutput),
      outputMode: "json"
    });

    if (isSimulatedProviderOutput(repairedOutput)) {
      throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
    }

    const repairedDecision = parseFlowDecision(repairedOutput);
    if (repairedDecision) {
      if (repairedDecision.action === "answer" || repairedDecision.flow) {
        const next = buildDraftForAction(repairedDecision.action, repairedDecision.flow ?? fallbackSpec(request.prompt), request);
        const message = repairedDecision.message.trim() || defaultMessageForAction(next.action, next.draft);

        return {
          action: next.action,
          message,
          draft: next.draft,
          source: "model",
          notes: ["Generated from selected AI model.", "Applied JSON repair pass before finalizing response.", ...next.notes]
        };
      }
    }
  } catch {
    // Continue to fallback logic.
  }

  try {
    regeneratedOutput = await executeProviderStep({
      provider,
      step: {
        ...copilotStep,
        id: nanoid(),
        name: "AI Copilot JSON Regeneration",
        prompt: "Regenerate strict copilot JSON from scratch. Return exactly one valid JSON object and nothing else."
      },
      task: "Regenerate copilot JSON",
      context: buildChatRegenerationContext(request, rawOutput, repairedOutput),
      outputMode: "json"
    });

    if (isSimulatedProviderOutput(regeneratedOutput)) {
      throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
    }

    const regeneratedDecision = parseFlowDecision(regeneratedOutput);
    if (regeneratedDecision) {
      if (regeneratedDecision.action === "answer" || regeneratedDecision.flow) {
        const next = buildDraftForAction(
          regeneratedDecision.action,
          regeneratedDecision.flow ?? fallbackSpec(request.prompt),
          request
        );
        const message = regeneratedDecision.message.trim() || defaultMessageForAction(next.action, next.draft);

        return {
          action: next.action,
          message,
          draft: next.draft,
          source: "model",
          notes: [
            "Generated from selected AI model.",
            "Applied JSON regeneration pass after repair to recover copilot response.",
            ...next.notes
          ]
        };
      }
    }
  } catch {
    // Continue to fallback logic.
  }

  const rawFlow = parseGeneratedFlow(regeneratedOutput ?? repairedOutput ?? rawOutput);
  if (rawFlow) {
    const inferredAction: FlowBuilderAction =
      request.currentDraft && !isReplaceIntent(request.prompt) ? "update_current_flow" : "replace_flow";
    const next = buildDraftForAction(inferredAction, rawFlow, request);

    return {
      action: next.action,
      message: defaultMessageForAction(next.action, next.draft),
      draft: next.draft,
      source: "fallback",
      notes: [
        "Model output missed copilot action wrapper. Recovered flow JSON and inferred action.",
        ...next.notes
      ],
      rawOutput: [rawOutput, repairedOutput ? `[repair-pass-output]\n${repairedOutput}` : "", regeneratedOutput ? `[regeneration-pass-output]\n${regeneratedOutput}` : ""]
        .filter((entry) => entry.length > 0)
        .join("\n\n")
    };
  }

  if (!isMutationIntent(request.prompt)) {
    return {
      action: "answer",
      message: clip(rawOutput, 2000) || "I could not parse a structured response, but no flow changes were requested.",
      source: "fallback",
      notes: ["Model output was not valid copilot JSON. Returned textual answer fallback."],
      rawOutput: [rawOutput, repairedOutput ? `[repair-pass-output]\n${repairedOutput}` : "", regeneratedOutput ? `[regeneration-pass-output]\n${regeneratedOutput}` : ""]
        .filter((entry) => entry.length > 0)
        .join("\n\n")
    };
  }

  const fallback = fallbackSpec(request.prompt);
  const fallbackAction: FlowBuilderAction =
    request.currentDraft && !isReplaceIntent(request.prompt) ? "update_current_flow" : "replace_flow";
  const next = buildDraftForAction(fallbackAction, fallback, request);

  return {
    action: next.action,
    message: defaultMessageForAction(next.action, next.draft),
    draft: next.draft,
    source: "fallback",
    notes: ["Model output was not valid copilot JSON after repair/regeneration. Applied deterministic fallback response.", ...next.notes],
    rawOutput: [rawOutput, repairedOutput ? `[repair-pass-output]\n${repairedOutput}` : "", regeneratedOutput ? `[regeneration-pass-output]\n${regeneratedOutput}` : ""]
      .filter((entry) => entry.length > 0)
      .join("\n\n")
  };
}

export async function generateFlowDraft(
  request: FlowBuilderRequest,
  providers: Record<ProviderId, ProviderConfig>
): Promise<FlowBuilderResponse> {
  const provider = providers[request.providerId];
  if (!provider) {
    throw new Error(`Provider ${request.providerId} is unavailable`);
  }

  const hasConversationContext = Boolean(request.currentDraft) || (request.history?.length ?? 0) > 0;

  if (hasConversationContext) {
    return generateConversationResponse(request, provider);
  }

  const generated = await generateDraftOnly(request, provider);
  return {
    action: "replace_flow",
    message:
      generated.source === "model"
        ? `Generated a flow with ${generated.draft.steps.length} step(s) and ${(generated.draft.links ?? []).length} link(s).`
        : `Generated deterministic template: ${generated.notes.join(" ")}`,
    draft: generated.draft,
    source: generated.source,
    notes: generated.notes,
    rawOutput: generated.rawOutput
  };
}
