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
import { buildEnglishSummaryFromOutput, extractEnglishSummaryFromRecord } from "./modelSummary.js";

interface SseMessage {
  event: string;
  data: string;
}

interface ProviderMcpToolCall {
  serverId: string;
  tool: string;
  arguments: Record<string, unknown>;
}

interface StreamingProviderResult {
  text: string;
  mcpToolCalls: ProviderMcpToolCall[];
}

const MCP_TOOL_NAME = "mcp_call";

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

const STREAM_IDLE_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.LLM_STREAM_IDLE_TIMEOUT_MS ?? "90000", 10);
  if (!Number.isFinite(raw)) {
    return 90_000;
  }
  return Math.max(1_000, Math.min(600_000, raw));
})();

const DELIVERY_STEP_NAME_PATTERN = /\bdeliver(y|ed|ing)?\b/i;

function shouldRequireGateResultContract(input: ProviderExecutionInput): boolean {
  if (input.outputMode !== "json") {
    return false;
  }
  if (input.step.role === "review" || input.step.role === "tester") {
    return true;
  }
  return DELIVERY_STEP_NAME_PATTERN.test(input.step.name);
}

function buildGateResultJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["workflow_status", "next_action", "reasons"],
    properties: {
      workflow_status: {
        type: "string",
        enum: ["PASS", "FAIL", "NEUTRAL", "COMPLETE", "NEEDS_INPUT"]
      },
      next_action: {
        type: "string",
        enum: ["continue", "retry_step", "retry_stage", "escalate", "stop"]
      },
      summary: { type: "string" },
      stage: {
        type: "string",
        enum: ["draft", "pre_final", "final"]
      },
      step_role: {
        type: "string",
        enum: [
          "analysis",
          "planner",
          "orchestrator",
          "executor",
          "tester",
          "review",
          "extractor",
          "builder",
          "reviewer",
          "remediator",
          "renderer",
          "delivery"
        ]
      },
      gate_target: {
        type: "string",
        enum: ["step", "stage", "delivery"]
      },
      reasons: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            severity: {
              type: "string",
              enum: ["critical", "high", "medium", "low"]
            }
          }
        }
      },
      html_review_status: {
        type: "string",
        enum: ["PASS", "FAIL", "NEUTRAL", "COMPLETE", "NEEDS_INPUT"]
      },
      pdf_review_status: {
        type: "string",
        enum: ["PASS", "FAIL", "NEUTRAL", "COMPLETE", "NEEDS_INPUT"]
      }
    }
  };
}

function buildOpenAiResponseFormat(input: ProviderExecutionInput): Record<string, unknown> | null {
  if (input.outputMode !== "json") {
    return null;
  }

  if (!shouldRequireGateResultContract(input)) {
    return { type: "json_object" };
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "gate_result_contract",
      strict: true,
      schema: buildGateResultJsonSchema()
    }
  };
}

function buildClaudeOutputFormat(
  input: ProviderExecutionInput,
  options?: Pick<ClaudeApiOptions, "disableOutputFormat">
): Record<string, unknown> | null {
  if (input.outputMode !== "json" || options?.disableOutputFormat === true) {
    return null;
  }

  if (!shouldRequireGateResultContract(input)) {
    return null;
  }

  return {
    type: "json_schema",
    name: "gate_result_contract",
    schema: buildGateResultJsonSchema()
  };
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  streamLabel: string
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const timer = setTimeout(() => {
      void reader.cancel(`${streamLabel} stalled`).catch(() => {
        // ignore cancellation failures
      });
      reject(new Error(`${streamLabel} stalled: no events received for ${idleTimeoutMs}ms`));
    }, idleTimeoutMs);

    reader.read().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void,
  idleTimeoutMs: number,
  streamLabel: string
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
    const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs, streamLabel);
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

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function maybeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveMcpServerIds(input: ProviderExecutionInput): string[] {
  if (!Array.isArray(input.mcpServerIds) || input.mcpServerIds.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of input.mcpServerIds) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function buildMcpCallInputSchema(serverIds: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["server_id", "tool", "arguments"],
    properties: {
      server_id: {
        type: "string",
        enum: serverIds
      },
      tool: {
        type: "string",
        minLength: 1
      },
      arguments: {
        type: "object",
        additionalProperties: true
      }
    }
  };
}

function buildOpenAiMcpTool(serverIds: string[]): Record<string, unknown> {
  return {
    type: "function",
    name: MCP_TOOL_NAME,
    description: "Request orchestrator-side MCP tool execution.",
    parameters: buildMcpCallInputSchema(serverIds),
    strict: true
  };
}

function buildClaudeMcpTool(serverIds: string[]): Record<string, unknown> {
  return {
    name: MCP_TOOL_NAME,
    description: "Request orchestrator-side MCP tool execution.",
    input_schema: buildMcpCallInputSchema(serverIds)
  };
}

function parseJsonRecordLoose(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return maybeRecord(parsed);
  } catch {
    return null;
  }
}

function normalizeMcpToolCall(candidate: Record<string, unknown>): ProviderMcpToolCall | null {
  const serverId = maybeString(candidate.server_id);
  const tool = maybeString(candidate.tool);
  if (!serverId || !tool) {
    return null;
  }

  const argumentsRecord = maybeRecord(candidate.arguments) ?? {};
  return {
    serverId,
    tool,
    arguments: argumentsRecord
  };
}

function encodeMcpToolCallsAsJson(toolCalls: ProviderMcpToolCall[]): string {
  return JSON.stringify(
    {
      mcp_calls: toolCalls.map((call) => ({
        server_id: call.serverId,
        tool: call.tool,
        arguments: call.arguments
      }))
    },
    null,
    2
  );
}

function dedupeMcpToolCalls(toolCalls: ProviderMcpToolCall[]): ProviderMcpToolCall[] {
  const seen = new Set<string>();
  const deduped: ProviderMcpToolCall[] = [];
  for (const call of toolCalls) {
    const signature = `${call.serverId}::${call.tool}::${JSON.stringify(call.arguments)}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(call);
  }
  return deduped;
}

function extractOpenAiMcpToolCallsFromOutputItem(item: Record<string, unknown>): ProviderMcpToolCall[] {
  const itemType = maybeString(item.type)?.toLowerCase() ?? "";
  const isFunctionCall = itemType === "function_call" || itemType === "tool_call" || itemType.endsWith("tool_call");
  if (!isFunctionCall) {
    return [];
  }

  const name = maybeString(item.name) ?? maybeString(maybeRecord(item.function)?.name);
  if (name !== MCP_TOOL_NAME) {
    return [];
  }

  const argsRecord = parseJsonRecordLoose(item.arguments ?? maybeRecord(item.function)?.arguments);
  if (!argsRecord) {
    return [];
  }

  const normalized = normalizeMcpToolCall(argsRecord);
  return normalized ? [normalized] : [];
}

function extractOpenAiMcpToolCalls(responseBody: unknown): ProviderMcpToolCall[] {
  const root = maybeRecord(responseBody);
  if (!root) {
    return [];
  }

  const output = root.output;
  if (!Array.isArray(output)) {
    return [];
  }

  const toolCalls: ProviderMcpToolCall[] = [];
  for (const itemValue of output) {
    const item = maybeRecord(itemValue);
    if (!item) {
      continue;
    }
    toolCalls.push(...extractOpenAiMcpToolCallsFromOutputItem(item));
  }

  return dedupeMcpToolCalls(toolCalls);
}

function extractClaudeMcpToolCalls(responseBody: unknown): ProviderMcpToolCall[] {
  const root = maybeRecord(responseBody);
  if (!root) {
    return [];
  }

  const content = root.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const toolCalls: ProviderMcpToolCall[] = [];
  for (const itemValue of content) {
    const item = maybeRecord(itemValue);
    if (!item) {
      continue;
    }

    const type = maybeString(item.type)?.toLowerCase();
    const name = maybeString(item.name);
    if (type !== "tool_use" || name !== MCP_TOOL_NAME) {
      continue;
    }

    const input = maybeRecord(item.input);
    if (!input) {
      continue;
    }

    const normalized = normalizeMcpToolCall(input);
    if (normalized) {
      toolCalls.push(normalized);
    }
  }

  return dedupeMcpToolCalls(toolCalls);
}

function summarizeOpenAiStreamEvent(type: string, payload: Record<string, unknown>): string | undefined {
  if (type === "response.created") {
    return "Request accepted; model started processing.";
  }

  if (type === "response.output_text.delta") {
    return "Model is generating response.";
  }

  if (type === "response.completed") {
    return "Model finished generation.";
  }

  if (type.includes("output_item")) {
    const item = maybeRecord(payload.item);
    const itemType = maybeString(item?.type)?.toLowerCase();
    if (itemType?.includes("tool")) {
      return "Model is running tools.";
    }
  }

  return undefined;
}

function summarizeClaudeStreamEvent(eventType: string, payload: Record<string, unknown>): string | undefined {
  if (eventType === "message_start") {
    return "Request accepted; model started processing.";
  }

  if (eventType === "content_block_delta") {
    return "Model is generating response.";
  }

  if (eventType === "message_stop") {
    return "Model finished generation.";
  }

  if (eventType === "content_block_start") {
    const block = maybeRecord(payload.content_block);
    const blockType = maybeString(block?.type)?.toLowerCase();
    if (blockType === "tool_use") {
      const toolName = maybeString(block?.name);
      return toolName ? `Model invoked tool ${toolName}.` : "Model invoked a tool.";
    }
  }

  return undefined;
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

async function readOpenAiStreamingOutput(
  response: Response,
  log?: (message: string) => void
): Promise<StreamingProviderResult> {
  if (!response.body) {
    return { text: "", mcpToolCalls: [] };
  }

  const startedAt = Date.now();
  let lastEventLogAt = 0;
  let eventCount = 0;
  let output = "";
  let finalOutput = "";
  const mcpToolCalls: ProviderMcpToolCall[] = [];
  const emittedSummaries = new Set<string>();
  const emitSummary = (summary: string | undefined): void => {
    if (!summary || !log) {
      return;
    }
    if (emittedSummaries.has(summary)) {
      return;
    }
    emittedSummaries.add(summary);
    log(`Model summary: ${summary}`);
  };
  emitSummary("Request accepted; model started processing.");

  await consumeSseStream(
    response.body,
    (message) => {
      if (message.data === "[DONE]") {
        return;
      }

      const payload = parseJsonSafe(message.data);
      if (!payload) {
        return;
      }
      emitSummary(extractEnglishSummaryFromRecord(payload));

      const type = typeof payload.type === "string" ? payload.type : message.event;
      emitSummary(summarizeOpenAiStreamEvent(type, payload));
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

      if (type === "response.output_item.done" || type === "response.output_item.added") {
        const item = maybeRecord(payload.item);
        if (item) {
          mcpToolCalls.push(...extractOpenAiMcpToolCallsFromOutputItem(item));
        }
      }

      if (type === "response.completed") {
        const responsePayload =
          typeof payload.response === "object" && payload.response !== null ? payload.response : payload;
        finalOutput = extractOpenAIText(responsePayload);
        mcpToolCalls.push(...extractOpenAiMcpToolCalls(responsePayload));
        if (typeof responsePayload === "object" && responsePayload !== null && !Array.isArray(responsePayload)) {
          emitSummary(extractEnglishSummaryFromRecord(responsePayload as Record<string, unknown>));
        }
      }
    },
    STREAM_IDLE_TIMEOUT_MS,
    "OpenAI stream"
  );

  const resolved = output.trim().length > 0 ? output : finalOutput;
  emitSummary(buildEnglishSummaryFromOutput(resolved));
  log?.(`OpenAI stream completed in ${Date.now() - startedAt}ms (events=${eventCount}, outputChars=${resolved.length})`);
  return {
    text: resolved,
    mcpToolCalls: dedupeMcpToolCalls(mcpToolCalls)
  };
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

async function readClaudeStreamingOutput(
  response: Response,
  log?: (message: string) => void
): Promise<StreamingProviderResult> {
  if (!response.body) {
    return { text: "", mcpToolCalls: [] };
  }

  const startedAt = Date.now();
  let lastEventLogAt = 0;
  let eventCount = 0;
  let output = "";
  const mcpToolCalls: ProviderMcpToolCall[] = [];
  const toolUseInputsByIndex = new Map<number, { name: string; input: Record<string, unknown> | null; inputJson: string }>();
  const emittedSummaries = new Set<string>();
  const emitSummary = (summary: string | undefined): void => {
    if (!summary || !log) {
      return;
    }
    if (emittedSummaries.has(summary)) {
      return;
    }
    emittedSummaries.add(summary);
    log(`Model summary: ${summary}`);
  };
  emitSummary("Request accepted; model started processing.");

  await consumeSseStream(
    response.body,
    (message) => {
      if (message.data === "[DONE]") {
        return;
      }

      const payload = parseJsonSafe(message.data);
      if (!payload) {
        return;
      }
      emitSummary(extractEnglishSummaryFromRecord(payload));

      const eventType = message.event || (typeof payload.type === "string" ? payload.type : "message");
      emitSummary(summarizeClaudeStreamEvent(eventType, payload));
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
        const index = typeof payload.index === "number" && Number.isFinite(payload.index) ? payload.index : null;
        const delta = maybeRecord(payload.delta);
        const deltaType = maybeString(delta?.type);
        if (index !== null && deltaType === "input_json_delta") {
          const block = toolUseInputsByIndex.get(index);
          const partialJson = maybeString(delta?.partial_json);
          if (block && partialJson) {
            block.inputJson += partialJson;
          }
        }
        output += extractClaudeDelta(payload);
        return;
      }

      if (eventType === "content_block_start") {
        const block = maybeRecord(payload.content_block);
        const blockType = maybeString(block?.type)?.toLowerCase();
        if (blockType !== "tool_use") {
          return;
        }
        const toolName = maybeString(block?.name);
        if (!toolName) {
          return;
        }
        const index = typeof payload.index === "number" && Number.isFinite(payload.index) ? payload.index : null;
        if (index === null) {
          const normalized = normalizeMcpToolCall(maybeRecord(block?.input) ?? {});
          if (toolName === MCP_TOOL_NAME && normalized) {
            mcpToolCalls.push(normalized);
          }
          return;
        }
        toolUseInputsByIndex.set(index, {
          name: toolName,
          input: maybeRecord(block?.input),
          inputJson: ""
        });
        return;
      }

      if (eventType === "content_block_stop") {
        const index = typeof payload.index === "number" && Number.isFinite(payload.index) ? payload.index : null;
        if (index === null) {
          return;
        }
        const block = toolUseInputsByIndex.get(index);
        if (!block || block.name !== MCP_TOOL_NAME) {
          return;
        }
        const payloadInput = block.input ?? parseJsonRecordLoose(block.inputJson);
        if (!payloadInput) {
          return;
        }
        const normalized = normalizeMcpToolCall(payloadInput);
        if (normalized) {
          mcpToolCalls.push(normalized);
        }
      }
    },
    STREAM_IDLE_TIMEOUT_MS,
    "Claude stream"
  );

  emitSummary(buildEnglishSummaryFromOutput(output));
  log?.(`Claude stream completed in ${Date.now() - startedAt}ms (events=${eventCount}, outputChars=${output.length})`);
  return {
    text: output,
    mcpToolCalls: dedupeMcpToolCalls(mcpToolCalls)
  };
}

export async function executeOpenAIWithApi(input: ProviderExecutionInput, credential: string): Promise<string> {
  const endpoint = `${(input.provider.baseUrl || OPENAI_DEFAULT_URL).replace(/\/$/, "")}/responses`;
  const requestSignal = mergeAbortSignals([input.signal]);
  const mcpServerIds = resolveMcpServerIds(input);
  const requestBody: Record<string, unknown> = {
    model: input.step.model || input.provider.defaultModel,
    input: [
      { role: "system", content: input.step.prompt },
      { role: "user", content: input.context }
    ],
    reasoning: {
      effort: mapOpenAIReasoningEffort(input.step.reasoningEffort)
    },
    stream: true
  };
  const responseFormat = buildOpenAiResponseFormat(input);
  if (responseFormat) {
    requestBody.response_format = responseFormat;
    requestBody.parallel_tool_calls = false;
  }
  if (mcpServerIds.length > 0) {
    requestBody.tools = [buildOpenAiMcpTool(mcpServerIds)];
    requestBody.tool_choice = "auto";
    requestBody.parallel_tool_calls = false;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`
    },
    body: JSON.stringify(requestBody),
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
    if (streamed.mcpToolCalls.length > 0) {
      return encodeMcpToolCallsAsJson(streamed.mcpToolCalls);
    }
    if (streamed.text.trim().length > 0) {
      return streamed.text;
    }
    input.log?.("OpenAI stream returned no text payload.");
    return "Provider returned no text output.";
  }

  const body = (await response.json()) as unknown;
  const toolCalls = extractOpenAiMcpToolCalls(body);
  if (toolCalls.length > 0) {
    return encodeMcpToolCallsAsJson(toolCalls);
  }
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
  const mcpServerIds = resolveMcpServerIds(input);
  if (mcpServerIds.length > 0) {
    requestBody.tools = [buildClaudeMcpTool(mcpServerIds)];
    requestBody.tool_choice = { type: "auto" };
  }

  const outputConfig: Record<string, unknown> = {};
  if (options?.disableEffort !== true) {
    outputConfig.effort = mapClaudeEffort(input.step.reasoningEffort);
  }
  const outputFormat = buildClaudeOutputFormat(input, options);
  if (outputFormat) {
    outputConfig.format = outputFormat;
  }
  if (Object.keys(outputConfig).length > 0) {
    requestBody.output_config = outputConfig;
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
    if (streamed.mcpToolCalls.length > 0) {
      return encodeMcpToolCallsAsJson(streamed.mcpToolCalls);
    }
    if (streamed.text.trim().length > 0) {
      return streamed.text;
    }
    input.log?.("Claude stream returned no text payload.");
    return "Provider returned no text output.";
  }

  const body = (await response.json()) as unknown;
  const toolCalls = extractClaudeMcpToolCalls(body);
  if (toolCalls.length > 0) {
    return encodeMcpToolCallsAsJson(toolCalls);
  }
  return extractClaudeText(body);
}
