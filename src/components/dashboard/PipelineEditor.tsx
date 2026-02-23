import { useCallback, useEffect, useRef } from "react";
import {
  Activity,
  Bot,
  Brain,
  Cable,
  CalendarClock,
  CircleDot,
  MessageSquareText,
  PanelRightClose,
  ShieldCheck,
  Trash2,
  Zap
} from "lucide-react";
import { PipelineCanvas } from "@/components/dashboard/PipelineCanvas";
import { SlidePanel } from "@/components/optics/slide-panel";
import { Badge } from "@/components/optics/badge";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import { cn } from "@/lib/cn";
import { usePersistedTab } from "@/components/dashboard/usePersistedTab";
import { usePersistedJsonState } from "@/components/dashboard/usePersistedJsonState";
import { CollapsibleSection } from "./pipeline-editor/sections/CollapsibleSection";
import { BasicFields } from "./pipeline-editor/sections/general/BasicFields";
import { ExecutionModeField } from "./pipeline-editor/sections/general/execution-fields/ExecutionModeField";
import { RetryPolicyField } from "./pipeline-editor/sections/general/execution-fields/RetryPolicyField";
import { TimeoutField } from "./pipeline-editor/sections/general/execution-fields/TimeoutField";
import { SchedulingFields } from "./pipeline-editor/sections/general/SchedulingFields";
import { QualityGatesSection } from "./pipeline-editor/sections/QualityGatesSection";
import { ScheduleSection } from "./pipeline-editor/sections/ScheduleSection";
import { StepLiveActivitySection } from "./pipeline-editor/sections/StepLiveActivitySection";
import { usePipelineEditorState } from "./pipeline-editor/usePipelineEditorState";
import type { PipelineEditorProps } from "./pipeline-editor/types";

type StepSection = "identity" | "model" | "runtime" | "prompt" | "connections" | "qualityGates" | "schedule";
type StepPanelTab = "configure" | "activity";
const STEP_PANEL_TABS = ["configure", "activity"] as const;
const STEP_PANEL_SEGMENTS: Segment<StepPanelTab>[] = [
  { value: "configure", label: "Configure", icon: <Bot className="h-3.5 w-3.5" /> },
  { value: "activity", label: "Activity", icon: <Activity className="h-3.5 w-3.5" /> }
];

type StepSectionCollapsedState = Record<StepSection, boolean>;

const DEFAULT_STEP_SECTION_COLLAPSED_STATE: StepSectionCollapsedState = {
  identity: false,
  model: false,
  runtime: true,
  prompt: true,
  connections: true,
  qualityGates: true,
  schedule: true
};

function isStepSectionCollapsedState(value: unknown): value is StepSectionCollapsedState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<StepSectionCollapsedState>;
  return (
    typeof state.identity === "boolean" &&
    typeof state.model === "boolean" &&
    typeof state.runtime === "boolean" &&
    typeof state.prompt === "boolean" &&
    typeof state.connections === "boolean" &&
    typeof state.qualityGates === "boolean" &&
    typeof state.schedule === "boolean"
  );
}

export function PipelineEditor(props: PipelineEditorProps) {
  const {
    draft,
    readOnly = false,
    claudeFastModeAvailable,
    claudeFastModeUnavailableNote,
    onCanvasDragStateChange,
    className
  } = props;

  const {
    selectedStepId,
    selectedStepIds,
    selectedLinkId,
    pendingTargetId,
    pendingCondition,
    setPendingTargetId,
    setPendingCondition,
    selectedStepIndex,
    selectedStep,
    selectedModelMeta,
    reasoningModes,
    providerDefaultModel,
    canvasNodes,
    canvasLinks,
    animatedNodeIds,
    animatedLinkIds,
    stepNameById,
    outgoingLinks,
    incomingLinks,
    setSelectedStepId,
    removeStepsByIds,
    removeLinkById,
    removeSelectedStep,
    applyAutoLayout,
    handleCanvasSelectionChange,
    handleCanvasMoveNode,
    handleCanvasMoveNodes,
    handleCanvasConnectNodes,
    patchSelectedStep,
    addConnectionFromSelectedStep,
    updateConnectionCondition
  } = usePipelineEditorState(props);

  const [collapsed, setCollapsed] = usePersistedJsonState<StepSectionCollapsedState>(
    "fyreflow:step-panel-collapsed-sections",
    DEFAULT_STEP_SECTION_COLLAPSED_STATE,
    isStepSectionCollapsedState
  );
  const [stepPanelTab, setStepPanelTab] = usePersistedTab<StepPanelTab>(
    "fyreflow:step-panel-tab",
    "configure",
    STEP_PANEL_TABS
  );

  const hadActiveRunRef = useRef(!!props.activeRun);
  useEffect(() => {
    const hasRun = !!props.activeRun;
    if (hadActiveRunRef.current && !hasRun && stepPanelTab === "activity") {
      setStepPanelTab("configure");
    }
    hadActiveRunRef.current = hasRun;
  }, [props.activeRun, stepPanelTab, setStepPanelTab]);

  const toggleSection = useCallback((section: StepSection) => {
    setCollapsed((prev) => {
      return {
        ...prev,
        [section]: !prev[section]
      };
    });
  }, []);

  const gateCount = (draft.qualityGates ?? []).length;
  const isSingleStepPanelOpen = !!selectedStep && selectedStepIds.length === 1;
  const canvasRunStatus = props.activeRun?.status === "running" ||
    props.activeRun?.status === "paused" ||
    props.activeRun?.status === "queued" ||
    props.activeRun?.status === "awaiting_approval"
    ? props.activeRun.status
    : props.startingRun
      ? "queued"
      : null;

  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-0 overflow-hidden bg-[rgb(var(--glass-bg))]">
        <PipelineCanvas
          nodes={canvasNodes}
          links={canvasLinks}
          animatedNodeIds={animatedNodeIds}
          animatedLinkIds={animatedLinkIds}
          runStatus={canvasRunStatus}
          readOnly={readOnly}
          selectedNodeId={selectedStepId}
          selectedNodeIds={selectedStepIds}
          selectedLinkId={selectedLinkId}
          onAutoLayout={readOnly ? undefined : applyAutoLayout}
          onSelectionChange={handleCanvasSelectionChange}
          onAddNode={() => {}}
          onMoveNode={handleCanvasMoveNode}
          onMoveNodes={handleCanvasMoveNodes}
          onDragStateChange={onCanvasDragStateChange}
          onConnectNodes={handleCanvasConnectNodes}
          onDeleteNodes={readOnly ? undefined : removeStepsByIds}
          onDeleteLink={readOnly ? undefined : removeLinkById}
          showToolbar={false}
          canvasHeight="100%"
          className="h-full"
        />

        <SlidePanel open={isSingleStepPanelOpen} side="right" className="w-full max-w-[430px]">
          {isSingleStepPanelOpen && selectedStep ? (
            <div className={cn("h-full", stepPanelTab === "activity" ? "flex flex-col overflow-hidden" : "overflow-y-auto pb-20")}>
              <div className="mb-1 flex shrink-0 items-start justify-between gap-3 px-4 pt-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ember-500/10 text-ember-400">
                    <Bot className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
                      Step {selectedStepIndex + 1}
                    </p>
                    <p className="text-base font-semibold text-ink-50">
                      {selectedStep.name || "Untitled step"}
                    </p>
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
                    onClick={() => {
                      setSelectedStepId(null);
                    }}
                    className="rounded-lg p-1.5 text-ink-600 transition-colors hover:bg-ink-800 hover:text-ink-200"
                    aria-label="Close panel"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {readOnly ? (
                <p className="mx-4 mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
                  This flow is running. Step edits are locked until it finishes or is stopped.
                </p>
              ) : null}

              <div className="shrink-0 px-4 py-2">
                <SegmentedControl
                  segments={STEP_PANEL_SEGMENTS}
                  value={stepPanelTab}
                  onValueChange={setStepPanelTab}
                />
              </div>

              {stepPanelTab === "configure" ? (
                <div className={cn(readOnly && "opacity-70")}>
                  <CollapsibleSection
                    icon={<CircleDot className="h-3.5 w-3.5" />}
                    label="Identity"
                    collapsed={collapsed.identity}
                    onToggle={() => toggleSection("identity")}
                    disableContent={readOnly}
                  >
                    <BasicFields
                      selectedStep={selectedStep}
                      selectedStepIndex={selectedStepIndex}
                      onPatchSelectedStep={patchSelectedStep}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    icon={<Brain className="h-3.5 w-3.5" />}
                    label="Model"
                    collapsed={collapsed.model}
                    onToggle={() => toggleSection("model")}
                    disableContent={readOnly}
                  >
                    <ExecutionModeField
                      modelCatalog={props.modelCatalog}
                      selectedStep={selectedStep}
                      selectedModelMeta={selectedModelMeta}
                      reasoningModes={reasoningModes}
                      providerDefaultModel={providerDefaultModel}
                      onPatchSelectedStep={patchSelectedStep}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    icon={<Zap className="h-3.5 w-3.5" />}
                    label="Runtime"
                    collapsed={collapsed.runtime}
                    onToggle={() => toggleSection("runtime")}
                    disableContent={readOnly}
                  >
                    <RetryPolicyField
                      mcpServers={props.mcpServers}
                      selectedStep={selectedStep}
                      selectedModelMeta={selectedModelMeta}
                      claudeFastModeAvailable={claudeFastModeAvailable}
                      claudeFastModeUnavailableNote={claudeFastModeUnavailableNote}
                      onPatchSelectedStep={patchSelectedStep}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    icon={<MessageSquareText className="h-3.5 w-3.5" />}
                    label="Prompt"
                    collapsed={collapsed.prompt}
                    onToggle={() => toggleSection("prompt")}
                    disableContent={readOnly}
                  >
                    <TimeoutField
                      selectedStep={selectedStep}
                      onPatchSelectedStep={patchSelectedStep}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    icon={<Cable className="h-3.5 w-3.5" />}
                    label="Connections"
                    collapsed={collapsed.connections}
                    onToggle={() => toggleSection("connections")}
                    disableContent={readOnly}
                  >
                    <SchedulingFields
                      draft={draft}
                      selectedStepId={selectedStep.id}
                      stepNameById={stepNameById}
                      outgoingLinks={outgoingLinks}
                      incomingLinks={incomingLinks}
                      pendingTargetId={pendingTargetId}
                      pendingCondition={pendingCondition}
                      setPendingTargetId={setPendingTargetId}
                      setPendingCondition={setPendingCondition}
                      onAddConnection={addConnectionFromSelectedStep}
                      onUpdateLinkCondition={updateConnectionCondition}
                      onRemoveLink={removeLinkById}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    icon={<ShieldCheck className="h-3.5 w-3.5" />}
                    label="Quality Gates"
                    collapsed={collapsed.qualityGates}
                    onToggle={() => toggleSection("qualityGates")}
                    disableContent={readOnly}
                    badge={gateCount > 0 ? <Badge variant="neutral">{gateCount}</Badge> : undefined}
                  >
                    <QualityGatesSection
                      draft={draft}
                      readOnly={readOnly}
                      onChange={props.onChange}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    icon={<CalendarClock className="h-3.5 w-3.5" />}
                    label="Schedule"
                    collapsed={collapsed.schedule}
                    onToggle={() => toggleSection("schedule")}
                    disableContent={readOnly}
                  >
                    <ScheduleSection
                      draft={draft}
                      readOnly={readOnly}
                      onChange={props.onChange}
                    />
                  </CollapsibleSection>
                </div>
              ) : (
                <StepLiveActivitySection
                  activeRun={props.activeRun}
                  selectedStep={selectedStep}
                />
              )}
            </div>
          ) : null}
        </SlidePanel>
      </div>
    </div>
  );
}
