import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bug,
  Cable,
  Layers,
  ListChecks,
  Loader2,
  Play,
  Plus,
  Redo2,
  Settings2,
  ShieldCheck,
  Square,
  Sparkles,
  Undo2,
  Workflow,
  X
} from "lucide-react";
import {
  createMcpServer,
  createPipeline,
  deleteMcpServer,
  deletePipeline,
  getRunStartupCheck,
  getSmartRunPlan,
  getState,
  listRuns,
  savePipelineSecureInputs,
  startRun,
  stopRun,
  updateMcpServer,
  updatePipeline,
  updateProvider,
  updateStorageConfig
} from "@/lib/api";
import { moveAiChatHistory } from "@/lib/aiChatStorage";
import { loadRunDraft, moveRunDraft, saveRunDraft } from "@/lib/runDraftStorage";
import { getDefaultContextWindowForModel, getDefaultModelForProvider, MODEL_CATALOG } from "@/lib/modelCatalog";
import { parseRunInputRequestsFromText } from "@/lib/runInputRequests";
import type {
  DashboardState,
  LinkCondition,
  Pipeline,
  PipelinePayload,
  ProviderId,
  ProviderOAuthStatus,
  RunInputRequest,
  RunStartupBlocker,
  SmartRunPlan
} from "@/lib/types";
import { PipelineList } from "@/components/dashboard/PipelineList";
import { PipelineEditor } from "@/components/dashboard/PipelineEditor";
import { ProviderSettings } from "@/components/dashboard/ProviderSettings";
import { RunPanel } from "@/components/dashboard/RunPanel";
import { AiBuilderPanel } from "@/components/dashboard/AiBuilderPanel";
import { DebugPanel } from "@/components/dashboard/DebugPanel";
import { McpSettings } from "@/components/dashboard/McpSettings";
import { QualityGatesPanel } from "@/components/dashboard/QualityGatesPanel";
import { RunInputRequestModal } from "@/components/dashboard/RunInputRequestModal";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Textarea } from "@/components/optics/textarea";
import { Tooltip } from "@/components/optics/tooltip";
import { SlidePanel } from "@/components/optics/slide-panel";
import { cn } from "@/lib/cn";

type WorkspacePanel = "pipelines" | "flow" | "contracts" | "providers" | "mcp" | "run" | "ai" | "debug" | null;
type ProviderOAuthStatusMap = Record<ProviderId, ProviderOAuthStatus | null>;
type ProviderOAuthMessageMap = Record<ProviderId, string>;
const DEFAULT_MAX_LOOPS = 2;
const DEFAULT_MAX_STEP_EXECUTIONS = 18;
const DEFAULT_STAGE_TIMEOUT_MS = 240000;
const DRAFT_HISTORY_LIMIT = 120;
const AUTOSAVE_DELAY_MS = 1000;
const SMART_RUN_PLAN_CACHE_LIMIT = 24;
const RUNTIME_INPUT_PROMPT_CACHE_LIMIT = 240;

function createStepId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createLinkId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDraftWorkflowKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft-${crypto.randomUUID()}`;
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultStepPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + index * 280,
    y: 130 + (index % 2 === 0 ? 0 : 24)
  };
}

function connectNodes(
  links: PipelinePayload["links"],
  sourceStepId: string,
  targetStepId: string,
  condition: LinkCondition = "always"
): PipelinePayload["links"] {
  if (sourceStepId === targetStepId) {
    return links;
  }

  if (
    links.some(
      (link) =>
        link.sourceStepId === sourceStepId &&
        link.targetStepId === targetStepId &&
        (link.condition ?? "always") === condition
    )
  ) {
    return links;
  }

  return [
    ...links,
    {
      id: createLinkId(),
      sourceStepId,
      targetStepId,
      condition
    }
  ];
}

function defaultRuntime() {
  return {
    maxLoops: DEFAULT_MAX_LOOPS,
    maxStepExecutions: DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs: DEFAULT_STAGE_TIMEOUT_MS
  };
}

function normalizeRuntime(runtime: Pipeline["runtime"] | PipelinePayload["runtime"] | undefined) {
  return {
    maxLoops: Math.max(0, Math.min(12, Math.floor(runtime?.maxLoops ?? DEFAULT_MAX_LOOPS))),
    maxStepExecutions: Math.max(4, Math.min(120, Math.floor(runtime?.maxStepExecutions ?? DEFAULT_MAX_STEP_EXECUTIONS))),
    stageTimeoutMs: Math.max(10_000, Math.min(1_200_000, Math.floor(runtime?.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS)))
  };
}

function createOrchestratorStep(index: number): PipelinePayload["steps"][number] {
  const providerId: ProviderId = "openai";
  const model = getDefaultModelForProvider(providerId);

  return {
    id: createStepId(),
    name: `${index + 1}. Main Orchestrator`,
    role: "orchestrator",
    prompt:
      "Act as the main orchestrator. Route work to connected subagents, decide pass/fail routing, and stop only when quality gates pass.",
    providerId,
    model,
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: getDefaultContextWindowForModel(providerId, model),
    position: defaultStepPosition(index),
    contextTemplate: "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}\n\nAll outputs:\n{{all_outputs}}",
    enableDelegation: true,
    delegationCount: 3,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: []
  };
}

function createDraftStep(index: number): PipelinePayload["steps"][number] {
  const providerId: ProviderId = "openai";
  const model = getDefaultModelForProvider(providerId);

  return {
    id: createStepId(),
    name: `${index + 1}. Analysis Bot`,
    role: "analysis",
    prompt: "Analyze the request and define constraints before planning.",
    providerId,
    model,
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: getDefaultContextWindowForModel(providerId, model),
    position: defaultStepPosition(index),
    contextTemplate: "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}",
    enableDelegation: false,
    delegationCount: 2,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: []
  };
}

function toDraft(pipeline: Pipeline): PipelinePayload {
  return {
    name: pipeline.name,
    description: pipeline.description,
    steps: pipeline.steps.map((step, index) => ({
      id: step.id,
      name: step.name,
      role: step.role,
      prompt: step.prompt,
      providerId: step.providerId,
      model: step.model,
      reasoningEffort: step.reasoningEffort,
      fastMode: step.fastMode,
      use1MContext: step.use1MContext,
      contextWindowTokens: step.contextWindowTokens,
      position: step.position ?? defaultStepPosition(index),
      contextTemplate: step.contextTemplate,
      enableDelegation: step.enableDelegation,
      delegationCount: step.delegationCount,
      enableIsolatedStorage: step.enableIsolatedStorage,
      enableSharedStorage: step.enableSharedStorage,
      enabledMcpServerIds: step.enabledMcpServerIds,
      outputFormat: step.outputFormat,
      requiredOutputFields: step.requiredOutputFields,
      requiredOutputFiles: step.requiredOutputFiles
    })),
    links: (pipeline.links ?? []).map((link) => ({
      id: link.id,
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition ?? "always"
    })),
    qualityGates: (pipeline.qualityGates ?? []).map((gate) => ({
      id: gate.id,
      name: gate.name,
      targetStepId: gate.targetStepId,
      kind: gate.kind,
      blocking: gate.blocking,
      pattern: gate.pattern,
      flags: gate.flags,
      jsonPath: gate.jsonPath,
      artifactPath: gate.artifactPath,
      message: gate.message
    })),
    runtime: normalizeRuntime(pipeline.runtime)
  };
}

function emptyDraft(): PipelinePayload {
  return {
    name: "",
    description: "",
    steps: [createDraftStep(0)],
    links: [],
    qualityGates: [],
    runtime: defaultRuntime()
  };
}

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeSmartRunInputs(inputs?: Record<string, string>): Record<string, string> {
  if (!inputs) {
    return {};
  }

  const normalizedEntries = Object.entries(inputs)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  const normalized: Record<string, string> = {};
  for (const [key, value] of normalizedEntries) {
    if (value.trim() === "[secure]") {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function buildSmartRunPlanSignature(pipelineId: string, inputs?: Record<string, string>): string {
  const normalized = normalizeSmartRunInputs(inputs);
  const entries = Object.entries(normalized);
  return `${pipelineId}:${JSON.stringify(entries)}`;
}

function setSmartRunPlanCacheEntry(cache: Map<string, SmartRunPlan>, signature: string, plan: SmartRunPlan): void {
  if (cache.has(signature)) {
    cache.delete(signature);
  }
  cache.set(signature, plan);

  while (cache.size > SMART_RUN_PLAN_CACHE_LIMIT) {
    const oldestSignature = cache.keys().next().value;
    if (typeof oldestSignature !== "string") {
      break;
    }
    cache.delete(oldestSignature);
  }
}

function hasRunInputValue(inputs: Record<string, string> | undefined, key: string): boolean {
  const value = inputs?.[key.trim().toLowerCase()];
  return typeof value === "string" && value.trim().length > 0 && value.trim() !== "[secure]";
}

function getPipelineSaveValidationError(draft: PipelinePayload): string | null {
  if (draft.name.trim().length < 2) {
    return "Flow name must have at least 2 characters.";
  }

  if (draft.steps.length === 0) {
    return "Add at least one step.";
  }

  if (draft.steps.some((step) => step.prompt.trim().length === 0 || step.name.trim().length === 0)) {
    return "Every step needs a name and prompt.";
  }

  return null;
}

interface DraftHistoryState {
  draft: PipelinePayload;
  undoStack: PipelinePayload[];
  redoStack: PipelinePayload[];
}

type DraftHistoryAction =
  | { type: "apply"; next: SetStateAction<PipelinePayload> }
  | { type: "reset"; draft: PipelinePayload }
  | { type: "undo" }
  | { type: "redo" };

function withHistoryLimit(stack: PipelinePayload[], draft: PipelinePayload): PipelinePayload[] {
  if (stack.length >= DRAFT_HISTORY_LIMIT) {
    return [...stack.slice(stack.length - DRAFT_HISTORY_LIMIT + 1), draft];
  }
  return [...stack, draft];
}

function resolveNextDraft(current: PipelinePayload, next: SetStateAction<PipelinePayload>): PipelinePayload {
  if (typeof next === "function") {
    return (next as (previous: PipelinePayload) => PipelinePayload)(current);
  }
  return next;
}

function draftHistoryReducer(state: DraftHistoryState, action: DraftHistoryAction): DraftHistoryState {
  if (action.type === "reset") {
    return {
      draft: action.draft,
      undoStack: [],
      redoStack: []
    };
  }

  if (action.type === "undo") {
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) {
      return state;
    }

    return {
      draft: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: withHistoryLimit(state.redoStack, state.draft)
    };
  }

  if (action.type === "redo") {
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) {
      return state;
    }

    return {
      draft: next,
      undoStack: withHistoryLimit(state.undoStack, state.draft),
      redoStack: state.redoStack.slice(0, -1)
    };
  }

  const nextDraft = resolveNextDraft(state.draft, action.next);
  if (jsonEquals(state.draft, nextDraft)) {
    return state;
  }

  return {
    draft: nextDraft,
    undoStack: withHistoryLimit(state.undoStack, state.draft),
    redoStack: []
  };
}

interface ToolButtonProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ active, disabled, label, onClick, children }: ToolButtonProps) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
          disabled
            ? "text-ink-700 cursor-not-allowed"
            : active
              ? "bg-ember-500/15 text-ember-300 cursor-pointer"
              : "text-ink-500 hover:bg-ink-700/40 hover:text-ink-200 cursor-pointer"
        )}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

type RunInputModalSource = "startup" | "runtime";

interface RunInputModalContext {
  source: RunInputModalSource;
  pipelineId: string;
  task: string;
  runId?: string;
  requests: RunInputRequest[];
  blockers: RunStartupBlocker[];
  summary: string;
  inputs: Record<string, string>;
  confirmLabel: string;
}

export default function App() {
  const [pipelines, setPipelines] = useState<DashboardState["pipelines"]>([]);
  const [providers, setProviders] = useState<DashboardState["providers"] | null>(null);
  const [mcpServers, setMcpServers] = useState<DashboardState["mcpServers"]>([]);
  const [storageConfig, setStorageConfig] = useState<DashboardState["storage"] | null>(null);
  const [runs, setRuns] = useState<DashboardState["runs"]>([]);
  const [smartRunPlan, setSmartRunPlan] = useState<SmartRunPlan | null>(null);
  const [loadingSmartRunPlan, setLoadingSmartRunPlan] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [draftWorkflowKey, setDraftWorkflowKey] = useState<string>(() => createDraftWorkflowKey());
  const [draftHistory, dispatchDraftHistory] = useReducer(draftHistoryReducer, {
    draft: emptyDraft(),
    undoStack: [],
    redoStack: []
  });
  const [baselineDraft, setBaselineDraft] = useState<PipelinePayload>(emptyDraft());
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [startingRunPipelineId, setStartingRunPipelineId] = useState<string | null>(null);
  const [stoppingRunPipelineId, setStoppingRunPipelineId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const smartRunPlanRequestIdRef = useRef(0);
  const smartRunPlanLastSignatureRef = useRef("");
  const smartRunPlanInFlightSignatureRef = useRef("");
  const smartRunPlanCacheRef = useRef<Map<string, SmartRunPlan>>(new Map());
  const smartRunPlanRef = useRef<SmartRunPlan | null>(null);
  const savingPipelineRef = useRef(false);
  const selectedPipelineIdRef = useRef<string | null>(null);
  const draftWorkflowKeyRef = useRef<string>(draftWorkflowKey);
  const [activePanel, setActivePanel] = useState<WorkspacePanel>(null);
  const [stepPanelOpen, setStepPanelOpen] = useState(false);
  const [canvasDragActive, setCanvasDragActive] = useState(false);
  const [providerOauthStatuses, setProviderOauthStatuses] = useState<ProviderOAuthStatusMap>({
    openai: null,
    claude: null
  });
  const [providerOauthMessages, setProviderOauthMessages] = useState<ProviderOAuthMessageMap>({
    openai: "",
    claude: ""
  });
  const [runInputModal, setRunInputModal] = useState<RunInputModalContext | null>(null);
  const [processingRunInputModal, setProcessingRunInputModal] = useState(false);
  const runtimeInputPromptSeenRef = useRef<Set<string>>(new Set());
  const draft = draftHistory.draft;
  const canUndo = draftHistory.undoStack.length > 0;
  const canRedo = draftHistory.redoStack.length > 0;

  const applyDraftChange = useCallback((next: SetStateAction<PipelinePayload>) => {
    dispatchDraftHistory({ type: "apply", next });
  }, []);

  const resetDraftHistory = useCallback((nextDraft: PipelinePayload) => {
    dispatchDraftHistory({ type: "reset", draft: nextDraft });
  }, []);

  const undoDraftChange = useCallback(() => {
    dispatchDraftHistory({ type: "undo" });
  }, []);

  const redoDraftChange = useCallback(() => {
    dispatchDraftHistory({ type: "redo" });
  }, []);

  useEffect(() => {
    selectedPipelineIdRef.current = selectedPipelineId;
  }, [selectedPipelineId]);

  useEffect(() => {
    runtimeInputPromptSeenRef.current = new Set();
  }, [selectedPipelineId]);

  useEffect(() => {
    draftWorkflowKeyRef.current = draftWorkflowKey;
  }, [draftWorkflowKey]);

  useEffect(() => {
    smartRunPlanRef.current = smartRunPlan;
  }, [smartRunPlan]);

  useEffect(() => {
    return () => {
      clearTimeout(autosaveTimerRef.current);
      clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    clearTimeout(noticeTimerRef.current);
    if (notice) {
      noticeTimerRef.current = setTimeout(() => setNotice(""), 3500);
    }
    return () => clearTimeout(noticeTimerRef.current);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const selectedPipelineLocked = Boolean(
        selectedPipelineId &&
          (runs.some(
            (run) => run.pipelineId === selectedPipelineId && (run.status === "queued" || run.status === "running")
          ) ||
            startingRunPipelineId === selectedPipelineId ||
            stoppingRunPipelineId === selectedPipelineId)
      );
      if (selectedPipelineLocked) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (isTypingField) {
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "z") {
        return;
      }

      if (event.shiftKey) {
        if (!canRedo) {
          return;
        }
        event.preventDefault();
        redoDraftChange();
        return;
      }

      if (!canUndo) {
        return;
      }

      event.preventDefault();
      undoDraftChange();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canRedo,
    canUndo,
    redoDraftChange,
    runs,
    selectedPipelineId,
    startingRunPipelineId,
    stoppingRunPipelineId,
    undoDraftChange
  ]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const state = await getState();
        if (cancelled) {
          return;
        }

        setPipelines(state.pipelines);
        setProviders(state.providers);
        setMcpServers(state.mcpServers);
        setStorageConfig(state.storage);
        setRuns(state.runs);

        const first = state.pipelines[0];
        if (first) {
          const firstDraft = toDraft(first);
          setSelectedPipelineId(first.id);
          resetDraftHistory(firstDraft);
          setBaselineDraft(firstDraft);
          setIsNewDraft(false);
        } else {
          const next = emptyDraft();
          setSelectedPipelineId(null);
          setDraftWorkflowKey(createDraftWorkflowKey());
          resetDraftHistory(next);
          setBaselineDraft(next);
          setIsNewDraft(true);
        }

        setNotice("");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load state";
        setNotice(message);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [resetDraftHistory]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void listRuns(40)
        .then((response) => {
          setRuns(response.runs);
        })
        .catch(() => {
          // Keep polling even if one request fails.
        });
    }, 2500);

    return () => window.clearInterval(timer);
  }, []);

  const isDirty = useMemo(() => !jsonEquals(draft, baselineDraft), [draft, baselineDraft]);
  const pipelineSaveValidationError = useMemo(() => getPipelineSaveValidationError(draft), [draft]);
  const hasOrchestrator = useMemo(() => draft.steps.some((step) => step.role === "orchestrator"), [draft.steps]);

  const selectedPipeline = useMemo(() => {
    if (!selectedPipelineId) {
      return undefined;
    }
    return pipelines.find((pipeline) => pipeline.id === selectedPipelineId);
  }, [pipelines, selectedPipelineId]);
  const activePipelineRun = useMemo(() => {
    if (!selectedPipelineId) {
      return null;
    }

    const running = runs.find((run) => run.pipelineId === selectedPipelineId && run.status === "running");
    if (running) {
      return running;
    }

    return runs.find((run) => run.pipelineId === selectedPipelineId && run.status === "queued") ?? null;
  }, [runs, selectedPipelineId]);
  const activeRunPipelineIds = useMemo(() => {
    const ids = new Set(runs.filter((run) => run.status === "queued" || run.status === "running").map((run) => run.pipelineId));
    if (startingRunPipelineId) {
      ids.add(startingRunPipelineId);
    }
    if (stoppingRunPipelineId) {
      ids.add(stoppingRunPipelineId);
    }
    return [...ids];
  }, [runs, startingRunPipelineId, stoppingRunPipelineId]);
  const startingRun = Boolean(selectedPipelineId && startingRunPipelineId === selectedPipelineId);
  const stoppingRun = Boolean(selectedPipelineId && stoppingRunPipelineId === selectedPipelineId);
  const selectedPipelineRunActive = Boolean(activePipelineRun);
  const selectedPipelineEditLocked = selectedPipelineRunActive || startingRun || stoppingRun;
  const applyEditableDraftChange = useCallback(
    (next: SetStateAction<PipelinePayload>) => {
      if (selectedPipelineEditLocked) {
        return;
      }

      applyDraftChange(next);
    },
    [applyDraftChange, selectedPipelineEditLocked]
  );
  const runtimeDraft = useMemo(() => normalizeRuntime(draft.runtime), [draft.runtime]);
  const aiWorkflowKey = selectedPipelineId ?? draftWorkflowKey;
  const runPanelToggleDisabled =
    !selectedPipelineId || startingRun || stoppingRun || savingPipeline || isDirty || canvasDragActive;
  const runTooltip = selectedPipelineRunActive
    ? "Run in progress."
    : !selectedPipelineId
      ? pipelineSaveValidationError
        ? `Fix before autosave: ${pipelineSaveValidationError}`
        : "Autosave pending..."
      : canvasDragActive
        ? "Finish moving nodes before running."
        : pipelineSaveValidationError
          ? `Fix before autosave: ${pipelineSaveValidationError}`
          : savingPipeline || isDirty
            ? "Autosaving changes..."
            : "Run flow";
  const autosaveStatusLabel = pipelineSaveValidationError
    ? `Autosave paused: ${pipelineSaveValidationError}`
    : canvasDragActive
      ? "Autosave paused while moving nodes..."
    : savingPipeline
      ? "Autosaving changes..."
      : isDirty
        ? "Autosave pending..."
        : "All changes saved";

  const handleStepPanelChange = useCallback((open: boolean) => {
    setStepPanelOpen(open);
    if (open) {
      setActivePanel((current) => (current === "run" ? null : current));
    }
  }, []);

  const togglePanel = (panel: Exclude<WorkspacePanel, null>) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  const selectPipeline = (pipelineId: string) => {
    const selected = pipelines.find((pipeline) => pipeline.id === pipelineId);
    if (!selected) {
      return;
    }

    clearTimeout(autosaveTimerRef.current);
    const nextDraft = toDraft(selected);
    setSelectedPipelineId(pipelineId);
    resetDraftHistory(nextDraft);
    setBaselineDraft(nextDraft);
    setIsNewDraft(false);
    setSmartRunPlan(null);
    setNotice("");
    setActivePanel(null);
  };

  const handleCreatePipelineDraft = () => {
    clearTimeout(autosaveTimerRef.current);
    const nextDraft = emptyDraft();
    setSelectedPipelineId(null);
    setDraftWorkflowKey(createDraftWorkflowKey());
    resetDraftHistory(nextDraft);
    setBaselineDraft(nextDraft);
    setIsNewDraft(true);
    setSmartRunPlan(null);
    setNotice("Drafting a new flow.");
    setActivePanel("flow");
  };

  const handleDeletePipeline = async (pipelineId: string) => {
    const hasActiveRun =
      runs.some((run) => run.pipelineId === pipelineId && (run.status === "queued" || run.status === "running")) ||
      startingRunPipelineId === pipelineId ||
      stoppingRunPipelineId === pipelineId;
    if (hasActiveRun) {
      setNotice("Stop the running flow before deleting it.");
      return;
    }

    try {
      await deletePipeline(pipelineId);
      const nextPipelines = pipelines.filter((pipeline) => pipeline.id !== pipelineId);
      setPipelines(nextPipelines);

      if (selectedPipelineId === pipelineId) {
        if (nextPipelines.length > 0) {
          selectPipeline(nextPipelines[0].id);
        } else {
          handleCreatePipelineDraft();
        }
      }

      setNotice("Flow deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete flow";
      setNotice(message);
    }
  };

  const handleSavePipeline = useCallback(
    async ({
      draftSnapshot = draft,
      silent = false
    }: {
      draftSnapshot?: PipelinePayload;
      silent?: boolean;
    } = {}) => {
      const validationError = getPipelineSaveValidationError(draftSnapshot);
      if (validationError) {
        if (!silent) {
          setNotice(validationError);
        }
        return false;
      }

      if (savingPipelineRef.current) {
        return false;
      }

      savingPipelineRef.current = true;
      setSavingPipeline(true);

      const payload: PipelinePayload = {
        ...draftSnapshot,
        runtime: normalizeRuntime(draftSnapshot.runtime)
      };
      const saveTargetPipelineId = selectedPipelineId;
      const saveTargetDraftKey = draftWorkflowKey;
      const savingNewDraft = isNewDraft || !saveTargetPipelineId;

      try {
        if (savingNewDraft) {
          const response = await createPipeline(payload);
          const created = response.pipeline;
          moveAiChatHistory(saveTargetDraftKey, created.id);
          moveRunDraft(saveTargetDraftKey, created.id);
          setPipelines((current) => [created, ...current.filter((pipeline) => pipeline.id !== created.id)]);
          if (
            selectedPipelineIdRef.current === saveTargetPipelineId &&
            draftWorkflowKeyRef.current === saveTargetDraftKey
          ) {
            setSelectedPipelineId(created.id);
            setBaselineDraft(payload);
            setIsNewDraft(false);
          }
          if (!silent) {
            setNotice("Flow created.");
          }
        } else {
          const pipelineId = saveTargetPipelineId;
          if (!pipelineId) {
            return false;
          }

          const response = await updatePipeline(pipelineId, payload);
          const updated = response.pipeline;
          setPipelines((current) => current.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)));
          if (selectedPipelineIdRef.current === pipelineId) {
            setBaselineDraft(payload);
          }
          if (!silent) {
            setNotice("Flow saved.");
          }
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save flow";
        setNotice(silent ? `Autosave failed: ${message}` : message);
        return false;
      } finally {
        savingPipelineRef.current = false;
        setSavingPipeline(false);
      }
    },
    [draft, draftWorkflowKey, isNewDraft, selectedPipelineId]
  );

  useEffect(() => {
    clearTimeout(autosaveTimerRef.current);

    if (!isDirty || pipelineSaveValidationError || savingPipeline || canvasDragActive) {
      return;
    }

    autosaveTimerRef.current = setTimeout(() => {
      void handleSavePipeline({ draftSnapshot: draft, silent: true });
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(autosaveTimerRef.current);
  }, [baselineDraft, canvasDragActive, draft, handleSavePipeline, isDirty, pipelineSaveValidationError, savingPipeline]);

  const handleSaveProvider = async (providerId: ProviderId, patch: Partial<DashboardState["providers"][ProviderId]>) => {
    try {
      const response = await updateProvider(providerId, patch);
      setProviders((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          [providerId]: response.provider
        };
      });
      setNotice(`${response.provider.label} settings saved.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save provider";
      setNotice(message);
    }
  };

  const handleProviderOauthStatusChange = useCallback((providerId: ProviderId, status: ProviderOAuthStatus | null) => {
    setProviderOauthStatuses((current) => ({
      ...current,
      [providerId]: status
    }));
  }, []);

  const handleProviderOauthMessageChange = useCallback((providerId: ProviderId, message: string) => {
    setProviderOauthMessages((current) => ({
      ...current,
      [providerId]: message
    }));
  }, []);

  const handleCreateMcpServer = async (payload: {
    name: string;
    enabled?: boolean;
    transport?: "stdio" | "http" | "sse";
    command?: string;
    args?: string;
    url?: string;
    env?: string;
    headers?: string;
    toolAllowlist?: string;
    health?: "unknown" | "healthy" | "degraded" | "down";
  }) => {
    try {
      const response = await createMcpServer(payload);
      setMcpServers((current) => [response.mcpServer, ...current]);
      setNotice(`MCP server "${response.mcpServer.name}" created.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create MCP server";
      setNotice(message);
    }
  };

  const handleUpdateMcpServer = async (
    serverId: string,
    payload: Partial<{
      name: string;
      enabled: boolean;
      transport: "stdio" | "http" | "sse";
      command: string;
      args: string;
      url: string;
      env: string;
      headers: string;
      toolAllowlist: string;
      health: "unknown" | "healthy" | "degraded" | "down";
    }>
  ) => {
    try {
      const response = await updateMcpServer(serverId, payload);
      setMcpServers((current) => current.map((entry) => (entry.id === response.mcpServer.id ? response.mcpServer : entry)));
      setNotice(`MCP server "${response.mcpServer.name}" saved.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update MCP server";
      setNotice(message);
    }
  };

  const handleDeleteMcpServer = async (serverId: string) => {
    try {
      await deleteMcpServer(serverId);
      setMcpServers((current) => current.filter((entry) => entry.id !== serverId));
      setNotice("MCP server deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete MCP server";
      setNotice(message);
    }
  };

  const handleSaveStorageConfig = async (
    payload: Partial<{
      enabled: boolean;
      rootPath: string;
      sharedFolder: string;
      isolatedFolder: string;
      runsFolder: string;
    }>
  ) => {
    try {
      const response = await updateStorageConfig(payload);
      setStorageConfig(response.storage);
      setNotice("Storage configuration saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save storage configuration";
      setNotice(message);
    }
  };

  const persistRunDraftInputs = useCallback(
    (task: string, inputs: Record<string, string>) => {
      const currentDraft = loadRunDraft(aiWorkflowKey);
      saveRunDraft(aiWorkflowKey, {
        ...currentDraft,
        task: task.trim().length > 0 ? task.trim() : currentDraft.task,
        inputs: {
          ...currentDraft.inputs,
          ...inputs
        }
      });
    },
    [aiWorkflowKey]
  );

  const runStartupCheckBeforeStart = useCallback(
    async ({
      pipelineId,
      task,
      inputs,
      source,
      runId
    }: {
      pipelineId: string;
      task: string;
      inputs: Record<string, string>;
      source: RunInputModalSource;
      runId?: string;
    }): Promise<"pass" | "needs_input" | "blocked"> => {
      const response = await getRunStartupCheck(pipelineId, task, inputs);
      const check = response.check;

      if (check.requests.length > 0) {
        setRunInputModal({
          source,
          pipelineId,
          runId,
          task,
          requests: check.requests,
          blockers: check.blockers,
          summary: check.summary,
          inputs,
          confirmLabel: source === "runtime" ? "Apply & Restart Run" : "Apply & Start Run"
        });
        return "needs_input";
      }

      if (check.status === "blocked") {
        const firstBlocker = check.blockers[0];
        setNotice(check.summary || firstBlocker?.message || "Startup check failed.");
        return "blocked";
      }

      if (check.status === "needs_input") {
        setNotice(check.summary || "Additional inputs are required before run.");
        return "needs_input";
      }

      return "pass";
    },
    []
  );

  const launchRun = useCallback(async (pipelineId: string, task: string, inputs: Record<string, string>) => {
    const response = await startRun(pipelineId, task, inputs);
    setRuns((current) => [response.run, ...current].slice(0, 40));
    setNotice("Flow run started.");

    const refreshed = await listRuns(40);
    setRuns(refreshed.runs);
  }, []);

  const handleStartRun = async (
    task: string,
    inputs?: Record<string, string>,
    options?: {
      pipelineId?: string;
      source?: RunInputModalSource;
      runId?: string;
      skipAutosaveCheck?: boolean;
      skipActiveRunCheck?: boolean;
    }
  ) => {
    const targetPipelineId = options?.pipelineId ?? selectedPipelineId;
    if (!targetPipelineId) {
      if (pipelineSaveValidationError) {
        setNotice(`Fix flow before run: ${pipelineSaveValidationError}`);
      } else {
        setNotice("Flow is still autosaving. Try again in a moment.");
      }
      return;
    }

    if (!options?.skipActiveRunCheck) {
      const hasActiveRun = runs.some(
        (run) => run.pipelineId === targetPipelineId && (run.status === "queued" || run.status === "running")
      );
      if (hasActiveRun) {
        setNotice("This flow is already running.");
        return;
      }
    }

    if (!options?.skipAutosaveCheck && targetPipelineId === selectedPipelineId && (savingPipeline || isDirty)) {
      if (pipelineSaveValidationError) {
        setNotice(`Fix flow before run: ${pipelineSaveValidationError}`);
      } else {
        setNotice("Autosave in progress. Try again in a moment.");
      }
      return;
    }

    const normalizedTask = task.trim();
    const normalizedInputs = normalizeSmartRunInputs(inputs);
    persistRunDraftInputs(normalizedTask, normalizedInputs);
    setStartingRunPipelineId(targetPipelineId);

    try {
      const startupCheckResult = await runStartupCheckBeforeStart({
        pipelineId: targetPipelineId,
        task: normalizedTask,
        inputs: normalizedInputs,
        source: options?.source ?? "startup",
        runId: options?.runId
      });
      if (startupCheckResult !== "pass") {
        return;
      }

      await launchRun(targetPipelineId, normalizedTask, normalizedInputs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start run";
      setNotice(message);
    } finally {
      setStartingRunPipelineId((current) => (current === targetPipelineId ? null : current));
    }
  };

  const handleStopRun = async (runId?: string) => {
    const targetRunId = runId ?? activePipelineRun?.id;
    if (!targetRunId) {
      setNotice("No active run to stop.");
      return;
    }

    const targetRun = runs.find((entry) => entry.id === targetRunId);
    const targetPipelineId = targetRun?.pipelineId ?? activePipelineRun?.pipelineId ?? selectedPipelineId ?? null;
    if (targetPipelineId) {
      setStoppingRunPipelineId(targetPipelineId);
    }

    try {
      const response = await stopRun(targetRunId);
      setRuns((current) => current.map((run) => (run.id === response.run.id ? response.run : run)));
      setNotice("Flow run stopped.");

      const refreshed = await listRuns(40);
      setRuns(refreshed.runs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to stop run";
      setNotice(message);
    } finally {
      if (targetPipelineId) {
        setStoppingRunPipelineId((current) => (current === targetPipelineId ? null : current));
      }
    }
  };

  const handleConfirmRunInputModal = useCallback(
    async (submittedValues: Record<string, string>) => {
      if (!runInputModal) {
        return;
      }

      const mergedInputs = normalizeSmartRunInputs({
        ...runInputModal.inputs,
        ...submittedValues
      });
      persistRunDraftInputs(runInputModal.task, mergedInputs);
      setProcessingRunInputModal(true);

      try {
        const modalContext = runInputModal;
        setRunInputModal(null);

        const secureInputsToSave: Record<string, string> = {};
        for (const request of modalContext.requests) {
          if (request.type !== "secret") {
            continue;
          }

          const value = mergedInputs[request.key];
          if (typeof value !== "string" || value.trim().length === 0 || value.trim() === "[secure]") {
            continue;
          }

          secureInputsToSave[request.key] = value;
        }

        if (Object.keys(secureInputsToSave).length > 0) {
          await savePipelineSecureInputs(modalContext.pipelineId, secureInputsToSave);
        }

        if (modalContext.source === "runtime" && modalContext.runId) {
          const run = runs.find((entry) => entry.id === modalContext.runId);
          if (run && (run.status === "queued" || run.status === "running")) {
            await handleStopRun(modalContext.runId);
          }
        }

        await handleStartRun(modalContext.task, mergedInputs, {
          pipelineId: modalContext.pipelineId,
          source: modalContext.source,
          runId: modalContext.runId,
          skipAutosaveCheck: modalContext.pipelineId !== selectedPipelineId
        });
      } finally {
        setProcessingRunInputModal(false);
      }
    },
    [handleStartRun, handleStopRun, persistRunDraftInputs, runInputModal, runs, selectedPipelineId]
  );

  useEffect(() => {
    if (!selectedPipelineId || runInputModal || processingRunInputModal) {
      return;
    }

    const activeRun = runs.find(
      (run) => run.pipelineId === selectedPipelineId && (run.status === "running" || run.status === "queued")
    );
    if (!activeRun) {
      return;
    }

    const stepsByLatest = [...activeRun.steps].reverse();
    for (const step of stepsByLatest) {
      if (!step.output || step.output.trim().length === 0) {
        continue;
      }

      const parsed = parseRunInputRequestsFromText(step.output);
      if (!parsed || parsed.requests.length === 0) {
        continue;
      }

      const signature = `${activeRun.id}:${step.stepId}:${Math.max(1, step.attempts)}:${parsed.requests
        .map((entry) => entry.key)
        .join(",")}`;
      if (runtimeInputPromptSeenRef.current.has(signature)) {
        continue;
      }

      runtimeInputPromptSeenRef.current.add(signature);
      while (runtimeInputPromptSeenRef.current.size > RUNTIME_INPUT_PROMPT_CACHE_LIMIT) {
        const oldest = runtimeInputPromptSeenRef.current.values().next().value;
        if (!oldest) {
          break;
        }
        runtimeInputPromptSeenRef.current.delete(oldest);
      }

      const seededInputs: Record<string, string> = { ...activeRun.inputs };
      for (const request of parsed.requests) {
        if (!hasRunInputValue(seededInputs, request.key) && request.defaultValue) {
          seededInputs[request.key] = request.defaultValue;
        }
      }

      setRunInputModal({
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
      setNotice(`${step.stepName}: additional input required.`);
      break;
    }
  }, [processingRunInputModal, runInputModal, runs, selectedPipelineId]);

  const handleLoadSmartRunPlan = useCallback(
    async (inputs?: Record<string, string>, options?: { force?: boolean }) => {
      if (!selectedPipelineId) {
        setSmartRunPlan(null);
        smartRunPlanLastSignatureRef.current = "";
        smartRunPlanInFlightSignatureRef.current = "";
        return;
      }

      const normalizedInputs = normalizeSmartRunInputs(inputs);
      const signature = buildSmartRunPlanSignature(selectedPipelineId, normalizedInputs);
      const force = options?.force === true;

      if (!force) {
        if (smartRunPlanInFlightSignatureRef.current === signature) {
          return;
        }

        if (smartRunPlanLastSignatureRef.current === signature && smartRunPlanRef.current) {
          return;
        }

        const cachedPlan = smartRunPlanCacheRef.current.get(signature);
        if (cachedPlan) {
          setSmartRunPlan(cachedPlan);
          smartRunPlanLastSignatureRef.current = signature;
          return;
        }
      }

      const requestId = smartRunPlanRequestIdRef.current + 1;
      smartRunPlanRequestIdRef.current = requestId;
      smartRunPlanInFlightSignatureRef.current = signature;
      setLoadingSmartRunPlan(true);
      try {
        const response = await getSmartRunPlan(selectedPipelineId, normalizedInputs);
        if (requestId !== smartRunPlanRequestIdRef.current) {
          return;
        }
        setSmartRunPlan(response.plan);
        smartRunPlanLastSignatureRef.current = signature;
        setSmartRunPlanCacheEntry(smartRunPlanCacheRef.current, signature, response.plan);
      } catch (error) {
        if (requestId !== smartRunPlanRequestIdRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to build smart run plan";
        setNotice(message);
      } finally {
        if (smartRunPlanInFlightSignatureRef.current === signature) {
          smartRunPlanInFlightSignatureRef.current = "";
        }
        if (requestId === smartRunPlanRequestIdRef.current) {
          setLoadingSmartRunPlan(false);
        }
      }
    },
    [selectedPipelineId]
  );

  useEffect(() => {
    if (!selectedPipelineId) {
      setSmartRunPlan(null);
      return;
    }

    void handleLoadSmartRunPlan();
  }, [selectedPipelineId, handleLoadSmartRunPlan]);

  useEffect(() => {
    if (activePanel !== "debug" || !selectedPipelineId) {
      return;
    }

    const draft = loadRunDraft(aiWorkflowKey);
    void handleLoadSmartRunPlan(draft.inputs);
  }, [activePanel, aiWorkflowKey, handleLoadSmartRunPlan, selectedPipelineId]);

  const handleAddStep = () => {
    if (selectedPipelineEditLocked) {
      setNotice("This flow is locked while running.");
      return;
    }

    applyDraftChange((current) => {
      const nextStep = createDraftStep(current.steps.length);
      const linkedSources = new Set(current.links.map((link) => link.sourceStepId));
      const anchorStep = [...current.steps].reverse().find((step) => !linkedSources.has(step.id)) ?? current.steps[current.steps.length - 1];

      if (anchorStep) {
        nextStep.position = {
          x: anchorStep.position.x + 300,
          y: anchorStep.position.y
        };
      }

      return {
        ...current,
        steps: [...current.steps, nextStep],
        links: anchorStep ? connectNodes(current.links, anchorStep.id, nextStep.id) : current.links
      };
    });

    setNotice("Step added.");
  };

  const handleSpawnOrchestrator = () => {
    if (selectedPipelineEditLocked) {
      setNotice("This flow is locked while running.");
      return;
    }

    applyDraftChange((current) => {
      if (current.steps.some((step) => step.role === "orchestrator")) {
        return current;
      }

      const nextStep = createOrchestratorStep(current.steps.length);
      nextStep.position = {
        x: 80,
        y: 60
      };

      return {
        ...current,
        steps: [nextStep, ...current.steps]
      };
    });

    setNotice("Main orchestrator spawned.");
  };

  if (!providers || !storageConfig) {
    return (
      <div className="flex h-screen flex-col bg-canvas text-sm text-ink-300">
        <div
          className="glass-panel-dense flex h-[38px] shrink-0 items-center border-b border-ink-700/40 pl-[78px]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="rounded-xl border border-ink-800 bg-ink-900/90 px-5 py-3 shadow-panel">{notice}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas text-ink-50">
      {/* ── Full-height sidebar (spans title bar + content seamlessly) ── */}
      <aside className="glass-panel-dense absolute left-0 top-0 z-30 flex h-full w-[56px] flex-col items-center gap-1 px-1.5 pt-[46px] pb-3">
          {/* ── Navigation ── */}
          <ToolButton
            label="Flows"
            active={activePanel === "pipelines"}
            onClick={() => {
              togglePanel("pipelines");
            }}
          >
            <Layers className="h-4 w-4" />
          </ToolButton>

          <ToolButton
            label="Flow settings"
            active={activePanel === "flow"}
            onClick={() => {
              togglePanel("flow");
            }}
          >
            <Settings2 className="h-4 w-4" />
          </ToolButton>

          <ToolButton
            label="Provider auth"
            active={activePanel === "providers"}
            onClick={() => {
              togglePanel("providers");
            }}
          >
            <ShieldCheck className="h-4 w-4" />
          </ToolButton>

          <ToolButton
            label="Contracts & gates"
            active={activePanel === "contracts"}
            onClick={() => {
              togglePanel("contracts");
            }}
          >
            <ListChecks className="h-4 w-4" />
          </ToolButton>

          <ToolButton
            label="MCP & storage"
            active={activePanel === "mcp"}
            onClick={() => {
              togglePanel("mcp");
            }}
          >
            <Cable className="h-4 w-4" />
          </ToolButton>

          <ToolButton
            label="AI builder"
            active={activePanel === "ai"}
            onClick={() => {
              togglePanel("ai");
            }}
          >
            <Sparkles className="h-4 w-4" />
          </ToolButton>

          <div className="my-1 h-px w-6 bg-ink-700/50" />

          {/* ── Canvas actions ── */}
          <ToolButton label="Add step" disabled={selectedPipelineEditLocked} onClick={handleAddStep}>
            <Plus className="h-4 w-4" />
          </ToolButton>

          <ToolButton
            label={hasOrchestrator ? "Orchestrator exists" : "Spawn orchestrator"}
            disabled={hasOrchestrator || selectedPipelineEditLocked}
            onClick={handleSpawnOrchestrator}
          >
            <Workflow className="h-4 w-4" />
          </ToolButton>

          <ToolButton label="Undo (Cmd/Ctrl+Z)" disabled={!canUndo || selectedPipelineEditLocked} onClick={undoDraftChange}>
            <Undo2 className="h-4 w-4" />
          </ToolButton>

          <ToolButton label="Redo (Cmd/Ctrl+Shift+Z)" disabled={!canRedo || selectedPipelineEditLocked} onClick={redoDraftChange}>
            <Redo2 className="h-4 w-4" />
          </ToolButton>

          <div className="mt-auto h-px w-6 bg-ink-700/50" />

          <ToolButton
            label="Debug mode"
            active={activePanel === "debug"}
            onClick={() => {
              togglePanel("debug");
            }}
          >
            <Bug className="h-4 w-4" />
          </ToolButton>
      </aside>

      {/* ── Draggable title bar (right of sidebar) ── */}
      <div
        className="glass-panel-dense absolute left-0 top-0 right-0 z-20 flex h-[38px] items-center justify-center"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-[11px] font-medium text-ink-500 select-none">
          {draft.name || "Untitled flow"}
        </span>
      </div>

      {/* ── Canvas ── */}
      <PipelineEditor
        draft={draft}
        activeRun={activePipelineRun}
        readOnly={selectedPipelineEditLocked}
        modelCatalog={MODEL_CATALOG}
        mcpServers={mcpServers.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }))}
        onChange={applyEditableDraftChange}
        onCanvasDragStateChange={setCanvasDragActive}
        onStepPanelChange={handleStepPanelChange}
        stepPanelBlocked={activePanel === "run"}
        className="absolute left-[56px] top-[38px] right-0 bottom-0"
      />

      {/* ── Top-right run button ── */}
      <div
        className={cn(
          "absolute top-[46px] z-50 transition-[right] duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]",
          activePanel === "run"
            ? "right-[402px]"
            : stepPanelOpen
              ? "right-[446px]"
              : "right-4"
        )}
      >
        {selectedPipelineRunActive ? (
          <div className="flex items-center gap-2">
            <Tooltip content={runTooltip} side="bottom">
              <Button variant="secondary" size="sm" onClick={() => togglePanel("run")}>
                <Play className="h-3.5 w-3.5" />
                Run
              </Button>
            </Tooltip>
            <Tooltip content={stoppingRun ? "Stopping..." : "Stop current run"} side="bottom">
              <Button
                variant="danger"
                size="sm"
                disabled={stoppingRun}
                className="shrink-0 whitespace-nowrap"
                onClick={() => {
                  void handleStopRun(activePipelineRun?.id);
                }}
              >
                {stoppingRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                {stoppingRun ? "Stopping" : "Stop"}
              </Button>
            </Tooltip>
          </div>
        ) : (
          <Tooltip content={runTooltip} side="bottom">
            <Button
              variant="secondary"
              size="sm"
              disabled={runPanelToggleDisabled}
              onClick={() => togglePanel("run")}
            >
              {startingRun ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {startingRun ? "Starting" : "Run"}
            </Button>
          </Tooltip>
        )}
      </div>

      <SlidePanel open={activePanel !== null && activePanel !== "run"} side="left" className="top-[38px] h-[calc(100%-38px)] w-full max-w-[390px]">
          <div className="flex h-12 items-center justify-between border-b border-ink-800 px-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
              {activePanel === "pipelines"
                ? "Flows"
                : activePanel === "flow"
                  ? "Flow Settings"
                  : activePanel === "contracts"
                    ? "Contracts & Gates"
                  : activePanel === "providers"
                    ? "Provider Auth"
                  : activePanel === "mcp"
                      ? "MCP & Storage"
                      : activePanel === "ai"
                        ? "AI Builder"
                        : activePanel === "debug"
                          ? "Debug"
                        : "Panel"}
            </p>

            <button
              type="button"
              onClick={() => setActivePanel(null)}
              className="rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-100"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {activePanel === "ai" ? (
            <div className="h-[calc(100%-48px)]">
              <AiBuilderPanel
                workflowKey={aiWorkflowKey}
                currentDraft={draft}
                readOnly={selectedPipelineEditLocked}
                onApplyDraft={(generatedDraft) => {
                  applyEditableDraftChange(generatedDraft);
                }}
                onNotice={setNotice}
              />
            </div>
          ) : (
            <div className="h-[calc(100%-48px)] overflow-y-auto p-3">
              {activePanel === "pipelines" ? (
                <PipelineList
                  pipelines={pipelines}
                  selectedId={selectedPipelineId}
                  activePipelineIds={activeRunPipelineIds}
                  onSelect={selectPipeline}
                  onCreate={handleCreatePipelineDraft}
                  onDelete={(pipelineId) => {
                    void handleDeletePipeline(pipelineId);
                  }}
                />
              ) : null}

              {activePanel === "flow" ? (
                <div>
                  {selectedPipelineEditLocked ? (
                    <p className="mb-4 rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-300">
                      This flow is running. Flow settings are locked until it finishes or is stopped.
                    </p>
                  ) : null}

                  <fieldset disabled={selectedPipelineEditLocked} className={cn(selectedPipelineEditLocked && "opacity-70")}>
                  {/* ── Identity ── */}
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-ink-400">
                      <Workflow className="h-3.5 w-3.5" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider">Identity</span>
                    </div>

                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Flow name</span>
                      <Input
                        value={draft.name}
                        onChange={(event) => applyDraftChange({ ...draft, name: event.target.value })}
                        placeholder="New flow name"
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Description</span>
                      <Textarea
                        className="min-h-[120px]"
                        value={draft.description}
                        onChange={(event) => applyDraftChange({ ...draft, description: event.target.value })}
                        placeholder="What this flow does"
                      />
                    </label>
                  </section>

                  <div className="my-5 h-px bg-ink-800/60" />

                  {/* ── Runtime ── */}
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-ink-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider">Runtime guards</span>
                    </div>

                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Max loops per step</span>
                      <Input
                        type="number"
                        min={0}
                        max={12}
                        value={runtimeDraft.maxLoops}
                        onChange={(event) =>
                          applyDraftChange({
                            ...draft,
                            runtime: {
                              ...runtimeDraft,
                              maxLoops: Math.max(0, Math.min(12, Number.parseInt(event.target.value, 10) || 0))
                            }
                          })
                        }
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Max total step executions</span>
                      <Input
                        type="number"
                        min={4}
                        max={120}
                        value={runtimeDraft.maxStepExecutions}
                        onChange={(event) =>
                          applyDraftChange({
                            ...draft,
                            runtime: {
                              ...runtimeDraft,
                              maxStepExecutions: Math.max(4, Math.min(120, Number.parseInt(event.target.value, 10) || 4))
                            }
                          })
                        }
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Per-stage timeout (ms)</span>
                      <Input
                        type="number"
                        min={10000}
                        max={1200000}
                        step={1000}
                        value={runtimeDraft.stageTimeoutMs}
                        onChange={(event) =>
                          applyDraftChange({
                            ...draft,
                            runtime: {
                              ...runtimeDraft,
                              stageTimeoutMs: Math.max(
                                10000,
                                Math.min(1200000, Number.parseInt(event.target.value, 10) || 10000)
                              )
                            }
                          })
                        }
                      />
                    </label>
                  </section>
                  </fieldset>

                  <div className="my-5 h-px bg-ink-800/60" />

                  <p className="text-xs text-ink-500">
                    {isNewDraft ? "New flow draft" : "Editing existing flow"}
                    {" · "}
                    <span className={pipelineSaveValidationError || isDirty ? "text-amber-400" : "text-emerald-400"}>
                      {autosaveStatusLabel}
                    </span>
                  </p>
                </div>
              ) : null}

              {activePanel === "contracts" ? (
                <QualityGatesPanel
                  draft={draft}
                  readOnly={selectedPipelineEditLocked}
                  onChange={applyEditableDraftChange}
                />
              ) : null}

              {activePanel === "providers" ? (
                <ProviderSettings
                  providers={providers}
                  oauthStatuses={providerOauthStatuses}
                  oauthMessages={providerOauthMessages}
                  onOAuthStatusChange={handleProviderOauthStatusChange}
                  onOAuthMessageChange={handleProviderOauthMessageChange}
                  onSaveProvider={async (providerId, patch) => {
                    await handleSaveProvider(providerId, patch);
                  }}
                />
              ) : null}

              {activePanel === "mcp" ? (
                <McpSettings
                  mcpServers={mcpServers}
                  storage={storageConfig}
                  onCreateServer={handleCreateMcpServer}
                  onUpdateServer={handleUpdateMcpServer}
                  onDeleteServer={handleDeleteMcpServer}
                  onSaveStorage={handleSaveStorageConfig}
                />
              ) : null}

              {activePanel === "debug" ? (
                <DebugPanel
                  selectedPipeline={selectedPipeline}
                  runs={runs}
                  smartRunPlan={smartRunPlan}
                  loadingSmartRunPlan={loadingSmartRunPlan}
                  startingRun={startingRun}
                />
              ) : null}

            </div>
          )}
      </SlidePanel>

      {/* ── Right-side run panel ── */}
      <SlidePanel open={activePanel === "run"} side="right" className="top-[38px] h-[calc(100%-38px)] w-full max-w-[390px]">
          <div className="flex h-12 items-center justify-between border-b border-ink-800 px-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Run</p>
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              className="rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-100 cursor-pointer"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="h-[calc(100%-48px)] overflow-y-auto p-3">
          <RunPanel
            draftStorageKey={aiWorkflowKey}
            selectedPipeline={selectedPipeline}
            runs={runs}
            smartRunPlan={smartRunPlan}
            loadingSmartRunPlan={loadingSmartRunPlan}
            onRefreshSmartRunPlan={async (inputs, options) => {
              await handleLoadSmartRunPlan(inputs, options);
            }}
            onRun={async (task, inputs) => {
              await handleStartRun(task, inputs);
            }}
            onStop={async (runId) => {
              await handleStopRun(runId);
            }}
            activeRun={activePipelineRun}
            startingRun={startingRun}
            stoppingRun={stoppingRun}
          />
          </div>
      </SlidePanel>

      <RunInputRequestModal
        open={Boolean(runInputModal)}
        title={runInputModal?.source === "runtime" ? "Runtime input required" : "Run startup input required"}
        summary={runInputModal?.summary}
        requests={runInputModal?.requests ?? []}
        blockers={runInputModal?.blockers ?? []}
        initialValues={runInputModal?.inputs}
        busy={processingRunInputModal}
        confirmLabel={runInputModal?.confirmLabel}
        onClose={() => {
          if (!processingRunInputModal) {
            setRunInputModal(null);
          }
        }}
        onConfirm={handleConfirmRunInputModal}
      />

      <AnimatePresence>
        {notice ? (
          <motion.div
            key={notice}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="glass-panel-dense pointer-events-none absolute bottom-5 right-4 z-50 rounded-xl border border-ink-700/40 px-4 py-2 text-xs text-ink-200 shadow-lg"
          >
            {notice}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
