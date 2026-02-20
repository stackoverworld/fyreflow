import { z } from "zod";
import { executeProviderStep } from "./providers.js";
import { buildSmartRunPlan } from "./smartRun.js";
import {
  areRunInputKeysEquivalent,
  getRunInputValue,
  normalizeRunInputKey,
  normalizeRunInputs,
  pickPreferredRunInputKey,
  type RunInputs
} from "./runInputs.js";
import type {
  DashboardState,
  Pipeline,
  PipelineStep,
  RunInputRequest,
  RunInputRequestOption,
  RunInputRequestType,
  RunStartupBlocker,
  RunStartupCheck,
  SmartRunField
} from "./types.js";

interface BuildStartupCheckInput {
  task?: string;
  inputs?: unknown;
}

interface ParsedModelStartupResult {
  status?: "pass" | "needs_input" | "blocked";
  summary?: string;
  requests: RunInputRequest[];
  blockers: RunStartupBlocker[];
  notes: string[];
}

const modelOptionSchema = z.object({
  value: z.string().min(1).max(400),
  label: z.string().min(1).max(180).optional(),
  description: z.string().min(1).max(400).optional()
});

const modelRequestSchema = z.object({
  key: z.string().min(1).max(160).optional(),
  id: z.string().min(1).max(160).optional(),
  name: z.string().min(1).max(160).optional(),
  label: z.string().min(1).max(180).optional(),
  title: z.string().min(1).max(180).optional(),
  type: z.string().min(1).max(40).optional(),
  input_type: z.string().min(1).max(40).optional(),
  required: z.boolean().optional(),
  reason: z.string().min(1).max(800).optional(),
  message: z.string().min(1).max(800).optional(),
  placeholder: z.string().min(1).max(280).optional(),
  defaultValue: z.string().max(4000).optional(),
  default_value: z.string().max(4000).optional(),
  allowCustom: z.boolean().optional(),
  allow_custom: z.boolean().optional(),
  options: z
    .array(z.union([modelOptionSchema, z.string().min(1).max(400)]))
    .max(20)
    .optional()
});

const modelBlockerSchema = z.object({
  id: z.string().min(1).max(180).optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(800).optional(),
  details: z.string().min(1).max(800).optional(),
  reason: z.string().min(1).max(800).optional()
});

const modelStartupSchema = z
  .object({
    status: z.enum(["pass", "needs_input", "blocked"]).optional(),
    summary: z.string().min(1).max(2000).optional(),
    requests: z.array(modelRequestSchema).max(30).optional(),
    input_requests: z.array(modelRequestSchema).max(30).optional(),
    blockers: z.array(modelBlockerSchema).max(30).optional(),
    notes: z.array(z.string().min(1).max(500)).max(20).optional()
  })
  .passthrough();

function normalizeRequestType(rawType: unknown): RunInputRequestType {
  if (typeof rawType !== "string") {
    return "text";
  }

  const normalized = rawType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "text") return "text";
  if (normalized === "multiline" || normalized === "textarea" || normalized === "long_text") return "multiline";
  if (normalized === "secret" || normalized === "password" || normalized === "token" || normalized === "api_key") return "secret";
  if (normalized === "path" || normalized === "file" || normalized === "directory" || normalized === "dir") return "path";
  if (normalized === "url" || normalized === "link" || normalized === "uri") return "url";
  if (normalized === "select" || normalized === "enum" || normalized === "choice" || normalized === "options") return "select";
  return "text";
}

function normalizeKey(raw: string): string {
  return normalizeRunInputKey(raw);
}

function toLabelFromKey(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.slice(0, 1).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function sanitizeJsonCandidate(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
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

function collectJsonCandidates(rawOutput: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    const normalized = sanitizeJsonCandidate(value);
    if (normalized.length > 0) {
      candidates.add(normalized);
    }
  };

  add(rawOutput);
  for (const block of rawOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    add(block[1]);
  }

  add(extractFirstJsonObject(rawOutput));

  const base = [...candidates];
  for (const candidate of base) {
    const noComments = stripJsonComments(candidate);
    add(noComments);
    add(removeTrailingCommas(noComments));
    add(quoteUnquotedKeys(noComments));
    add(convertSingleQuotedStrings(noComments));
    add(normalizePythonJsonLiterals(noComments));
    add(removeTrailingCommas(quoteUnquotedKeys(noComments)));
    add(removeTrailingCommas(convertSingleQuotedStrings(noComments)));
    add(removeTrailingCommas(normalizePythonJsonLiterals(noComments)));

    const extracted = extractFirstJsonObject(noComments);
    add(extracted);
    add(extracted ? removeTrailingCommas(extracted) : null);
  }

  return [...candidates];
}

function normalizeOption(raw: unknown): RunInputRequestOption | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value.length === 0) {
      return null;
    }

    return {
      value,
      label: value
    };
  }

  const parsed = modelOptionSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  return {
    value: parsed.data.value.trim(),
    label: (parsed.data.label ?? parsed.data.value).trim(),
    description: parsed.data.description?.trim() || undefined
  };
}

function normalizeModelRequest(raw: unknown): RunInputRequest | null {
  const parsed = modelRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;
  const rawKey = data.key ?? data.id ?? data.name;
  if (!rawKey) {
    return null;
  }

  const key = normalizeKey(rawKey);
  if (key.length === 0) {
    return null;
  }

  const type = normalizeRequestType(data.type ?? data.input_type);
  const options = (data.options ?? [])
    .map((entry) => normalizeOption(entry))
    .filter((entry): entry is RunInputRequestOption => Boolean(entry));
  const reason = (data.reason ?? data.message ?? `Provide ${toLabelFromKey(key)} to continue.`).trim();

  const normalized: RunInputRequest = {
    key,
    label: (data.label ?? data.title ?? toLabelFromKey(key)).trim(),
    type,
    required: data.required ?? true,
    reason,
    placeholder: data.placeholder?.trim() || undefined,
    options: options.length > 0 ? options : undefined,
    allowCustom: data.allowCustom ?? data.allow_custom ?? undefined,
    defaultValue: (data.defaultValue ?? data.default_value)?.trim() || undefined
  };

  if (normalized.type !== "select" && normalized.options && normalized.options.length > 0) {
    normalized.type = "select";
  }

  return normalized;
}

function normalizeModelBlocker(raw: unknown, index: number): RunStartupBlocker | null {
  const parsed = modelBlockerSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const message = (parsed.data.message ?? parsed.data.reason ?? "").trim();
  if (message.length === 0) {
    return null;
  }

  return {
    id: (parsed.data.id ?? `model-blocker-${index + 1}`).trim(),
    title: (parsed.data.title ?? "Startup blocker").trim(),
    message,
    details: parsed.data.details?.trim() || undefined
  };
}

function parseModelStartupResult(rawOutput: string): ParsedModelStartupResult | null {
  if (rawOutput.trimStart().startsWith("[Simulated ")) {
    return null;
  }

  for (const candidate of collectJsonCandidates(rawOutput)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = modelStartupSchema.safeParse(parsed);
      if (!validated.success) {
        continue;
      }

      const requestsRaw = validated.data.requests ?? validated.data.input_requests ?? [];
      const requests = requestsRaw
        .map((entry) => normalizeModelRequest(entry))
        .filter((entry): entry is RunInputRequest => Boolean(entry));
      const blockers = (validated.data.blockers ?? [])
        .map((entry, index) => normalizeModelBlocker(entry, index))
        .filter((entry): entry is RunStartupBlocker => Boolean(entry));
      const notes = (validated.data.notes ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);

      return {
        status: validated.data.status,
        summary: validated.data.summary?.trim() || undefined,
        requests,
        blockers,
        notes
      };
    } catch {
      // Keep trying repaired JSON candidates.
    }
  }

  return null;
}

function missingFieldRequest(field: SmartRunField): RunInputRequest {
  return {
    key: normalizeKey(field.key),
    label: field.label,
    type: field.type,
    required: field.required,
    reason: field.description || `Provide ${field.label} to continue.`,
    placeholder: field.placeholder || undefined,
    allowCustom: field.type === "multiline"
  };
}

function resolveVerifierStep(pipeline: Pipeline): PipelineStep | null {
  if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) {
    return null;
  }

  const orchestrator = pipeline.steps.find((step) => step.role === "orchestrator");
  return orchestrator ?? pipeline.steps[0] ?? null;
}

function mergeRequestOptionLists(
  base: RunInputRequestOption[] | undefined,
  extra: RunInputRequestOption[] | undefined
): RunInputRequestOption[] | undefined {
  if ((!base || base.length === 0) && (!extra || extra.length === 0)) {
    return undefined;
  }

  const byValue = new Map<string, RunInputRequestOption>();
  for (const option of [...(base ?? []), ...(extra ?? [])]) {
    const key = option.value.trim();
    if (key.length === 0) {
      continue;
    }
    if (!byValue.has(key)) {
      byValue.set(key, option);
    }
  }

  return [...byValue.values()];
}

function hasInputValue(runInputs: RunInputs, key: string): boolean {
  const value = getRunInputValue(runInputs, key);
  return typeof value === "string" && value.trim().length > 0;
}

function mergeRequests(deterministic: RunInputRequest[], model: RunInputRequest[], runInputs: RunInputs): RunInputRequest[] {
  const byKey = new Map<string, RunInputRequest>();

  for (const request of deterministic) {
    if (hasInputValue(runInputs, request.key)) {
      continue;
    }

    const normalizedKey = normalizeKey(request.key);
    const equivalentKey = [...byKey.keys()].find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, normalizedKey)
    );
    const key =
      equivalentKey === undefined
        ? normalizedKey
        : pickPreferredRunInputKey(equivalentKey, normalizedKey);
    const existing = equivalentKey ? byKey.get(equivalentKey) : undefined;
    const nextRequest = existing ? { ...existing, ...request, key } : { ...request, key };

    if (equivalentKey && equivalentKey !== key) {
      byKey.delete(equivalentKey);
    }
    byKey.set(key, nextRequest);
  }

  for (const request of model) {
    const normalizedKey = normalizeKey(request.key);
    const equivalentKey = [...byKey.keys()].find((existingKey) =>
      areRunInputKeysEquivalent(existingKey, normalizedKey)
    );
    const key =
      equivalentKey === undefined
        ? normalizedKey
        : pickPreferredRunInputKey(equivalentKey, normalizedKey);
    if (key.length === 0 || hasInputValue(runInputs, key)) {
      continue;
    }

    const existing = equivalentKey ? byKey.get(equivalentKey) : byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...request,
        key
      });
      continue;
    }

    const mergedOptions = mergeRequestOptionLists(existing.options, request.options);
    const mergedType =
      existing.type === "text" && request.type !== "text"
        ? request.type
        : mergedOptions && mergedOptions.length > 0
          ? "select"
          : existing.type;
    if (equivalentKey && equivalentKey !== key) {
      byKey.delete(equivalentKey);
    }
    byKey.set(key, {
      ...existing,
      label: existing.label || request.label,
      type: mergedType,
      required: existing.required || request.required,
      reason: request.reason || existing.reason,
      placeholder: existing.placeholder ?? request.placeholder,
      options: mergedOptions,
      allowCustom: request.allowCustom ?? existing.allowCustom,
      defaultValue: existing.defaultValue ?? request.defaultValue
    });
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function summarizePipelineForVerifier(pipeline: Pipeline): Record<string, unknown> {
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
      requiredOutputFiles: step.requiredOutputFiles
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

function buildVerifierPrompt(): string {
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

function buildVerifierContext(
  pipeline: Pipeline,
  task: string,
  runInputs: RunInputs,
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

function summarizeStatus(
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

async function runModelStartupCheck(
  pipeline: Pipeline,
  state: DashboardState,
  task: string,
  runInputs: RunInputs,
  deterministicRequests: RunInputRequest[],
  deterministicBlockers: RunStartupBlocker[]
): Promise<ParsedModelStartupResult | null> {
  const verifierBaseStep = resolveVerifierStep(pipeline);
  if (!verifierBaseStep) {
    return null;
  }

  const provider = state.providers[verifierBaseStep.providerId];
  if (!provider) {
    return null;
  }

  const step: PipelineStep = {
    ...verifierBaseStep,
    prompt: buildVerifierPrompt(),
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: []
  };

  const context = buildVerifierContext(pipeline, task, runInputs, deterministicRequests, deterministicBlockers);
  const output = await executeProviderStep({
    provider,
    step,
    context,
    task: task || `Startup check for ${pipeline.name}`,
    outputMode: "json"
  });

  return parseModelStartupResult(output);
}

function dedupeBlockers(blockers: RunStartupBlocker[]): RunStartupBlocker[] {
  const byId = new Map<string, RunStartupBlocker>();
  for (const blocker of blockers) {
    const key = blocker.id.trim().length > 0 ? blocker.id.trim() : `${blocker.title}:${blocker.message}`;
    if (!byId.has(key)) {
      byId.set(key, blocker);
    }
  }
  return [...byId.values()];
}

export async function buildRunStartupCheck(
  pipeline: Pipeline,
  state: DashboardState,
  input: BuildStartupCheckInput = {}
): Promise<RunStartupCheck> {
  const runInputs = normalizeRunInputs(input.inputs);
  const task = typeof input.task === "string" ? input.task.trim() : "";
  const smartPlan = await buildSmartRunPlan(pipeline, state, runInputs);

  const deterministicRequests = smartPlan.fields
    .filter((field) => field.required && !hasInputValue(runInputs, field.key))
    .map((field) => missingFieldRequest(field));

  const deterministicBlockers: RunStartupBlocker[] = smartPlan.checks
    .filter((check) => check.status === "fail" && !check.id.startsWith("input:"))
    .map((check) => ({
      id: check.id,
      title: check.title,
      message: check.message,
      details: check.details
    }));

  let modelResult: ParsedModelStartupResult | null = null;
  const notes: string[] = [];

  try {
    modelResult = await runModelStartupCheck(pipeline, state, task, runInputs, deterministicRequests, deterministicBlockers);
    if (!modelResult) {
      notes.push("AI startup-check unavailable. Used deterministic checks.");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "startup-check provider error";
    notes.push(`AI startup-check failed: ${reason}`);
  }

  const mergedRequests = mergeRequests(deterministicRequests, modelResult?.requests ?? [], runInputs);
  const mergedBlockers = dedupeBlockers([...(deterministicBlockers ?? []), ...(modelResult?.blockers ?? [])]);

  let status: RunStartupCheck["status"] = "pass";
  if (mergedBlockers.length > 0 || modelResult?.status === "blocked") {
    status = "blocked";
  } else if (mergedRequests.length > 0 || modelResult?.status === "needs_input") {
    status = "needs_input";
  }

  const summary = summarizeStatus(status, mergedRequests, mergedBlockers, modelResult?.summary);

  let source: RunStartupCheck["source"] = "deterministic";
  if (modelResult) {
    source = deterministicRequests.length > 0 || deterministicBlockers.length > 0 ? "merged" : "model";
  }

  return {
    status,
    summary,
    requests: mergedRequests,
    blockers: mergedBlockers,
    source,
    notes: [...(modelResult?.notes ?? []), ...notes]
  };
}
