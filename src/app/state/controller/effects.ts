import { getState, getSmartRunPlan } from "@/lib/api";
import { getActiveConnectionSettings } from "@/lib/connectionSettingsStorage";
import { createDraftWorkflowKey, emptyDraft, toDraft } from "@/lib/pipelineDraft";
import { buildSmartRunPlanSignature, normalizeSmartRunInputs, setSmartRunPlanCacheEntry } from "@/lib/smartRunInputs";
import { parseRunInputRequestsFromText } from "@/lib/runInputRequests";
import type { DashboardState, PipelinePayload, PipelineRun, RunStatus, SmartRunPlan } from "@/lib/types";
import {
  buildRuntimeInputPromptSignature,
  seedRunInputsWithDefaults,
  selectRuntimeInputPromptCandidateRuns,
  trimRuntimeInputPromptSeenCache
} from "../appStateRunHelpers";
import { extractCompletedRunSummary, hasTransitionedFromActive } from "../appStateEffects";
import { selectScheduleRunPlanSignature } from "../appStateSelectors";
import {
  RUNTIME_INPUT_PROMPT_CACHE_LIMIT,
  truncateNotificationBody,
  type DesktopNotificationEvent
} from "../appStateTypes";
import { type DesktopNotificationSettings } from "@/lib/appSettingsStorage";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type { RunInputModalContext } from "../appStateTypes";

type SetRuns = Dispatch<SetStateAction<DashboardState["runs"]>>;

interface UseDesktopNotificationCallbackArgs {
  desktopNotifications: DesktopNotificationSettings;
}

interface RunStatusNotificationOptions {
  onRunCompleted?: (run: PipelineRun) => void;
}

function isUnauthorizedMessage(rawMessage: string): boolean {
  const normalized = rawMessage.trim().toLowerCase();
  return normalized === "unauthorized" || normalized.includes("401");
}

export function mapInitialStateLoadErrorMessage(error: unknown): string {
  const baseMessage = error instanceof Error ? error.message : "Failed to load state";
  if (!isUnauthorizedMessage(baseMessage)) {
    return baseMessage;
  }

  const connection = getActiveConnectionSettings();
  if (connection.mode !== "remote") {
    return baseMessage;
  }

  if (connection.apiToken.trim().length === 0) {
    return "Remote backend requires authorization. Open Settings > Remote and set \"Connection auth token\" (DASHBOARD_API_TOKEN) or complete pairing.";
  }

  return "Remote backend rejected current Connection auth token. Check Settings > Remote.";
}

export function useDesktopNotificationCallback(args: UseDesktopNotificationCallbackArgs) {
  const { desktopNotifications } = args;

  return useCallback(
    (event: DesktopNotificationEvent, title: string, body?: string) => {
      if (!desktopNotifications.enabled || !desktopNotifications[event]) {
        return;
      }

      if (!window.desktop?.isElectron || typeof window.desktop.notify !== "function") {
        return;
      }

      void window.desktop
        .notify({
          title,
          body: body ? truncateNotificationBody(body) : undefined
        })
        .catch(() => undefined);
    },
    [desktopNotifications]
  );
}

export function syncRunStatusNotifications(
  runs: DashboardState["runs"],
  runStatusSnapshotRef: MutableRefObject<Map<string, RunStatus>>,
  notifyDesktop: (event: "runFailed" | "runCompleted", title: string, body?: string) => void,
  options?: RunStatusNotificationOptions
): void {
  const previousStatusByRunId = runStatusSnapshotRef.current;
  const nextStatusByRunId = new Map<string, RunStatus>();

  for (const run of runs) {
    nextStatusByRunId.set(run.id, run.status);

    const previousStatus = previousStatusByRunId.get(run.id);
    if (!previousStatus || previousStatus === run.status) {
      continue;
    }

    const transitionedFromActive = hasTransitionedFromActive(previousStatus, run.status);
    if (!transitionedFromActive) {
      continue;
    }

    if (run.status === "failed") {
      const failedStep = [...run.steps].reverse().find((step) => step.status === "failed");
      const latestLogLine = [...run.logs].reverse().find((entry) => entry.trim().length > 0);
      notifyDesktop("runFailed", `Flow failed: ${run.pipelineName}`, failedStep?.error ?? latestLogLine ?? "Run failed.");
      continue;
    }

    if (run.status === "completed") {
      const summary = extractCompletedRunSummary(run.task);
      notifyDesktop("runCompleted", `Flow completed: ${run.pipelineName}`, summary);
      options?.onRunCompleted?.(run);
    }
  }

  runStatusSnapshotRef.current = nextStatusByRunId;
}

export async function loadInitialState(args: {
  setPipelines: Dispatch<SetStateAction<DashboardState["pipelines"]>>;
  setProviders: Dispatch<SetStateAction<DashboardState["providers"] | null>>;
  setMcpServers: Dispatch<SetStateAction<DashboardState["mcpServers"]>>;
  setStorageConfig: Dispatch<SetStateAction<DashboardState["storage"] | null>>;
  setRuns: SetRuns;
  setSelectedPipelineId: (pipelineId: string | null) => void;
  setDraftWorkflowKey: (next: string) => void;
  resetDraftHistory: (draft: PipelinePayload) => void;
  setBaselineDraft: (draft: PipelinePayload) => void;
  setIsNewDraft: (value: boolean) => void;
  setNotice: (message: string) => void;
  isCancelled: () => boolean;
}): Promise<void> {
  try {
    const state = await getState();
    if (args.isCancelled()) {
      return;
    }

    args.setPipelines(state.pipelines);
    args.setProviders(state.providers);
    args.setMcpServers(state.mcpServers);
    args.setStorageConfig(state.storage);
    args.setRuns(state.runs);

    const first = state.pipelines[0];
    if (first) {
      const firstDraft = toDraft(first);
      args.setSelectedPipelineId(first.id);
      args.resetDraftHistory(firstDraft);
      args.setBaselineDraft(firstDraft);
      args.setIsNewDraft(false);
    } else {
      const next = emptyDraft();
      args.setSelectedPipelineId(null);
      args.setDraftWorkflowKey(createDraftWorkflowKey());
      args.resetDraftHistory(next);
      args.setBaselineDraft(next);
      args.setIsNewDraft(true);
    }

    args.setNotice("");
  } catch (error) {
    args.setNotice(mapInitialStateLoadErrorMessage(error));
  }
}

export function inspectRuntimeInputPrompts(args: {
  runs: DashboardState["runs"];
  processingRunInputModal: boolean;
  runInputModal: RunInputModalContext | null;
  runtimeInputPromptSeenRef: MutableRefObject<Set<string>>;
  setRunInputModal: Dispatch<SetStateAction<RunInputModalContext | null>>;
  setNotice: (message: string) => void;
}): void {
  if (args.processingRunInputModal || args.runInputModal) {
    return;
  }

  const candidateRuns = selectRuntimeInputPromptCandidateRuns(args.runs);
  for (const activeRun of candidateRuns) {
    const stepsByLatest = [...activeRun.steps].reverse();
    for (const step of stepsByLatest) {
      if (!step.output || step.output.trim().length === 0) {
        continue;
      }

      const parsed = parseRunInputRequestsFromText(step.output);
      if (!parsed || parsed.requests.length === 0) {
        continue;
      }

      const signature = buildRuntimeInputPromptSignature(activeRun.id, step.stepId, step.attempts, parsed.requests);
      if (args.runtimeInputPromptSeenRef.current.has(signature)) {
        continue;
      }

      args.runtimeInputPromptSeenRef.current.add(signature);
      trimRuntimeInputPromptSeenCache(args.runtimeInputPromptSeenRef.current, RUNTIME_INPUT_PROMPT_CACHE_LIMIT);

      const seededInputs = seedRunInputsWithDefaults(activeRun.inputs, parsed.requests);

      args.setRunInputModal({
        source: "runtime",
        pipelineId: activeRun.pipelineId,
        runId: activeRun.id,
        task: activeRun.task,
        requests: parsed.requests,
        blockers: parsed.blockers,
        summary: parsed.summary || `${step.stepName} requested additional inputs.`,
        inputs: normalizeSmartRunInputs(seededInputs),
        confirmLabel: "Apply & Restart Run"
      });
      args.setNotice(`${step.stepName}: additional input required.`);
      return;
    }
  }
}

export async function loadSmartRunPlan(args: {
  selectedPipelineId: string | null;
  inputs?: Record<string, string>;
  force?: boolean;
  setPlan: (plan: SmartRunPlan | null) => void;
  setLoading: (loading: boolean) => void;
  requestIdRef: MutableRefObject<number>;
  inFlightSignatureRef: MutableRefObject<string>;
  lastSignatureRef: MutableRefObject<string>;
  cacheRef: MutableRefObject<Map<string, SmartRunPlan>>;
  setNotice: (message: string) => void;
}): Promise<void> {
  if (!args.selectedPipelineId) {
    args.setPlan(null);
    args.lastSignatureRef.current = "";
    args.inFlightSignatureRef.current = "";
    return;
  }

  const normalizedInputs = normalizeSmartRunInputs(args.inputs);
  const signature = buildSmartRunPlanSignature(args.selectedPipelineId, normalizedInputs);
  const force = args.force === true;

  if (!force) {
    if (args.inFlightSignatureRef.current === signature) {
      return;
    }

    const cachedPlan = args.cacheRef.current.get(signature);
    if (cachedPlan && args.lastSignatureRef.current === signature) {
      args.setPlan(cachedPlan);
      args.lastSignatureRef.current = signature;
      return;
    }
  }

  const requestId = args.requestIdRef.current + 1;
  args.requestIdRef.current = requestId;
  args.inFlightSignatureRef.current = signature;
  args.setLoading(true);

  try {
    const response = await getSmartRunPlan(args.selectedPipelineId, normalizedInputs);
    if (requestId !== args.requestIdRef.current) {
      return;
    }

    args.setPlan(response.plan);
    args.lastSignatureRef.current = signature;
    setSmartRunPlanCacheEntry(args.cacheRef.current, signature, response.plan);
  } catch (error) {
    if (requestId !== args.requestIdRef.current) {
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to build smart run plan";
    args.setNotice(message);
  } finally {
    if (args.inFlightSignatureRef.current === signature) {
      args.inFlightSignatureRef.current = "";
    }
    if (requestId === args.requestIdRef.current) {
      args.setLoading(false);
    }
  }
}

export async function loadScheduleRunPlan(args: {
  selectedPipelineId: string | null;
  runMode: "smart" | "quick";
  inputs?: Record<string, string>;
  force?: boolean;
  setPlan: (plan: SmartRunPlan | null) => void;
  setLoading: (loading: boolean) => void;
  requestIdRef: MutableRefObject<number>;
  inFlightSignatureRef: MutableRefObject<string>;
  lastSignatureRef: MutableRefObject<string>;
  cacheRef: MutableRefObject<Map<string, SmartRunPlan>>;
  setNotice: (message: string) => void;
}): Promise<void> {
  if (!args.selectedPipelineId) {
    args.setPlan(null);
    args.lastSignatureRef.current = "";
    args.inFlightSignatureRef.current = "";
    return;
  }

  const normalizedInputs = args.runMode === "smart" ? normalizeSmartRunInputs(args.inputs) : {};
  const signature = selectScheduleRunPlanSignature(args.selectedPipelineId, args.runMode, normalizedInputs);
  const force = args.force === true;

  if (!force) {
    if (args.inFlightSignatureRef.current === signature) {
      return;
    }

    const cachedPlan = args.cacheRef.current.get(signature);
    if (cachedPlan && args.lastSignatureRef.current === signature) {
      args.setPlan(cachedPlan);
      args.lastSignatureRef.current = signature;
      return;
    }
  }

  const requestId = args.requestIdRef.current + 1;
  args.requestIdRef.current = requestId;
  args.inFlightSignatureRef.current = signature;
  args.setLoading(true);

  try {
    const response = await getSmartRunPlan(args.selectedPipelineId, normalizedInputs);
    if (requestId !== args.requestIdRef.current) {
      return;
    }

    args.setPlan(response.plan);
    args.lastSignatureRef.current = signature;
    setSmartRunPlanCacheEntry(args.cacheRef.current, signature, response.plan);
  } catch (error) {
    if (requestId !== args.requestIdRef.current) {
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to validate cron schedule";
    args.setNotice(message);
  } finally {
    if (args.inFlightSignatureRef.current === signature) {
      args.inFlightSignatureRef.current = "";
    }
    if (requestId === args.requestIdRef.current) {
      args.setLoading(false);
    }
  }
}
