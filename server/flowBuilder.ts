import { nanoid } from "nanoid";
import { executeProviderStep } from "./providers.js";
import {
  canClaudeUseFastMode,
  getClaudeFastModeAvailabilityNote,
  isClaudeFastModeEnabledForInput
} from "./providerCapabilities.js";
import {
  parseFlowDecision,
  parseGeneratedFlow
} from "./flowBuilder/schema.js";
import {
  buildChatPlannerContext,
  buildChatRegenerationContext,
  buildChatRepairContext,
  buildJsonRepairContext,
  buildPlannerContext,
  buildPlannerRegenerationContext
} from "./flowBuilder/contexts.js";
import { buildDraftForAction, buildFlowDraft } from "./flowBuilder/drafts.js";
import { fallbackSpec } from "./flowBuilder/fallbackSpec.js";
import { clip } from "./flowBuilder/normalizers.js";
import {
  isMutationIntent,
  isReplaceIntent
} from "./flowBuilder/intents.js";
import {
  defaultMessageForAction,
  mergeRawOutputs
} from "./flowBuilder/responses.js";
import {
  createGeneratorStep,
  isSimulatedProviderOutput
} from "./flowBuilder/stepFactory.js";
import type {
  DraftOnlyResult,
  FlowBuilderAction,
  FlowBuilderRequest,
  FlowBuilderResponse,
  FlowBuilderStreamOptions
} from "./flowBuilder/contracts.js";
import type { FlowBuilderProviderRuntimeContext } from "./flowBuilder/prompts/providerRuntime.js";
import type {
  ProviderConfig,
  ProviderId
} from "./types.js";

export type {
  FlowBuilderAction,
  FlowBuilderRequest,
  FlowBuilderResponse,
  FlowBuilderStreamOptions,
  FlowChatMessage
} from "./flowBuilder/contracts.js";

interface PreparedFlowBuilderRequest {
  request: FlowBuilderRequest;
  providerRuntime: FlowBuilderProviderRuntimeContext;
  capabilityNotes: string[];
}

interface FlowBuilderStatusContext {
  emit: (message: string) => void;
  onProviderLog: (line: string) => void;
}

function normalizeFlowBuilderStatusMessage(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length <= 220) {
    return normalized;
  }
  return `${normalized.slice(0, 217)}...`;
}

interface ProviderLogClassification {
  kind: "status" | "thinking";
  message: string;
}

function classifyProviderLog(line: string): ProviderLogClassification | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("Model thinking:")) {
    const message = normalizeFlowBuilderStatusMessage(trimmed.slice("Model thinking:".length));
    return message ? { kind: "thinking", message } : null;
  }

  if (trimmed.startsWith("Model summary:")) {
    const message = normalizeFlowBuilderStatusMessage(trimmed.slice("Model summary:".length));
    return message ? { kind: "status", message } : null;
  }

  if (trimmed.startsWith("Provider dispatch started:")) {
    const providerMatch = /\bprovider=([^,\s]+)/i.exec(trimmed);
    const authModeMatch = /\bauthMode=([^,\s]+)/i.exec(trimmed);
    const modelMatch = /\bmodel=([^,\s]+)/i.exec(trimmed);
    const provider = providerMatch?.[1]?.trim();
    const authMode = authModeMatch?.[1]?.trim();
    const model = modelMatch?.[1]?.trim();
    if (!provider || !authMode || !model) {
      return { kind: "status", message: "Dispatching provider request." };
    }
    const providerLabel = provider === "openai" ? "OpenAI" : provider === "claude" ? "Anthropic" : provider;
    return { kind: "status", message: `Using ${providerLabel} (${authMode}) with ${model}.` };
  }

  if (trimmed.startsWith("Codex CLI does not support --json")) {
    return { kind: "status", message: "Codex CLI fallback mode enabled." };
  }

  return null;
}

function createFlowBuilderStatusContext(streamOptions?: FlowBuilderStreamOptions): FlowBuilderStatusContext {
  const seen = new Set<string>();

  const emit = (message: string): void => {
    const normalized = normalizeFlowBuilderStatusMessage(message);
    if (!normalized || !streamOptions?.onStatus) {
      return;
    }

    const signature = normalized.toLowerCase();
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    streamOptions.onStatus(normalized);
  };

  const onProviderLog = (line: string): void => {
    const classified = classifyProviderLog(line);
    if (!classified) {
      return;
    }
    if (classified.kind === "thinking") {
      streamOptions?.onThinking?.(classified.message);
      return;
    }
    emit(classified.message);
  };

  return {
    emit,
    onProviderLog
  };
}

function prepareFlowBuilderRequest(
  request: FlowBuilderRequest,
  provider: ProviderConfig
): PreparedFlowBuilderRequest {
  const fastModeRequested = request.providerId === "claude" && request.fastMode === true;
  const fastModeEffective =
    request.providerId === "claude"
      ? isClaudeFastModeEnabledForInput(provider, request.fastMode)
      : false;
  const providerRuntime: FlowBuilderProviderRuntimeContext = {
    providerId: request.providerId,
    authMode: provider.authMode,
    claudeFastModeAvailable: canClaudeUseFastMode(provider),
    fastModeRequested,
    fastModeEffective,
    fastModeNote: getClaudeFastModeAvailabilityNote(provider, request.fastMode)
  };

  return {
    request:
      request.providerId === "claude"
        ? {
            ...request,
            fastMode: fastModeEffective
          }
        : {
            ...request,
            fastMode: false
          },
    providerRuntime,
    capabilityNotes:
      fastModeRequested && !fastModeEffective
        ? ["Fast mode was requested but disabled because Claude API key auth is not active in Provider Auth."]
        : []
  };
}

async function generateDraftOnly(
  request: FlowBuilderRequest,
  provider: ProviderConfig,
  providerRuntime: FlowBuilderProviderRuntimeContext,
  capabilityNotes: string[],
  streamOptions: FlowBuilderStreamOptions | undefined,
  statusContext: FlowBuilderStatusContext
): Promise<DraftOnlyResult> {
  statusContext.emit("Generating workflow draft.");

  const generatorStep = createGeneratorStep(
    request,
    "AI Flow Architect",
    "You are a workflow architect. Output strict JSON that defines an agent graph with steps and links for the requested flow."
  );

  const rawOutput = await executeProviderStep({
    provider,
    step: generatorStep,
    task: "Generate an agent workflow graph",
    context: buildPlannerContext({
      ...request,
      providerRuntime
    }),
    outputMode: "json",
    onTextDelta: streamOptions?.onTextDelta,
    signal: streamOptions?.signal,
    log: statusContext.onProviderLog
  });

  if (isSimulatedProviderOutput(rawOutput)) {
    throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
  }

  const parsed = parseGeneratedFlow(rawOutput);
  if (parsed) {
    return {
      draft: buildFlowDraft(parsed, request),
      source: "model",
      notes: ["Generated from selected AI model.", ...capabilityNotes]
    };
  }

  let repairedOutput: string | undefined;
  let regeneratedOutput: string | undefined;

  try {
    statusContext.emit("Repairing invalid model output.");
    repairedOutput = await executeProviderStep({
      provider,
      step: {
        ...generatorStep,
        id: nanoid(),
        name: "AI Flow JSON Repair",
        prompt: "You are a JSON repair assistant. Convert the provided content into strict workflow JSON with no markdown."
      },
      task: "Repair workflow JSON",
      context: buildJsonRepairContext(rawOutput),
      outputMode: "json",
      log: statusContext.onProviderLog
    });

    if (isSimulatedProviderOutput(repairedOutput)) {
      throw new Error("Provider is not authenticated or CLI fallback is unavailable. Configure provider auth and try again.");
    }

    const repaired = parseGeneratedFlow(repairedOutput);
    if (repaired) {
      return {
        draft: buildFlowDraft(repaired, request),
        source: "model",
        notes: [
          "Generated from selected AI model.",
          "Applied JSON repair pass before building the flow.",
          ...capabilityNotes
        ]
      };
    }
  } catch {
    // Continue to deterministic fallback.
  }

  try {
    statusContext.emit("Regenerating workflow JSON.");
    regeneratedOutput = await executeProviderStep({
      provider,
      step: {
        ...generatorStep,
        id: nanoid(),
        name: "AI Flow JSON Regeneration",
        prompt: "Generate strict workflow JSON from scratch. Return exactly one valid JSON object and nothing else."
      },
      task: "Regenerate workflow JSON",
      context: buildPlannerRegenerationContext(
        {
          ...request,
          providerRuntime
        },
        rawOutput,
        repairedOutput
      ),
      outputMode: "json",
      log: statusContext.onProviderLog
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
          "Applied JSON regeneration pass after repair to recover valid workflow JSON.",
          ...capabilityNotes
        ]
      };
    }
  } catch {
    // Continue to deterministic fallback.
  }

  const fallback = fallbackSpec(request.prompt);
  statusContext.emit("Using deterministic fallback flow.");
  return {
    draft: buildFlowDraft(fallback, request),
    source: "fallback",
    notes: [
      "Model output was not valid JSON after repair/regeneration. Applied deterministic fallback flow.",
      ...capabilityNotes
    ],
    rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
  };
}

async function generateConversationResponse(
  request: FlowBuilderRequest,
  provider: ProviderConfig,
  providerRuntime: FlowBuilderProviderRuntimeContext,
  capabilityNotes: string[],
  streamOptions: FlowBuilderStreamOptions | undefined,
  statusContext: FlowBuilderStatusContext
): Promise<FlowBuilderResponse> {
  statusContext.emit("Generating copilot response.");

  const copilotStep = createGeneratorStep(
    request,
    "AI Flow Copilot",
    "You are a workflow copilot. Decide whether to answer, update current flow, or replace flow. Return strict JSON only."
  );

  const rawOutput = await executeProviderStep({
    provider,
    step: copilotStep,
    task: "Respond to user and decide flow action",
    context: buildChatPlannerContext({
      ...request,
      providerRuntime
    }),
    outputMode: "json",
    onTextDelta: streamOptions?.onTextDelta,
    signal: streamOptions?.signal,
    log: statusContext.onProviderLog
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
        questions: parsedDecision.questions,
        source: "model",
        notes: ["Generated from selected AI model.", ...capabilityNotes, ...next.notes]
      };
    }
  }

  let repairedOutput: string | undefined;
  let regeneratedOutput: string | undefined;

  try {
    statusContext.emit("Repairing invalid copilot output.");
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
      outputMode: "json",
      log: statusContext.onProviderLog
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
          questions: repairedDecision.questions,
          source: "model",
          notes: [
            "Generated from selected AI model.",
            "Applied JSON repair pass before finalizing response.",
            ...capabilityNotes,
            ...next.notes
          ]
        };
      }
    }
  } catch {
    // Continue to fallback logic.
  }

  try {
    statusContext.emit("Regenerating copilot output.");
    regeneratedOutput = await executeProviderStep({
      provider,
      step: {
        ...copilotStep,
        id: nanoid(),
        name: "AI Copilot JSON Regeneration",
        prompt: "Regenerate strict copilot JSON from scratch. Return exactly one valid JSON object and nothing else."
      },
      task: "Regenerate copilot JSON",
      context: buildChatRegenerationContext(
        {
          ...request,
          providerRuntime
        },
        rawOutput,
        repairedOutput
      ),
      outputMode: "json",
      log: statusContext.onProviderLog
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
          questions: regeneratedDecision.questions,
          source: "model",
          notes: [
            "Generated from selected AI model.",
            "Applied JSON regeneration pass after repair to recover copilot response.",
            ...capabilityNotes,
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
        ...capabilityNotes,
        ...next.notes
      ],
      rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
    };
  }

  if (!isMutationIntent(request.prompt)) {
    return {
      action: "answer",
      message: clip(rawOutput, 2000) || "I could not parse a structured response, but no flow changes were requested.",
      source: "fallback",
      notes: ["Model output was not valid copilot JSON. Returned textual answer fallback.", ...capabilityNotes],
      rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
    };
  }

  const fallback = fallbackSpec(request.prompt);
  const fallbackAction: FlowBuilderAction =
    request.currentDraft && !isReplaceIntent(request.prompt) ? "update_current_flow" : "replace_flow";
  const next = buildDraftForAction(fallbackAction, fallback, request);
  statusContext.emit("Using deterministic fallback response.");

  return {
    action: next.action,
    message: defaultMessageForAction(next.action, next.draft),
    draft: next.draft,
    source: "fallback",
    notes: [
      "Model output was not valid copilot JSON after repair/regeneration. Applied deterministic fallback response.",
      ...capabilityNotes,
      ...next.notes
    ],
    rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
  };
}

export async function generateFlowDraft(
  request: FlowBuilderRequest,
  providers: Record<ProviderId, ProviderConfig>,
  streamOptions?: FlowBuilderStreamOptions
): Promise<FlowBuilderResponse> {
  const provider = providers[request.providerId];
  if (!provider) {
    throw new Error(`Provider ${request.providerId} is unavailable`);
  }
  const prepared = prepareFlowBuilderRequest(request, provider);
  const statusContext = createFlowBuilderStatusContext(streamOptions);
  const providerLabel = request.providerId === "openai" ? "OpenAI" : "Anthropic";
  statusContext.emit(`Preparing ${providerLabel} request.`);

  const hasConversationContext =
    Boolean(prepared.request.currentDraft) || (prepared.request.history?.length ?? 0) > 0;
  if (hasConversationContext) {
    return generateConversationResponse(
      prepared.request,
      provider,
      prepared.providerRuntime,
      prepared.capabilityNotes,
      streamOptions,
      statusContext
    );
  }

  const generated = await generateDraftOnly(
    prepared.request,
    provider,
    prepared.providerRuntime,
    prepared.capabilityNotes,
    streamOptions,
    statusContext
  );
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
