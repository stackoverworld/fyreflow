import type { PipelineStep } from "../types.js";
import type { ProviderExecutionInput, OpenAIReasoningEffort, ClaudeEffort } from "./types.js";
import type { ReasoningEffort } from "../types.js";

function emptyOutputMessage(): string {
  return "Provider returned no text output.";
}

export function composeCliPrompt(input: ProviderExecutionInput): string {
  const outputInstruction =
    input.outputMode === "json"
      ? "Return STRICT JSON only. No markdown fences. No prose before or after the JSON object."
      : "Return only the step output in concise markdown.";
  const scopeInstruction =
    input.step.role === "orchestrator"
      ? [
          "This is a single orchestrator turn, not a full end-to-end run.",
          "Do not simulate downstream stages yourself.",
          "Return only the immediate orchestration decision, routing/status update, and what should run next."
        ].join("\n")
      : "";

  const sections = [
    `System instructions:\n${input.step.prompt}`,
    "",
    `Runtime options:\n- reasoning_effort=${input.step.reasoningEffort}\n- fast_mode=${input.step.fastMode ? "on" : "off"}\n- one_million_context=${input.step.use1MContext ? "on" : "off"}\n- context_window_tokens=${input.step.contextWindowTokens.toLocaleString()}`
  ];

  if (scopeInstruction.length > 0) {
    sections.push("", `Execution contract:\n${scopeInstruction}`);
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
