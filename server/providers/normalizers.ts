import type { PipelineStep } from "../types.js";
import type { ProviderExecutionInput, OpenAIReasoningEffort, ClaudeEffort } from "./types.js";
import type { ReasoningEffort } from "../types.js";

function emptyOutputMessage(): string {
  return "Provider returned no text output.";
}

function isDeckHtmlSynthesisStep(input: ProviderExecutionInput): boolean {
  const producesHtml = input.step.requiredOutputFiles.some((file) => /\.html?$/i.test(file.trim()));
  if (!producesHtml) {
    return false;
  }

  const corpus = `${input.step.prompt}\n${input.context}`.toLowerCase();
  const deckSignals = ["assets-manifest.json", "pdf-content.json", "frame-map.json"];
  return deckSignals.every((signal) => corpus.includes(signal));
}

export function composeCliPrompt(input: ProviderExecutionInput): string {
  const outputInstruction =
    input.outputMode === "json"
      ? "Return STRICT JSON only. No markdown fences. No prose before or after the JSON object. All human-readable summary fields must be in English."
      : "Return only the step output in concise markdown.";
  const summaryLanguageInstruction = "Language requirement: any summary or status summary text must be written in English.";
  const scopeInstruction =
    input.step.role === "orchestrator"
      ? [
          "This is a single orchestrator turn, not a full end-to-end run.",
          "Do not simulate downstream stages yourself.",
          "Return only the immediate orchestration decision, routing/status update, and what should run next."
        ].join("\n")
      : "";
  const strictToolDisciplineRoles = new Set(["analysis", "planner", "review", "tester", "orchestrator", "executor"]);
  const toolDisciplineInstruction = strictToolDisciplineRoles.has(input.step.role)
    ? [
        "Tool discipline:",
        "- Use file tools (Read/Write/Edit/Grep/Glob) for file operations.",
        "- Do NOT write/copy artifacts via shell redirection or copy commands (cat >, cp, mv, tee).",
        "- Do NOT create or run ad-hoc scripts for artifact transformation (python/node/bash script files or one-liners).",
        "- For large files, avoid full-file reads; use targeted reads/grep and only inspect the minimal slices needed.",
        "- Never repeat the same write/copy action after success; if validation passes, proceed to final output."
      ].join("\n")
    : [
        "Tool discipline:",
        "- Prefer file tools (Read/Write/Edit/Grep/Glob) for file operations when possible.",
        "- Avoid repeating the same write/copy action after success; if validation passes, proceed."
      ].join("\n");
  const immutableArtifactInstruction = [
    "Artifact integrity:",
    "- Never modify ui-kit.json, dev-code.json, assets-manifest.json, frame-map.json, or pdf-content.json unless the current step explicitly lists them in required_output_files.",
    "- If those artifacts are missing or inconsistent, report FAIL with reasons instead of rewriting them."
  ].join("\n");

  const sections = [
    `System instructions:\n${input.step.prompt}`,
    "",
    "Runtime safety policy in this prompt overrides conflicting task wording when they disagree.",
    "",
    `Runtime options:\n- reasoning_effort=${input.step.reasoningEffort}\n- fast_mode=${input.step.fastMode ? "on" : "off"}\n- one_million_context=${input.step.use1MContext ? "on" : "off"}\n- context_window_tokens=${input.step.contextWindowTokens.toLocaleString()}`
  ];

  if (scopeInstruction.length > 0) {
    sections.push("", `Execution contract:\n${scopeInstruction}`);
  }

  sections.push("", `Execution discipline:\n${toolDisciplineInstruction}`);
  sections.push("", `Artifact contract:\n${immutableArtifactInstruction}`);
  sections.push("", summaryLanguageInstruction);
  if (isDeckHtmlSynthesisStep(input)) {
    sections.push(
      "",
      [
        "Deck synthesis contract:",
        "- If target HTML already exists, read it first and edit it page-by-page instead of rebuilding from scratch.",
        "- Prefer assets-manifest file references (for example assets/*.png, assets/*.svg, assets/*.webp) for backgrounds; do not full-read large base64 blobs.",
        "- If assets-manifest marks textOverlayRisk=true for a background, do not reuse that asset as the text backdrop.",
        "- When assets/slide-*-bg.* files exist, use those for slide backgrounds and do not use full-frame captures like assets/frame-*.png as text backdrops.",
        "- Prefer clean background-layer files (for example assets/slide-*-bg.png) and keep logos/illustrations as separate positioned assets.",
        "- Do not generate helper scripts (python/js/bash) to transform deck content.",
        "- Keep one visible slide container per frame and ensure slide containers are machine-countable (`class=\"slide\"` or `id=\"slide-N\"`)."
      ].join("\n")
    );
  }

  sections.push("", `Task:\n${input.task}`, "", `Context:\n${input.context}`, "", outputInstruction);
  return sections.join("\n");
}

export function buildClaudeSystemPrompt(
  step: PipelineStep,
  outputMode: ProviderExecutionInput["outputMode"]
): string {
  const notes: string[] = [step.prompt];

  if (step.fastMode) {
    notes.push("Fast mode requested: prioritize lower latency with concise output when possible.");
  }

  if (step.use1MContext) {
    notes.push("1M context mode requested for compatible Sonnet/Opus models.");
  }

  if (outputMode === "json") {
    notes.push("Output must be STRICT JSON only, as a single object, with no markdown fences or extra narration.");
  }

  notes.push("Language requirement: any summary or status-summary text must be in English.");

  return notes.join("\n\n");
}

export function mapClaudeEffort(value: ReasoningEffort): ClaudeEffort {
  if (value === "minimal" || value === "low") {
    return "low";
  }
  if (value === "xhigh" || value === "high") {
    return "high";
  }
  return "medium";
}

export function mapOpenAIReasoningEffort(value: ReasoningEffort): OpenAIReasoningEffort {
  if (value === "xhigh") {
    return "high";
  }

  return value;
}

export function extractClaudeText(responseBody: unknown): string {
  if (typeof responseBody !== "object" || responseBody === null || !("content" in responseBody)) {
    return emptyOutputMessage();
  }

  const content = (responseBody as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return emptyOutputMessage();
  }

  const segments: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null && "text" in block) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") {
        segments.push(text);
      }
    }
  }

  if (segments.length === 0) {
    return emptyOutputMessage();
  }

  return segments.join("\n");
}

export function extractOpenAIText(responseBody: unknown): string {
  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "output_text" in responseBody &&
    typeof (responseBody as { output_text?: unknown }).output_text === "string"
  ) {
    return (responseBody as { output_text: string }).output_text;
  }

  if (typeof responseBody === "object" && responseBody !== null && "output" in responseBody) {
    const output = (responseBody as { output?: unknown }).output;
    if (Array.isArray(output)) {
      const chunks: string[] = [];
      for (const item of output) {
        if (typeof item !== "object" || item === null || !("content" in item)) {
          continue;
        }
        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) {
          continue;
        }
        for (const block of content) {
          if (typeof block === "object" && block !== null && "text" in block) {
            const text = (block as { text?: unknown }).text;
            if (typeof text === "string") {
              chunks.push(text);
            }
          }
        }
      }
      if (chunks.length > 0) {
        return chunks.join("\n");
      }
    }
  }

  return emptyOutputMessage();
}
