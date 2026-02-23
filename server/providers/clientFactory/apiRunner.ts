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

interface SseMessage {
  event: string;
  data: string;
}

export class ProviderApiError extends Error {
  readonly providerId: "openai" | "claude";
  readonly statusCode: number;
  readonly retryAfterMs: number | null;
  readonly responseSnippet: string;

  constructor(input: {
    providerId: "openai" | "claude";
    statusCode: number;
    responseSnippet: string;
    retryAfterMs: number | null;
  }) {
    super(
      `${input.providerId === "openai" ? "OpenAI" : "Claude"} request failed (${input.statusCode}): ${input.responseSnippet}`
    );
    this.name = "ProviderApiError";
    this.providerId = input.providerId;
    this.statusCode = input.statusCode;
    this.retryAfterMs = input.retryAfterMs;
    this.responseSnippet = input.responseSnippet;
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number.parseFloat(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isFinite(asDate)) {
    return null;
  }

  return Math.max(0, asDate - Date.now());
}

function resolveRequestId(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("request-id") ?? headers.get("anthropic-request-id");
}

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (chunk: string): void => {
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      if (rawEvent.trim().length === 0) {
        continue;
      }

      let event = "message";
      const dataLines: string[] = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim() || event;
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }

      if (dataLines.length === 0) {
        continue;
      }

      onMessage({
        event,
        data: dataLines.join("\n")
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    flush(decoder.decode(value, { stream: true }));
  }

  flush(decoder.decode());
  if (buffer.trim().length > 0) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of buffer.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim() || event;
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataLines.length > 0) {
      onMessage({ event, data: dataLines.join("\n") });
    }
  }
}

function parseJsonSafe(payload: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failures
  }
  return null;
}

function extractOpenAiDelta(payload: Record<string, unknown>): string {
  const directDelta = payload.delta;
  if (typeof directDelta === "string") {
    return directDelta;
  }
  if (typeof directDelta === "object" && directDelta !== null && !Array.isArray(directDelta)) {
    const text = (directDelta as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }
  return "";
}

async function readOpenAiStreamingOutput(response: Response, log?: (message: string) => void): Promise<string> {
  if (!response.body) {
    return "";
  }

  const startedAt = Date.now();
  let lastEventLogAt = 0;
  let eventCount = 0;
  let output = "";
  let finalOutput = "";

  await consumeSseStream(response.body, (message) => {
    if (message.data === "[DONE]") {
      return;
    }

    const payload = parseJsonSafe(message.data);
    if (!payload) {
      return;
    }

    const type = typeof payload.type === "string" ? payload.type : message.event;
    eventCount += 1;
    const now = Date.now();
    if (eventCount <= 2 || now - lastEventLogAt >= 15_000) {
      lastEventLogAt = now;
      log?.(`OpenAI stream event: ${type}`);
    }

    if (type === "error") {
      const errorMessage =
        typeof payload.message === "string"
          ? payload.message
          : typeof (payload.error as { message?: unknown })?.message === "string"
            ? (payload.error as { message: string }).message
            : message.data;
      throw new Error(`OpenAI streaming error: ${errorMessage}`);
    }

    if (type === "response.output_text.delta") {
      output += extractOpenAiDelta(payload);
      return;
    }

    if (type === "response.completed") {
      const responsePayload =
        typeof payload.response === "object" && payload.response !== null ? payload.response : payload;
      finalOutput = extractOpenAIText(responsePayload);
    }
  });

  const resolved = output.trim().length > 0 ? output : finalOutput;
  log?.(`OpenAI stream completed in ${Date.now() - startedAt}ms (events=${eventCount}, outputChars=${resolved.length})`);
  return resolved;
}

function extractClaudeDelta(payload: Record<string, unknown>): string {
  const delta = payload.delta;
  if (typeof delta === "object" && delta !== null && !Array.isArray(delta)) {
    const text = (delta as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }
  const text = payload.text;
  if (typeof text === "string") {
    return text;
  }
  return "";
}

async function readClaudeStreamingOutput(response: Response, log?: (message: string) => void): Promise<string> {
  if (!response.body) {
    return "";
  }

  const startedAt = Date.now();
  let lastEventLogAt = 0;
  let eventCount = 0;
  let output = "";

  await consumeSseStream(response.body, (message) => {
    if (message.data === "[DONE]") {
      return;
    }

    const payload = parseJsonSafe(message.data);
    if (!payload) {
      return;
    }

    const eventType = message.event || (typeof payload.type === "string" ? payload.type : "message");
    eventCount += 1;
    const now = Date.now();
    if (eventCount <= 2 || eventType === "ping" || now - lastEventLogAt >= 15_000) {
      lastEventLogAt = now;
      log?.(`Claude stream event: ${eventType}`);
    }

    if (eventType === "error") {
      const errorMessage =
        typeof (payload.error as { message?: unknown })?.message === "string"
          ? (payload.error as { message: string }).message
          : message.data;
      throw new Error(`Claude streaming error: ${errorMessage}`);
    }

    if (eventType === "content_block_delta") {
      output += extractClaudeDelta(payload);
    }
  });

  log?.(`Claude stream completed in ${Date.now() - startedAt}ms (events=${eventCount}, outputChars=${output.length})`);
  return output;
}

export async function executeOpenAIWithApi(input: ProviderExecutionInput, credential: string): Promise<string> {
  const endpoint = `${(input.provider.baseUrl || OPENAI_DEFAULT_URL).replace(/\/$/, "")}/responses`;
  const requestSignal = mergeAbortSignals([input.signal]);
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
      },
      stream: true
    }),
    signal: requestSignal
  });

  const requestId = resolveRequestId(response.headers);
  if (requestId) {
    input.log?.(`OpenAI request id: ${requestId}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ProviderApiError({
      providerId: "openai",
      statusCode: response.status,
      responseSnippet: errorBody.slice(0, 320),
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"))
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const streamed = await readOpenAiStreamingOutput(response, input.log);
    if (streamed.trim().length > 0) {
      return streamed;
    }
    input.log?.("OpenAI stream returned no text payload.");
    return "Provider returned no text output.";
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
    messages: [{ role: "user", content: input.context }],
    stream: true
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

  const requestId = resolveRequestId(response.headers);
  if (requestId) {
    input.log?.(`Claude request id: ${requestId}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ProviderApiError({
      providerId: "claude",
      statusCode: response.status,
      responseSnippet: errorBody.slice(0, 320),
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"))
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const streamed = await readClaudeStreamingOutput(response, input.log);
    if (streamed.trim().length > 0) {
      return streamed;
    }
    input.log?.("Claude stream returned no text payload.");
    return "Provider returned no text output.";
  }

  const body = (await response.json()) as unknown;
  return extractClaudeText(body);
}
