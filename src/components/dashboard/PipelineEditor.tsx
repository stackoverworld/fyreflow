import { useCallback, useState } from "react";
import {
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
import { cn } from "@/lib/cn";
import { CollapsibleSection } from "./pipeline-editor/sections/CollapsibleSection";
import { BasicFields } from "./pipeline-editor/sections/general/BasicFields";
import { ExecutionModeField } from "./pipeline-editor/sections/general/execution-fields/ExecutionModeField";
import { RetryPolicyField } from "./pipeline-editor/sections/general/execution-fields/RetryPolicyField";
import { TimeoutField } from "./pipeline-editor/sections/general/execution-fields/TimeoutField";
import { SchedulingFields } from "./pipeline-editor/sections/general/SchedulingFields";
import { QualityGatesSection } from "./pipeline-editor/sections/QualityGatesSection";
import { ScheduleSection } from "./pipeline-editor/sections/ScheduleSection";
import { usePipelineEditorState } from "./pipeline-editor/usePipelineEditorState";
import type { PipelineEditorProps } from "./pipeline-editor/types";

type StepSection = "identity" | "model" | "runtime" | "prompt" | "connections" | "qualityGates" | "schedule";

export function PipelineEditor(props: PipelineEditorProps) {
  const {
    draft,
    readOnly = false,
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

  const [collapsed, setCollapsed] = useState<Set<StepSection>>(
    new Set(["runtime", "prompt", "connections", "qualityGates", "schedule"])
  );

  const toggleSection = useCallback((section: StepSection) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const gateCount = (draft.qualityGates ?? []).length;
  const isSingleStepPanelOpen = !!selectedStep && selectedStepIds.length === 1;

  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-0 overflow-hidden bg-[rgb(var(--glass-bg))]">
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
            <div className="h-full overflow-y-auto pb-20">
              <div className="mb-1 flex items-start justify-between gap-3 px-4 pt-4">
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
                <p className="mx-4 mb-2 rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-300">
                  This flow is running. Step edits are locked until it finishes or is stopped.
                </p>
              ) : null}

              <fieldset disabled={readOnly} className={cn(readOnly && "opacity-70")}>
                <CollapsibleSection
                  icon={<CircleDot className="h-3.5 w-3.5" />}
                  label="Identity"
                  collapsed={collapsed.has("identity")}
                  onToggle={() => toggleSection("identity")}
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
                  collapsed={collapsed.has("model")}
                  onToggle={() => toggleSection("model")}
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
                  collapsed={collapsed.has("runtime")}
                  onToggle={() => toggleSection("runtime")}
                >
                  <RetryPolicyField
                    mcpServers={props.mcpServers}
                    selectedStep={selectedStep}
                    selectedModelMeta={selectedModelMeta}
                    onPatchSelectedStep={patchSelectedStep}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  icon={<MessageSquareText className="h-3.5 w-3.5" />}
                  label="Prompt"
                  collapsed={collapsed.has("prompt")}
                  onToggle={() => toggleSection("prompt")}
                >
                  <TimeoutField
                    selectedStep={selectedStep}
                    onPatchSelectedStep={patchSelectedStep}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  icon={<Cable className="h-3.5 w-3.5" />}
                  label="Connections"
                  collapsed={collapsed.has("connections")}
                  onToggle={() => toggleSection("connections")}
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
                  collapsed={collapsed.has("qualityGates")}
                  onToggle={() => toggleSection("qualityGates")}
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
                  collapsed={collapsed.has("schedule")}
                  onToggle={() => toggleSection("schedule")}
                >
                  <ScheduleSection
                    draft={draft}
                    readOnly={readOnly}
                    onChange={props.onChange}
                  />
                </CollapsibleSection>
              </fieldset>
            </div>
          ) : null}
        </SlidePanel>
      </div>
    </div>
  );
}
