import { mergeAbortSignals } from "../../abort.js";
import type { ClaudeApiOptions, ProviderExecutionInput } from "../types.js";
import {
  buildClaudeSystemPrompt,
  extractClaudeText,
  extractOpenAIText,
  mapClaudeEffort,
  mapOpenAIReasoningEffort
} from "../normalizers.js";
import { CLAUDE_DEFAULT_URL, OPENAI_DEFAULT_URL } from "./config.js";

export async function executeOpenAIWithApi(input: ProviderExecutionInput, credential: string): Promise<string> {
  const endpoint = `${(input.provider.baseUrl || OPENAI_DEFAULT_URL).replace(/\/$/, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`
    },
    body: JSON.stringify({
      model: input.step.model || input.provider.defaultModel,
      input: [
        { role: "system", content: input.step.prompt },
        { role: "user", content: input.context }
      ],
      reasoning: {
        effort: mapOpenAIReasoningEffort(input.step.reasoningEffort)
      }
    }),
    signal: input.signal
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorBody.slice(0, 320)}`);
  }

  const body = (await response.json()) as unknown;
  return extractOpenAIText(body);
}

export async function executeClaudeWithApi(
  input: ProviderExecutionInput,
  credential: string,
  options?: ClaudeApiOptions
): Promise<string> {
  const endpoint = `${(input.provider.baseUrl || CLAUDE_DEFAULT_URL).replace(/\/$/, "")}/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01"
  };

  const betas: string[] = [];
  if (options?.disableEffort !== true) {
    betas.push("effort-2025-11-24");
  }
  if (input.step.use1MContext && options?.disable1MContext !== true) {
    betas.push("context-1m-2025-08-07");
  }
  if (betas.length > 0) {
    headers["anthropic-beta"] = betas.join(",");
  }

  if (input.provider.authMode === "oauth") {
    headers.Authorization = `Bearer ${credential}`;
  } else {
    headers["x-api-key"] = credential;
  }

  const requestBody: Record<string, unknown> = {
    model: input.step.model || input.provider.defaultModel,
    max_tokens: Math.max(1200, Math.min(6400, Math.floor(input.step.contextWindowTokens * 0.02))),
    system: buildClaudeSystemPrompt(input.step, input.outputMode),
    messages: [{ role: "user", content: input.context }]
  };

  if (options?.disableEffort !== true) {
    requestBody.output_config = {
      effort: mapClaudeEffort(input.step.reasoningEffort)
    };
  }

  const requestSignal = mergeAbortSignals([input.signal]);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: requestSignal
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude request failed (${response.status}): ${errorBody.slice(0, 320)}`);
  }

  const body = (await response.json()) as unknown;
  return extractClaudeText(body);
}
