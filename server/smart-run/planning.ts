import type { Pipeline, SmartRunField, SmartRunFieldType } from "../types.js";
import {
  areRunInputKeysEquivalent,
  extractInputKeysFromText,
  normalizeRunInputKey,
  pickPreferredRunInputKey
} from "../runInputs.js";
import type { MutableField } from "./types.js";

function toLabel(key: string): string {
  return key
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk.slice(0, 1).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function inferFieldType(key: string): SmartRunFieldType {
  const normalized = key.toLowerCase();

  if (
    normalized.includes("token") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password")
  ) {
    return "secret";
  }

  if (
    normalized.includes("path") ||
    normalized.includes("dir") ||
    normalized.includes("file") ||
    normalized.includes("pdf") ||
    normalized.includes("html") ||
    normalized.includes("output")
  ) {
    return "path";
  }

  if (normalized.includes("url") || normalized.includes("link") || normalized.includes("endpoint")) {
    return "url";
  }

  if (normalized.includes("prompt") || normalized.includes("notes") || normalized.includes("instructions")) {
    return "multiline";
  }

  return "text";
}

function inferPlaceholderForKey(key: string, type: SmartRunFieldType): string {
  if (type === "path") {
    return "/path/to/file-or-dir";
  }
  if (type === "url") {
    return "https://example.com/resource";
  }
  if (type === "secret") {
    return "Enter secret value";
  }
  if (type === "multiline") {
    return "Enter multiline input";
  }
  return `Enter ${toLabel(key).toLowerCase()}`;
}

function inferDescriptionForKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized.includes("figma")) {
    return "Used by Figma extraction stages.";
  }
  if (normalized.includes("pdf")) {
    return "Used by PDF extraction/rendering/review stages.";
  }
  if (normalized.includes("output")) {
    return "Used as output destination for generated artifacts.";
  }
  return "Runtime input available to agents via {{input.<key>}} and run context.";
}

type FieldOptions = Partial<Pick<SmartRunField, "required" | "type" | "description" | "placeholder">>;

function addField(
  registry: Map<string, MutableField>,
  keyRaw: string,
  source: string,
  options?: FieldOptions
): void {
  const candidateKey = normalizeRunInputKey(keyRaw);
  const equivalentExistingKey = [...registry.keys()].find((existingKey) =>
    areRunInputKeysEquivalent(existingKey, candidateKey)
  );
  const key =
    equivalentExistingKey === undefined
      ? candidateKey
      : pickPreferredRunInputKey(equivalentExistingKey, candidateKey);

  if (key.length === 0) {
    return;
  }

  if (equivalentExistingKey && equivalentExistingKey !== key) {
    const existingField = registry.get(equivalentExistingKey);
    if (existingField) {
      registry.delete(equivalentExistingKey);
      existingField.key = key;
      registry.set(key, existingField);
    }
  }

  const existing = registry.get(key);
  if (existing) {
    existing.sources.add(source);
    if (options?.required) {
      existing.required = true;
    }
    if (options?.type) {
      existing.type = options.type;
    }
    if (options?.description && existing.description === undefined) {
      existing.description = options.description;
    }
    if (options?.placeholder && existing.placeholder === undefined) {
      existing.placeholder = options.placeholder;
    }
    return;
  }

  registry.set(key, {
    key,
    required: options?.required ?? true,
    type: options?.type,
    description: options?.description,
    placeholder: options?.placeholder,
    sources: new Set([source])
  });
}

export function collectFieldsFromPipeline(pipeline: Pipeline): SmartRunField[] {
  const registry = new Map<string, MutableField>();
  const collectFromText = (text: string, source: string) => {
    for (const key of extractInputKeysFromText(text)) {
      addField(registry, key, source, { required: true });
    }
  };

  collectFromText(pipeline.description, "pipeline.description");

  for (const step of pipeline.steps) {
    collectFromText(step.prompt, `${step.name}.prompt`);
    collectFromText(step.contextTemplate, `${step.name}.contextTemplate`);
    for (const filePath of step.requiredOutputFiles) {
      collectFromText(filePath, `${step.name}.requiredOutputFiles`);
    }
    for (const filePath of step.skipIfArtifacts) {
      collectFromText(filePath, `${step.name}.skipIfArtifacts`);
    }
  }

  for (const gate of pipeline.qualityGates) {
    collectFromText(gate.pattern, `qualityGate:${gate.name}.pattern`);
    collectFromText(gate.jsonPath, `qualityGate:${gate.name}.jsonPath`);
    collectFromText(gate.artifactPath, `qualityGate:${gate.name}.artifactPath`);
    collectFromText(gate.message, `qualityGate:${gate.name}.message`);
  }

  const aggregateText = [
    pipeline.name,
    pipeline.description,
    ...pipeline.steps.map((step) => `${step.name}\n${step.prompt}\n${step.contextTemplate}`)
  ]
    .join("\n")
    .toLowerCase();

  if (aggregateText.includes("figma")) {
    addField(registry, "figma_links", "heuristic", {
      required: true,
      type: "multiline",
      description: "One Figma Dev Mode link per line."
    });
  }

  if (aggregateText.includes("figma token") || aggregateText.includes("figma api token")) {
    addField(registry, "figma_token", "heuristic", {
      required: true,
      type: "secret",
      description: "Token used to access Figma resources."
    });
  }

  if (aggregateText.includes("source-of-truth pdf") || (aggregateText.includes("source") && aggregateText.includes("pdf"))) {
    addField(registry, "source_pdf_path", "heuristic", {
      required: true,
      type: "path",
      description: "Path to the source PDF file."
    });
  }

  if (aggregateText.includes("output directory")) {
    addField(registry, "output_dir", "heuristic", {
      required: true,
      type: "path",
      description: "Directory where generated artifacts should be saved."
    });
  }

  if (aggregateText.includes("final html")) {
    addField(registry, "final_html_path", "heuristic", {
      required: false,
      type: "path"
    });
  }

  if (aggregateText.includes("final pdf")) {
    addField(registry, "final_pdf_path", "heuristic", {
      required: false,
      type: "path"
    });
  }

  if (aggregateText.includes("repo/workspace") || aggregateText.includes("workspace")) {
    addField(registry, "workspace_path", "heuristic", {
      required: false,
      type: "path"
    });
  }

  const hasScenarioTags = pipeline.steps.some(
    (step) => Array.isArray(step.scenarios) && step.scenarios.some((tag) => tag.trim().length > 0)
  );
  if (hasScenarioTags) {
    addField(registry, "scenario", "step.scenarios", {
      required: false,
      type: "text",
      description: "Optional scenario tag to run only the matching scenario path."
    });
  }

  return [...registry.values()]
    .map((field) => {
      const type = field.type ?? inferFieldType(field.key);
      return {
        key: field.key,
        label: toLabel(field.key),
        type,
        required: field.required,
        description: field.description ?? inferDescriptionForKey(field.key),
        placeholder: field.placeholder ?? inferPlaceholderForKey(field.key, type),
        sources: [...field.sources].sort()
      } satisfies SmartRunField;
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}
