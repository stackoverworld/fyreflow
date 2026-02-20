import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  Cable,
  CircleDot,
  FileText,
  GitFork,
  MessageSquareText,
  PanelRightClose,
  Trash2,
  X,
  Zap
} from "lucide-react";
import { getDefaultContextWindowForModel, getDefaultModelForProvider, type ModelCatalogEntry } from "@/lib/modelCatalog";
import type { AgentRole, LinkCondition, PipelinePayload, PipelineRun, ProviderId, ReasoningEffort } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Textarea } from "@/components/optics/textarea";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { OpenAIIcon, AnthropicIcon } from "@/components/optics/icons";
import { SlidePanel } from "@/components/optics/slide-panel";
import { cn } from "@/lib/cn";
import { autoLayoutPipelineDraftSmart } from "@/lib/flowLayout";
import { PipelineCanvas } from "@/components/dashboard/PipelineCanvas";

interface PipelineEditorProps {
  draft: PipelinePayload;
  activeRun?: PipelineRun | null;
  readOnly?: boolean;
  modelCatalog: Record<ProviderId, ModelCatalogEntry[]>;
  mcpServers: Array<{
    id: string;
    name: string;
    enabled: boolean;
  }>;
  onChange: (next: PipelinePayload) => void;
  onCanvasDragStateChange?: (active: boolean) => void;
  onStepPanelChange?: (open: boolean) => void;
  stepPanelBlocked?: boolean;
  className?: string;
}

const providerSegments = [
  { value: "openai" as const, label: "OpenAI", icon: <OpenAIIcon className="h-3.5 w-3.5" /> },
  { value: "claude" as const, label: "Anthropic", icon: <AnthropicIcon className="h-3.5 w-3.5" /> }
];

const roles: AgentRole[] = ["analysis", "planner", "orchestrator", "executor", "tester", "review"];
const linkConditions: LinkCondition[] = ["always", "on_pass", "on_fail"];
const outputFormats = [
  { value: "markdown", label: "markdown" },
  { value: "json", label: "json" }
] as const;

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

function defaultStepPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + index * 280,
    y: 130 + (index % 2 === 0 ? 0 : 24)
  };
}

function makeStepName(role: AgentRole, index: number): string {
  return `${index + 1}. ${role[0].toUpperCase()}${role.slice(1)} Bot`;
}

function getModelMeta(modelCatalog: Record<ProviderId, ModelCatalogEntry[]>, providerId: ProviderId, modelId: string) {
  return modelCatalog[providerId].find((entry) => entry.id === modelId);
}

function normalizeReasoning(
  modelCatalog: Record<ProviderId, ModelCatalogEntry[]>,
  providerId: ProviderId,
  modelId: string,
  requested: ReasoningEffort
): ReasoningEffort {
  const model = getModelMeta(modelCatalog, providerId, modelId);
  const supported = model?.reasoningEfforts ?? ["minimal", "low", "medium", "high", "xhigh"];
  if (supported.includes(requested)) {
    return requested;
  }

  if (supported.includes("medium")) {
    return "medium";
  }

  return supported[0] ?? "medium";
}

function resolvePreferredModel(
  modelCatalog: Record<ProviderId, ModelCatalogEntry[]>,
  providerId: ProviderId
): string {
  const preferred = getDefaultModelForProvider(providerId);
  if (modelCatalog[providerId].some((entry) => entry.id === preferred)) {
    return preferred;
  }

  return modelCatalog[providerId][0]?.id ?? preferred;
}

function updateStepById(
  draft: PipelinePayload,
  stepId: string,
  patch: Partial<PipelinePayload["steps"][number]>
): PipelinePayload {
  return {
    ...draft,
    steps: draft.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step))
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

  const normalized = links.filter((link) => link.sourceStepId !== targetStepId || link.targetStepId !== sourceStepId);

  if (
    normalized.some(
      (link) =>
        link.sourceStepId === sourceStepId &&
        link.targetStepId === targetStepId &&
        (link.condition ?? "always") === condition
    )
  ) {
    return normalized;
  }

  return [
    ...normalized,
    {
      id: createLinkId(),
      sourceStepId,
      targetStepId,
      condition
    }
  ];
}

function createStep(index: number, modelCatalog: Record<ProviderId, ModelCatalogEntry[]>): PipelinePayload["steps"][number] {
  const providerId: ProviderId = "openai";
  const model = resolvePreferredModel(modelCatalog, providerId);

  return {
    id: createStepId(),
    name: makeStepName("analysis", index),
    role: "analysis",
    prompt: "Analyze requirements and produce structured constraints.",
    providerId,
    model,
    reasoningEffort: normalizeReasoning(modelCatalog, providerId, model, "medium"),
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

function linkConditionLabel(condition: LinkCondition): string {
  if (condition === "on_pass") {
    return "on pass";
  }
  if (condition === "on_fail") {
    return "on fail";
  }
  return "always";
}

function resolveCanvasLinkId(link: PipelinePayload["links"][number], index: number): string {
  if (link.id && link.id.length > 0) {
    return link.id;
  }

  return `${link.sourceStepId}-${link.targetStepId}-${link.condition ?? "always"}-${index}`;
}

function parseLineList(raw: string, max = 40): string[] {
  return raw
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, max);
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function routeConditionMatchesOutcome(
  condition: LinkCondition | undefined,
  outcome: PipelineRun["steps"][number]["workflowOutcome"]
): boolean {
  if (condition === "on_pass") {
    return outcome === "pass";
  }

  if (condition === "on_fail") {
    return outcome === "fail";
  }

  return true;
}

export function PipelineEditor({
  draft,
  activeRun,
  readOnly = false,
  modelCatalog,
  mcpServers,
  onChange,
  onCanvasDragStateChange,
  onStepPanelChange,
  stepPanelBlocked,
  className
}: PipelineEditorProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [pendingTargetId, setPendingTargetId] = useState<string>("");
  const [pendingCondition, setPendingCondition] = useState<LinkCondition>("always");

  useEffect(() => {
    const validStepIds = new Set(draft.steps.map((step) => step.id));
    setSelectedStepIds((current) => current.filter((stepId) => validStepIds.has(stepId)));
    setSelectedStepId((current) => (current && validStepIds.has(current) ? current : null));
  }, [draft.steps]);

  useEffect(() => {
    const validLinkIds = new Set(draft.links.map((link, index) => resolveCanvasLinkId(link, index)));
    setSelectedLinkId((current) => (current && validLinkIds.has(current) ? current : null));
  }, [draft.links]);

  const selectedStepIndex = useMemo(
    () => draft.steps.findIndex((step) => step.id === selectedStepId),
    [draft.steps, selectedStepId]
  );

  const selectedStep = selectedStepIndex >= 0 ? draft.steps[selectedStepIndex] : undefined;

  useEffect(() => {
    if (!selectedStep) {
      setPendingTargetId("");
      return;
    }

    const fallback = draft.steps.find((step) => step.id !== selectedStep.id)?.id ?? "";
    setPendingTargetId((current) => {
      if (current && current !== selectedStep.id && draft.steps.some((step) => step.id === current)) {
        return current;
      }
      return fallback;
    });
  }, [draft.steps, selectedStep]);

  useLayoutEffect(() => {
    onStepPanelChange?.(!!selectedStep);
  }, [onStepPanelChange, selectedStep]);

  useEffect(() => {
    if (stepPanelBlocked && selectedStepId) {
      setSelectedStepId(null);
      setSelectedStepIds([]);
    }
  }, [stepPanelBlocked, selectedStepId]);

  const canvasNodes = useMemo(
    () =>
      draft.steps.map((step, index) => ({
        id: step.id,
        name: step.name || makeStepName(step.role, index),
        role: step.role,
        providerId: step.providerId,
        model: step.model,
        position: step.position ?? defaultStepPosition(index)
      })),
    [draft.steps]
  );

  const canvasLinks = useMemo(() => {
    const validIds = new Set(draft.steps.map((step) => step.id));
    const uniqueDirectional = new Set<string>();
    const uniquePair = new Set<string>();

    return draft.links
      .map((link, index) => ({
        id: resolveCanvasLinkId(link, index),
        sourceStepId: link.sourceStepId,
        targetStepId: link.targetStepId,
        condition: link.condition ?? "always"
      }))
      .filter(
        (link) =>
          link.sourceStepId !== link.targetStepId &&
          validIds.has(link.sourceStepId) &&
          validIds.has(link.targetStepId)
      )
      .filter((link) => {
        const directionalKey = `${link.sourceStepId}|${link.targetStepId}|${link.condition ?? "always"}`;
        if (uniqueDirectional.has(directionalKey)) {
          return false;
        }

        const pairNodes = [link.sourceStepId, link.targetStepId].sort();
        const pairKey = `${pairNodes[0]}|${pairNodes[1]}|${link.condition ?? "always"}`;
        if (uniquePair.has(pairKey)) {
          return false;
        }

        uniqueDirectional.add(directionalKey);
        uniquePair.add(pairKey);
        return true;
      });
  }, [draft.links, draft.steps]);

  const animatedNodeIds = useMemo(() => {
    if (!activeRun || activeRun.status !== "running") {
      return [];
    }

    return activeRun.steps.filter((step) => step.status === "running").map((step) => step.stepId);
  }, [activeRun]);

  const animatedLinkIds = useMemo(() => {
    if (!activeRun || activeRun.status !== "running") {
      return [];
    }

    const runningSteps = activeRun.steps.filter((step) => step.status === "running");
    if (runningSteps.length === 0) {
      return [];
    }

    const runStepById = new Map(activeRun.steps.map((step) => [step.stepId, step]));
    const animated = new Set<string>();

    for (const targetStep of runningSteps) {
      const targetStartedAt = parseIsoTimestamp(targetStep.startedAt);
      const incomingCandidates = canvasLinks
        .map((link) => {
          if (link.targetStepId !== targetStep.stepId) {
            return null;
          }

          const sourceStep = runStepById.get(link.sourceStepId);
          if (!sourceStep) {
            return null;
          }

          if (sourceStep.status !== "completed" && sourceStep.status !== "failed") {
            return null;
          }

          if (!routeConditionMatchesOutcome(link.condition, sourceStep.workflowOutcome)) {
            return null;
          }

          const sourceFinishedAt = parseIsoTimestamp(sourceStep.finishedAt);
          if (
            targetStartedAt !== null &&
            sourceFinishedAt !== null &&
            sourceFinishedAt > targetStartedAt + 1500
          ) {
            return null;
          }

          return {
            linkId: link.id,
            sourceFinishedAt
          };
        })
        .filter((entry): entry is { linkId: string; sourceFinishedAt: number | null } => entry !== null);

      if (incomingCandidates.length === 0) {
        continue;
      }

      const timestampedCandidates = incomingCandidates.filter(
        (entry): entry is { linkId: string; sourceFinishedAt: number } => entry.sourceFinishedAt !== null
      );

      if (timestampedCandidates.length === 0) {
        for (const entry of incomingCandidates) {
          animated.add(entry.linkId);
        }
        continue;
      }

      const latestFinishedAt = Math.max(...timestampedCandidates.map((entry) => entry.sourceFinishedAt));
      for (const entry of timestampedCandidates) {
        if (latestFinishedAt - entry.sourceFinishedAt <= 1500) {
          animated.add(entry.linkId);
        }
      }
    }

    return [...animated];
  }, [activeRun, canvasLinks]);

  const selectedModelMeta = selectedStep
    ? getModelMeta(modelCatalog, selectedStep.providerId, selectedStep.model)
    : undefined;
  const reasoningModes = selectedModelMeta?.reasoningEfforts ?? ["minimal", "low", "medium", "high", "xhigh"];
  const providerDefaultModel = selectedStep ? getDefaultModelForProvider(selectedStep.providerId) : "";
  const stepNameById = useMemo(() => new Map(draft.steps.map((step) => [step.id, step.name || step.role])), [draft.steps]);
  const outgoingLinks = useMemo(() => {
    if (!selectedStep) {
      return [];
    }
    return draft.links.filter((link) => link.sourceStepId === selectedStep.id);
  }, [draft.links, selectedStep]);
  const incomingLinks = useMemo(() => {
    if (!selectedStep) {
      return [];
    }
    return draft.links.filter((link) => link.targetStepId === selectedStep.id);
  }, [draft.links, selectedStep]);

  const removeStepsByIds = useCallback((stepIds: string[]) => {
    if (readOnly) {
      return;
    }

    const toDelete = new Set(stepIds);
    if (toDelete.size === 0) {
      return;
    }

    const nextSteps = draft.steps.filter((step) => !toDelete.has(step.id));

    if (nextSteps.length === 0) {
      const fallback = createStep(0, modelCatalog);
      onChange({
        ...draft,
        steps: [fallback],
        links: []
      });
      setSelectedStepId(null);
      setSelectedStepIds([]);
      setSelectedLinkId(null);
      return;
    }

    const nextLinks = draft.links.filter(
      (link) => !toDelete.has(link.sourceStepId) && !toDelete.has(link.targetStepId)
    );

    onChange({
      ...draft,
      steps: nextSteps,
      links: nextLinks
    });
    setSelectedStepId(null);
    setSelectedStepIds([]);
    setSelectedLinkId(null);
  }, [draft, modelCatalog, onChange, readOnly]);

  const removeStepById = useCallback((stepId: string) => {
    removeStepsByIds([stepId]);
  }, [removeStepsByIds]);

  const removeLinkById = useCallback((linkId: string) => {
    if (readOnly) {
      return;
    }

    onChange({
      ...draft,
      links: draft.links.filter((link, index) => resolveCanvasLinkId(link, index) !== linkId)
    });
    setSelectedLinkId(null);
  }, [draft, onChange, readOnly]);

  const removeSelectedStep = () => {
    if (!selectedStep) {
      return;
    }

    removeStepsByIds([selectedStep.id]);
  };

  const applyAutoLayout = useCallback(() => {
    if (readOnly) {
      return;
    }

    void autoLayoutPipelineDraftSmart(draft).then((nextDraft) => {
      onChange(nextDraft);
    });
  }, [draft, onChange, readOnly]);

  useEffect(() => {
    if (readOnly) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
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

      event.preventDefault();
      if (selectedLinkId) {
        removeLinkById(selectedLinkId);
        return;
      }

      if (selectedStepIds.length > 0) {
        removeStepsByIds(selectedStepIds);
        return;
      }

      if (selectedStepId) {
        removeStepById(selectedStepId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, removeLinkById, removeStepById, removeStepsByIds, selectedLinkId, selectedStepId, selectedStepIds]);

  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-0 overflow-hidden bg-ink-950">
        <PipelineCanvas
          nodes={canvasNodes}
          links={canvasLinks}
          animatedNodeIds={animatedNodeIds}
          animatedLinkIds={animatedLinkIds}
          readOnly={readOnly}
          selectedNodeId={selectedStepId}
          selectedNodeIds={selectedStepIds}
          selectedLinkId={selectedLinkId}
          onAutoLayout={readOnly ? undefined : applyAutoLayout}
          onSelectionChange={({ nodeIds, primaryNodeId, linkId, isDragStart }) => {
            setSelectedStepIds(nodeIds);
            if (!isDragStart) {
              setSelectedStepId(primaryNodeId ?? (nodeIds.length > 0 ? nodeIds[nodeIds.length - 1] : null));
            }
            setSelectedLinkId(linkId);
          }}
          onAddNode={() => {}}
          onMoveNode={(nodeId, position) => {
            if (readOnly) {
              return;
            }

            onChange({
              ...draft,
              steps: draft.steps.map((step) => (step.id === nodeId ? { ...step, position } : step))
            });
          }}
          onMoveNodes={(updates) => {
            if (readOnly) {
              return;
            }

            const updatesById = new Map(updates.map((entry) => [entry.nodeId, entry.position]));
            onChange({
              ...draft,
              steps: draft.steps.map((step) => {
                const position = updatesById.get(step.id);
                return position ? { ...step, position } : step;
              })
            });
          }}
          onDragStateChange={onCanvasDragStateChange}
          onConnectNodes={(sourceNodeId, targetNodeId) => {
            if (readOnly) {
              return;
            }

            onChange({
              ...draft,
              links: connectNodes(draft.links, sourceNodeId, targetNodeId)
            });
          }}
          onDeleteNodes={readOnly ? undefined : removeStepsByIds}
          onDeleteLink={readOnly ? undefined : removeLinkById}
          showToolbar={false}
          canvasHeight="100%"
          className="h-full"
        />

        <SlidePanel open={!!selectedStep} side="right" className="w-full max-w-[430px]">
          {selectedStep ? (
            <div className="h-full overflow-y-auto p-4 pb-20">
              {/* ── Header ── */}
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ember-500/10 text-ember-400">
                    <Bot className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-ink-500">Step {selectedStepIndex + 1}</p>
                    <p className="text-base font-semibold text-ink-50">{selectedStep.name || "Untitled step"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={removeSelectedStep}
                    disabled={readOnly}
                    className="rounded-lg p-1.5 text-ink-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    aria-label="Remove step"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStepId(null)}
                    className="rounded-lg p-1.5 text-ink-600 transition-colors hover:bg-ink-800 hover:text-ink-200"
                    aria-label="Close panel"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {readOnly ? (
                <p className="mb-4 rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-300">
                  This flow is running. Step edits are locked until it finishes or is stopped.
                </p>
              ) : null}

              <fieldset disabled={readOnly} className={cn(readOnly && "opacity-70")}>
              {/* ── Identity ── */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <CircleDot className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Identity</span>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Name</span>
                  <Input
                    value={selectedStep.name}
                    onChange={(event) => onChange(updateStepById(draft, selectedStep.id, { name: event.target.value }))}
                    placeholder="Give this agent a name"
                  />
                </label>

                <div className="space-y-1.5">
                  <span className="text-xs text-ink-400">Role</span>
                  <Select
                    value={selectedStep.role}
                    onValueChange={(val) => {
                      const role = val as AgentRole;
                      onChange(
                        updateStepById(draft, selectedStep.id, {
                          role,
                          enableDelegation:
                            role === "executor" || role === "orchestrator"
                              ? selectedStep.enableDelegation || role === "orchestrator"
                              : false,
                          name:
                            selectedStep.name.trim().length > 0
                              ? selectedStep.name
                              : makeStepName(role, Math.max(selectedStepIndex, 0))
                        })
                      );
                    }}
                    options={roles.map((role) => ({ value: role, label: role }))}
                  />
                  <p className="text-[11px] text-ink-600">Determines how this agent behaves in the pipeline.</p>
                </div>
              </section>

              <div className="my-5 h-px bg-ink-800/60" />

              {/* ── Model Configuration ── */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <Brain className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Model</span>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-ink-400">Provider</span>
                  <SegmentedControl
                    segments={providerSegments}
                    value={selectedStep.providerId}
                    onValueChange={(providerId) => {
                      const defaultModel = resolvePreferredModel(modelCatalog, providerId);
                      const contextWindowTokens = getDefaultContextWindowForModel(providerId, defaultModel);

                      onChange(
                        updateStepById(draft, selectedStep.id, {
                          providerId,
                          model: defaultModel,
                          reasoningEffort: normalizeReasoning(modelCatalog, providerId, defaultModel, "medium"),
                          fastMode: providerId === "claude" ? selectedStep.fastMode : false,
                          use1MContext: providerId === "claude" ? selectedStep.use1MContext : false,
                          contextWindowTokens
                        })
                      );
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-ink-400">Model preset</span>
                  <Select
                    value={selectedModelMeta ? selectedStep.model : "__custom__"}
                    onValueChange={(selected) => {
                      if (selected === "__custom__") {
                        return;
                      }

                      const modelMeta = getModelMeta(modelCatalog, selectedStep.providerId, selected);
                      onChange(
                        updateStepById(draft, selectedStep.id, {
                          model: selected,
                          reasoningEffort: normalizeReasoning(
                            modelCatalog,
                            selectedStep.providerId,
                            selected,
                            selectedStep.reasoningEffort
                          ),
                          contextWindowTokens: modelMeta?.contextWindowTokens ?? selectedStep.contextWindowTokens,
                          use1MContext:
                            selectedStep.providerId === "claude" && selectedStep.use1MContext
                              ? modelMeta?.supports1MContext === true
                              : false
                        })
                      );
                    }}
                    options={[
                      ...(modelCatalog[selectedStep.providerId] ?? []).map((option) => ({
                        value: option.id,
                        label: option.label
                      })),
                      { value: "__custom__", label: "Custom model id" }
                    ]}
                  />
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Model ID override</span>
                  <Input
                    value={selectedStep.model}
                    onChange={(event) => {
                      const model = event.target.value;
                      onChange(
                        updateStepById(draft, selectedStep.id, {
                          model,
                          reasoningEffort: normalizeReasoning(
                            modelCatalog,
                            selectedStep.providerId,
                            model,
                            selectedStep.reasoningEffort
                          )
                        })
                      );
                    }}
                    placeholder={selectedStep.providerId === "openai" ? "gpt-5.3-codex" : "claude-sonnet-4-6"}
                  />
                  <p className="text-[11px] text-ink-600">
                    {selectedModelMeta?.notes || `Enter any model ID. Default: ${providerDefaultModel}`}
                  </p>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <span className="text-xs text-ink-400">Reasoning</span>
                    <Select
                      value={selectedStep.reasoningEffort}
                      onValueChange={(val) =>
                        onChange(
                          updateStepById(draft, selectedStep.id, {
                            reasoningEffort: val as ReasoningEffort
                          })
                        )
                      }
                      options={reasoningModes.map((mode) => ({ value: mode, label: mode }))}
                    />
                  </div>

                  <label className="space-y-1.5">
                    <span className="text-xs text-ink-400">Context tokens</span>
                    <Input
                      type="number"
                      min={64000}
                      max={1000000}
                      value={selectedStep.contextWindowTokens}
                      onChange={(event) =>
                        onChange(
                          updateStepById(draft, selectedStep.id, {
                            contextWindowTokens: Math.max(
                              64000,
                              Math.min(1000000, Number.parseInt(event.target.value, 10) || 64000)
                            )
                          })
                        )
                      }
                    />
                  </label>
                </div>
              </section>

              <div className="my-5 h-px bg-ink-800/60" />

              {/* ── Runtime Options ── */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <Zap className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Runtime</span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
                    <div className="flex items-center gap-2.5">
                      <Switch
                        checked={selectedStep.fastMode}
                        disabled={selectedStep.providerId !== "claude"}
                        onChange={(checked) => onChange(updateStepById(draft, selectedStep.id, { fastMode: checked }))}
                      />
                      <div>
                        <p className="text-[13px] text-ink-100">Fast mode</p>
                        <p className="text-[11px] text-ink-500">Prioritized processing for Claude models.</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
                    <div className="flex items-center gap-2.5">
                      <Switch
                        checked={selectedStep.use1MContext}
                        disabled={selectedStep.providerId !== "claude" || selectedModelMeta?.supports1MContext === false}
                        onChange={(checked) =>
                          onChange(
                            updateStepById(draft, selectedStep.id, {
                              use1MContext: checked,
                              contextWindowTokens: checked
                                ? Math.max(selectedStep.contextWindowTokens, 1000000)
                                : selectedModelMeta?.contextWindowTokens ?? selectedStep.contextWindowTokens
                            })
                          )
                        }
                      />
                      <div>
                        <p className="text-[13px] text-ink-100">1M context</p>
                        <p className="text-[11px] text-ink-500">Extended window for large documents.</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
                    <div className="flex items-center gap-2.5">
                      <Switch
                        checked={selectedStep.enableDelegation}
                        onChange={(checked) =>
                          onChange(updateStepById(draft, selectedStep.id, { enableDelegation: checked }))
                        }
                        disabled={selectedStep.role !== "executor" && selectedStep.role !== "orchestrator"}
                      />
                      <div>
                        <p className="text-[13px] text-ink-100">Subagent delegation</p>
                        <p className="text-[11px] text-ink-500">Spawn child agents from this step.</p>
                      </div>
                    </div>
                    {selectedStep.enableDelegation && (
                      <Input
                        className="w-16 text-center"
                        type="number"
                        min={1}
                        max={8}
                        value={selectedStep.delegationCount}
                        onChange={(event) =>
                          onChange(
                            updateStepById(draft, selectedStep.id, {
                              delegationCount: Number.parseInt(event.target.value, 10) || 1
                            })
                          )
                        }
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
                    <div className="flex items-center gap-2.5">
                      <Switch
                        checked={selectedStep.enableIsolatedStorage}
                        onChange={(checked) =>
                          onChange(updateStepById(draft, selectedStep.id, { enableIsolatedStorage: checked }))
                        }
                      />
                      <div>
                        <p className="text-[13px] text-ink-100">Isolated storage</p>
                        <p className="text-[11px] text-ink-500">Private persistent folder for this agent step.</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
                    <div className="flex items-center gap-2.5">
                      <Switch
                        checked={selectedStep.enableSharedStorage}
                        onChange={(checked) => onChange(updateStepById(draft, selectedStep.id, { enableSharedStorage: checked }))}
                      />
                      <div>
                        <p className="text-[13px] text-ink-100">Shared storage</p>
                        <p className="text-[11px] text-ink-500">Access centralized artifacts shared across agents.</p>
                      </div>
                    </div>
                  </div>

                  {mcpServers.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-ink-800 bg-ink-900/35 px-3 py-2">
                      <p className="text-[12px] font-medium text-ink-200">MCP access</p>
                      {mcpServers.map((server) => {
                        const checked = selectedStep.enabledMcpServerIds.includes(server.id);
                        return (
                          <div key={server.id} className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs text-ink-300">{server.name}</p>
                              <p className="truncate text-[10px] text-ink-600">{server.id}</p>
                            </div>
                            <Switch
                              checked={checked}
                              disabled={!server.enabled}
                              onChange={(next) => {
                                const current = new Set(selectedStep.enabledMcpServerIds);
                                if (next) {
                                  current.add(server.id);
                                } else {
                                  current.delete(server.id);
                                }

                                onChange(
                                  updateStepById(draft, selectedStep.id, {
                                    enabledMcpServerIds: [...current]
                                  })
                                );
                              }}
                            />
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-ink-500">
                        This step can call only selected MCP servers while running.
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-2 rounded-lg border border-ink-800 bg-ink-900/35 px-3 py-2">
                    <p className="text-[12px] font-medium text-ink-200">Output contract</p>

                    <div className="space-y-1.5">
                      <span className="text-xs text-ink-400">Expected output format</span>
                      <Select
                        value={selectedStep.outputFormat}
                        onValueChange={(value) =>
                          onChange(
                            updateStepById(draft, selectedStep.id, {
                              outputFormat: value === "json" ? "json" : "markdown"
                            })
                          )
                        }
                        options={outputFormats.map((format) => ({
                          value: format.value,
                          label: format.label
                        }))}
                      />
                    </div>

                    {selectedStep.outputFormat === "json" ? (
                      <label className="block space-y-1.5">
                        <span className="text-xs text-ink-400">Required JSON fields (one path per line)</span>
                        <Textarea
                          className="min-h-[84px]"
                          value={selectedStep.requiredOutputFields.join("\n")}
                          onChange={(event) =>
                            onChange(
                              updateStepById(draft, selectedStep.id, {
                                requiredOutputFields: parseLineList(event.target.value)
                              })
                            )
                          }
                          placeholder={"status\nartifacts.html\nqa.blockingIssues"}
                        />
                      </label>
                    ) : null}

                    <label className="block space-y-1.5">
                      <span className="text-xs text-ink-400">Required artifact files (one path per line)</span>
                      <Textarea
                        className="min-h-[84px]"
                        value={selectedStep.requiredOutputFiles.join("\n")}
                        onChange={(event) =>
                          onChange(
                            updateStepById(draft, selectedStep.id, {
                              requiredOutputFiles: parseLineList(event.target.value)
                            })
                          )
                        }
                        placeholder={"{{shared_storage_path}}/ui-kit.json\n{{run_storage_path}}/qa-report.json"}
                      />
                    </label>

                    <p className="text-[11px] text-ink-500">
                      Blocking contracts fail the step automatically and trigger fail routes when configured.
                    </p>
                  </div>
                </div>
              </section>

              <div className="my-5 h-px bg-ink-800/60" />

              {/* ── Prompt ── */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Prompt</span>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-ink-400">Instructions</span>
                  <Textarea
                    value={selectedStep.prompt}
                    onChange={(event) => onChange(updateStepById(draft, selectedStep.id, { prompt: event.target.value }))}
                    placeholder="Define what this agent should do and how it should format output..."
                  />
                  <p className="text-[11px] text-ink-600">The system prompt sent to the model at runtime.</p>
                </label>

                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-ink-400">
                    <FileText className="h-3 w-3" /> Context template
                  </span>
                  <Textarea
                    className="min-h-[100px]"
                    value={selectedStep.contextTemplate}
                    onChange={(event) =>
                      onChange(updateStepById(draft, selectedStep.id, { contextTemplate: event.target.value }))
                    }
                    placeholder={"Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}"}
                  />
                  <p className="text-[11px] text-ink-600">
                    Variables: <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{task}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{previous_output}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{all_outputs}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{run_inputs}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{shared_storage_path}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{isolated_storage_path}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{run_storage_path}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{storage_policy}}"}</code>{" "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{mcp_servers}}"}</code>
                    {" · dynamic: "}
                    <code className="rounded bg-ink-800/60 px-1 py-0.5 text-ink-300">{"{{input.<key>}}"}</code>
                  </p>
                </label>
              </section>

              <div className="my-5 h-px bg-ink-800/60" />

              {/* ── Connections ── */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <Cable className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Connections</span>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Select
                      value={pendingTargetId}
                      onValueChange={setPendingTargetId}
                      placeholder="Target step..."
                      options={draft.steps
                        .filter((step) => step.id !== selectedStep.id)
                        .map((step) => ({
                          value: step.id,
                          label: step.name || step.role
                        }))}
                    />
                    <Select
                      value={pendingCondition}
                      onValueChange={(value) => setPendingCondition(value as LinkCondition)}
                      options={linkConditions.map((condition) => ({
                        value: condition,
                        label: linkConditionLabel(condition)
                      }))}
                    />
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    disabled={!pendingTargetId || pendingTargetId === selectedStep.id}
                    onClick={() => {
                      if (!pendingTargetId || pendingTargetId === selectedStep.id) {
                        return;
                      }

                      onChange({
                        ...draft,
                        links: connectNodes(draft.links, selectedStep.id, pendingTargetId, pendingCondition)
                      });
                    }}
                  >
                    <Cable className="mr-1.5 h-3.5 w-3.5" /> Add connection
                  </Button>
                </div>

                {outgoingLinks.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                      <GitFork className="h-3 w-3" /> Outgoing
                    </p>
                    {outgoingLinks.map((link) => {
                      const linkIndex = draft.links.indexOf(link);
                      const linkId = linkIndex >= 0 ? resolveCanvasLinkId(link, linkIndex) : link.id ?? "";
                      const targetName = stepNameById.get(link.targetStepId) ?? link.targetStepId;

                      return (
                        <div key={`${link.id ?? `${link.sourceStepId}-${link.targetStepId}`}-out`} className="flex items-center gap-2 rounded-lg bg-ink-800/20 px-2 py-1.5">
                          <p className="min-w-0 flex-1 truncate text-xs text-ink-200">{targetName}</p>
                          <Select
                            className="w-[112px]"
                            value={link.condition ?? "always"}
                            onValueChange={(value) => {
                              if (linkIndex < 0) {
                                return;
                              }
                              const nextCondition = value as LinkCondition;
                              onChange({
                                ...draft,
                                links: draft.links.map((entry, index) =>
                                  index === linkIndex ? { ...entry, condition: nextCondition } : entry
                                )
                              });
                            }}
                            options={linkConditions.map((condition) => ({
                              value: condition,
                              label: linkConditionLabel(condition)
                            }))}
                          />
                          <button
                            type="button"
                            onClick={() => removeLinkById(linkId)}
                            className="rounded-md p-1 text-ink-600 transition-colors hover:text-red-400"
                            aria-label="Remove link"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {incomingLinks.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                      <GitFork className="h-3 w-3 rotate-180" /> Incoming
                    </p>
                    {incomingLinks.map((link) => {
                      const sourceName = stepNameById.get(link.sourceStepId) ?? link.sourceStepId;
                      return (
                        <div key={`${link.id ?? `${link.sourceStepId}-${link.targetStepId}`}-in`} className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/20 px-2 py-1.5">
                          <p className="min-w-0 truncate text-xs text-ink-200">{sourceName}</p>
                          <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-400">
                            {linkConditionLabel(link.condition ?? "always")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {outgoingLinks.length === 0 && incomingLinks.length === 0 && (
                  <p className="py-2 text-center text-[11px] text-ink-600">No connections yet. Link steps by dragging on the canvas or using the form above.</p>
                )}
              </section>
              </fieldset>
            </div>
          ) : null}
        </SlidePanel>

      </div>
    </div>
  );
}
