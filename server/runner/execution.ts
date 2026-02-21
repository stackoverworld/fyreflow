import { executeProviderStep } from "../providers.js";
import { executeMcpToolCall, type McpToolResult } from "../mcp.js";
import { createAbortError, mergeAbortSignals } from "../abort.js";
import { replaceInputTokens } from "../runInputs.js";
import type { LocalStore } from "../storage.js";
import type {
  McpServerConfig,
  PipelineLink,
  PipelineQualityGate,
  PipelineStep,
  ProviderConfig,
  StepQualityGateResult,
  WorkflowOutcome
} from "../types.js";
import type { RunInputs } from "../runInputs.js";
import type { StepStoragePaths } from "./types.js";
import { buildDelegationNotes } from "./context.js";
import { formatMcpToolResults, parseMcpCallsFromOutput } from "./mcpOutput.js";
import {
  evaluatePipelineQualityGates,
  evaluateStepContracts,
  extractInputRequestSignal,
  inferWorkflowOutcome,
  routeMatchesCondition
} from "./qualityGates.js";
import { listManualApprovalGates, waitForManualApprovals } from "./remediation.js";

const DEFAULT_STAGE_TIMEOUT_MS = 420_000;

export async function executeStep(
  step: PipelineStep,
  provider: ProviderConfig | undefined,
  context: string,
  task: string,
  stageTimeoutMs: number,
  mcpServersById: Map<string, McpServerConfig>,
  runInputs: RunInputs,
  abortSignal?: AbortSignal
): Promise<string> {
  if (!provider) {
    return `Provider ${step.providerId} is not configured. Configure credentials in Provider Settings.`;
  }

  const resolveEffectiveStageTimeoutMs = (): number => {
    const boundedBase = Math.max(10_000, Math.min(1_200_000, Math.floor(stageTimeoutMs || DEFAULT_STAGE_TIMEOUT_MS)));
    const model = (step.model || provider.defaultModel || "").toLowerCase();
    const isHighEffort = step.reasoningEffort === "high" || step.reasoningEffort === "xhigh";
    let effective = boundedBase;

    if (provider.id === "claude") {
      if (model.includes("opus")) {
        effective = Math.max(effective, isHighEffort ? 900_000 : 780_000);
      } else {
        effective = Math.max(effective, 420_000);
      }
      if (step.use1MContext) {
        effective = Math.max(effective, 900_000);
      }
      if (step.contextWindowTokens >= 500_000) {
        effective = Math.max(effective, 900_000);
      }
    } else if (step.use1MContext) {
      effective = Math.max(effective, 600_000);
    }

    return Math.min(effective, 1_200_000);
  };
  const effectiveStageTimeoutMs = resolveEffectiveStageTimeoutMs();

  const executableStep: PipelineStep = {
    ...step,
    prompt: replaceInputTokens(step.prompt, runInputs)
  };

  const allowedServerIds = new Set(
    Array.isArray(step.enabledMcpServerIds)
      ? step.enabledMcpServerIds
          .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
      : []
  );

  const availableServers = [...allowedServerIds]
    .map((id) => mcpServersById.get(id))
    .filter((server): server is McpServerConfig => Boolean(server));

  const mcpGuidance =
    availableServers.length > 0
      ? [
          "MCP tools are available for this step.",
          `Allowed MCP server ids: ${availableServers.map((server) => server.id).join(", ")}`,
          "To request MCP tool execution, return STRICT JSON:",
          '{ "mcp_calls": [ { "server_id": "server-id", "tool": "tool_name", "arguments": { } } ] }',
          "If you can finish without MCP calls, return the final step output directly."
        ].join("\n")
      : "No MCP servers are enabled for this step.";

  const inputRequestGuidance = [
    "If execution is blocked by missing user-provided values, do NOT guess.",
    "Return STRICT JSON so UI can request those values:",
    "{",
    '  "status": "needs_input",',
    '  "summary": "short reason",',
    '  "input_requests": [',
    "    {",
    '      "key": "input_key",',
    '      "label": "Human label",',
    '      "type": "text|multiline|secret|path|url|select",',
    '      "required": true,',
    '      "reason": "why needed",',
    '      "options": [ { "value": "x", "label": "X" } ],',
    '      "allowCustom": true',
    "    }",
    "  ]",
    "}",
    "Secret requests (type=secret) are persisted in secure per-pipeline storage for future runs.",
    "Use input_requests only when blocked and additional user data is required."
  ].join("\n");

  let workingContext = `${context}\n\n${mcpGuidance}\n\n${inputRequestGuidance}`;
  let lastOutput = "";
  const maxToolRounds = 2;
  const maxCallsPerRound = 4;

  for (let round = 0; round <= maxToolRounds; round += 1) {
    if (abortSignal?.aborted) {
      throw createAbortError("Run stopped by user");
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(createAbortError(`${step.name} (${step.role}) timed out after ${effectiveStageTimeoutMs}ms`));
    }, effectiveStageTimeoutMs);
    const stepSignal = mergeAbortSignals([abortSignal, timeoutController.signal]);

    let output: string;
    try {
      output = await executeProviderStep({
        provider,
        step: executableStep,
        context: workingContext,
        task,
        signal: stepSignal
      });
    } finally {
      clearTimeout(timer);
    }

    lastOutput = output;
    const calls = parseMcpCallsFromOutput(output);

    if (calls.length === 0) {
      return output;
    }

    const limitedCalls = calls.slice(0, maxCallsPerRound);
    const results: McpToolResult[] = [];

    for (const call of limitedCalls) {
      if (abortSignal?.aborted) {
        throw createAbortError("Run stopped by user");
      }

      if (!allowedServerIds.has(call.serverId)) {
        results.push({
          serverId: call.serverId,
          tool: call.tool,
          ok: false,
          error: `MCP server "${call.serverId}" is not enabled for this step`
        });
        continue;
      }

      const result = await executeMcpToolCall(
        mcpServersById.get(call.serverId),
        call,
        effectiveStageTimeoutMs,
        abortSignal
      );
      results.push(result);
    }

    workingContext = [
      context,
      "",
      mcpGuidance,
      "",
      inputRequestGuidance,
      "",
      `MCP round ${round + 1} results:`,
      formatMcpToolResults(results),
      "",
      "Use these MCP results to continue. If more MCP calls are required, return updated mcp_calls JSON.",
      "Otherwise return final output for this step."
    ].join("\n");
  }

  return lastOutput;
}

export interface StepExecutionInput {
  store: LocalStore;
  runId: string;
  step: PipelineStep;
  attempt: number;
  provider: ProviderConfig | undefined;
  context: string;
  task: string;
  stageTimeoutMs: number;
  mcpServersById: Map<string, McpServerConfig>;
  runInputs: RunInputs;
  outgoingLinks: PipelineLink[];
  qualityGates: PipelineQualityGate[];
  stepById: Map<string, PipelineStep>;
  storagePaths: StepStoragePaths;
  abortSignal?: AbortSignal;
}

export interface StepExecutionOutput {
  output: string;
  qualityGateResults: StepQualityGateResult[];
  hasBlockingGateFailure: boolean;
  shouldStopForInput: boolean;
  inputSummary?: string;
  workflowOutcome: WorkflowOutcome;
  outgoingLinks: PipelineLink[];
  routedLinks: PipelineLink[];
  subagentNotes: string[];
}

export async function evaluateStepExecution(input: StepExecutionInput): Promise<StepExecutionOutput> {
  const {
    store,
    runId,
    step,
    attempt,
    provider,
    context,
    task,
    stageTimeoutMs,
    mcpServersById,
    runInputs,
    outgoingLinks,
    qualityGates,
    stepById,
    storagePaths,
    abortSignal
  } = input;

  const output = await executeStep(
    step,
    provider,
    context,
    task,
    stageTimeoutMs,
    mcpServersById,
    runInputs,
    abortSignal
  );
  const inferredOutcome = inferWorkflowOutcome(output);
  const contractEvaluation = await evaluateStepContracts(step, output, storagePaths, runInputs);
  const pipelineGateResults = await evaluatePipelineQualityGates(
    step,
    output,
    contractEvaluation.parsedJson,
    qualityGates,
    storagePaths,
    runInputs
  );
  const manualApprovalGates = listManualApprovalGates(step, qualityGates);
  const manualApprovalResults = await waitForManualApprovals(
    store,
    runId,
    step,
    manualApprovalGates,
    attempt,
    abortSignal
  );
  const qualityGateResults = [...contractEvaluation.gateResults, ...pipelineGateResults, ...manualApprovalResults];
  const hasBlockingGateFailure = qualityGateResults.some((result) => result.status === "fail" && result.blocking);
  const inputSignal = extractInputRequestSignal(output, contractEvaluation.parsedJson);
  const shouldStopForInput = inputSignal.needsInput;
  const workflowOutcome: WorkflowOutcome = hasBlockingGateFailure || shouldStopForInput ? "fail" : inferredOutcome;
  const routedLinks = shouldStopForInput
    ? []
    : outgoingLinks.filter((link) => routeMatchesCondition(link.condition, workflowOutcome));
  const subagentNotes = shouldStopForInput
    ? []
    : buildDelegationNotes(step, routedLinks, outgoingLinks.length, stepById);

  return {
    output,
    qualityGateResults,
    hasBlockingGateFailure,
    shouldStopForInput,
    inputSummary: inputSignal.summary,
    workflowOutcome,
    outgoingLinks: shouldStopForInput ? [] : outgoingLinks,
    routedLinks,
    subagentNotes
  };
}
