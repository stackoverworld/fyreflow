import { nanoid } from "nanoid";
import { executeProviderStep } from "./providers.js";
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
  FlowBuilderResponse
} from "./flowBuilder/contracts.js";
import type {
  ProviderConfig,
  ProviderId
} from "./types.js";

export type {
  FlowBuilderAction,
  FlowBuilderRequest,
  FlowBuilderResponse,
  FlowChatMessage
} from "./flowBuilder/contracts.js";

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
    context: buildPlannerContext(request),
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
        prompt: "You are a JSON repair assistant. Convert the provided content into strict workflow JSON with no markdown."
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
      context: buildPlannerRegenerationContext(request, rawOutput, repairedOutput),
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
    rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
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
        questions: parsedDecision.questions,
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
          questions: repairedDecision.questions,
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
          questions: regeneratedDecision.questions,
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
      notes: ["Model output missed copilot action wrapper. Recovered flow JSON and inferred action.", ...next.notes],
      rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
    };
  }

  if (!isMutationIntent(request.prompt)) {
    return {
      action: "answer",
      message: clip(rawOutput, 2000) || "I could not parse a structured response, but no flow changes were requested.",
      source: "fallback",
      notes: ["Model output was not valid copilot JSON. Returned textual answer fallback."],
      rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
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
    rawOutput: mergeRawOutputs(rawOutput, repairedOutput, regeneratedOutput)
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
