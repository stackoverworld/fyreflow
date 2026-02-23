import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical } from "lucide-react";

import { Button } from "@/components/optics/button";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import {
  buildPotentialDispatchRouteId,
  parsePotentialDispatchRouteId
} from "@/components/dashboard/pipeline-canvas/potentialDispatchRouteId";
import { CollapsibleSection } from "@/components/dashboard/pipeline-editor/sections/CollapsibleSection";
import { usePersistedCollapsed } from "@/components/dashboard/usePersistedCollapsed";
import type { PipelinePayload } from "@/lib/types";

interface PreviewToolsSectionProps {
  draft: PipelinePayload;
  mockRunActive: boolean;
  realRunActive: boolean;
  onMockRunChange: (active: boolean) => void;
  dispatchPreviewRouteId: string | null;
  onDispatchPreviewRouteIdChange: (routeId: string | null) => void;
  onPreviewRunCompletionModal: () => void;
}

export function PreviewToolsSection({
  draft,
  mockRunActive,
  realRunActive,
  onMockRunChange,
  dispatchPreviewRouteId,
  onDispatchPreviewRouteIdChange,
  onPreviewRunCompletionModal
}: PreviewToolsSectionProps) {
  const [collapsed, setCollapsed] = usePersistedCollapsed("fyreflow:debug-preview-tools", true);
  const [selectedOrchestratorId, setSelectedOrchestratorId] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const dispatchPreviewLocked = realRunActive || mockRunActive;
  const dispatchPreviewEnabled = Boolean(dispatchPreviewRouteId);

  const orchestratorOptions = useMemo(
    () =>
      draft.steps
        .filter((step) => step.role === "orchestrator")
        .map((step, index) => ({ value: step.id, label: step.name || `Orchestrator ${index + 1}` })),
    [draft.steps]
  );
  const targetOptions = useMemo(
    () =>
      draft.steps
        .filter((step) => step.role !== "orchestrator")
        .map((step, index) => ({ value: step.id, label: step.name || `Instance ${index + 1}` })),
    [draft.steps]
  );
  const canPreviewDispatch = orchestratorOptions.length > 0 && targetOptions.length > 0 && !dispatchPreviewLocked;

  useEffect(() => {
    const parsedRoute = dispatchPreviewRouteId ? parsePotentialDispatchRouteId(dispatchPreviewRouteId) : null;
    const preferredOrchestratorId =
      parsedRoute && orchestratorOptions.some((option) => option.value === parsedRoute.orchestratorId)
        ? parsedRoute.orchestratorId
        : orchestratorOptions[0]?.value ?? "";
    const preferredTargetId =
      parsedRoute && targetOptions.some((option) => option.value === parsedRoute.targetNodeId)
        ? parsedRoute.targetNodeId
        : targetOptions[0]?.value ?? "";

    setSelectedOrchestratorId((current) => {
      if (preferredOrchestratorId) {
        return preferredOrchestratorId;
      }
      if (orchestratorOptions.some((option) => option.value === current)) {
        return current;
      }
      return "";
    });

    setSelectedTargetId((current) => {
      if (preferredTargetId) {
        return preferredTargetId;
      }
      if (targetOptions.some((option) => option.value === current)) {
        return current;
      }
      return "";
    });
  }, [dispatchPreviewRouteId, orchestratorOptions, targetOptions]);

  useEffect(() => {
    if (!dispatchPreviewEnabled) {
      return;
    }

    if (!canPreviewDispatch || !selectedOrchestratorId || !selectedTargetId) {
      onDispatchPreviewRouteIdChange(null);
    }
  }, [
    canPreviewDispatch,
    dispatchPreviewEnabled,
    onDispatchPreviewRouteIdChange,
    selectedOrchestratorId,
    selectedTargetId
  ]);

  useEffect(() => {
    if (!dispatchPreviewEnabled || !dispatchPreviewRouteId || !canPreviewDispatch) {
      return;
    }

    const parsedRoute = parsePotentialDispatchRouteId(dispatchPreviewRouteId);
    if (
      parsedRoute &&
      parsedRoute.orchestratorId === selectedOrchestratorId &&
      parsedRoute.targetNodeId === selectedTargetId
    ) {
      return;
    }

    if (selectedOrchestratorId && selectedTargetId) {
      onDispatchPreviewRouteIdChange(buildPotentialDispatchRouteId(selectedOrchestratorId, selectedTargetId));
    }
  }, [
    canPreviewDispatch,
    dispatchPreviewEnabled,
    dispatchPreviewRouteId,
    onDispatchPreviewRouteIdChange,
    selectedOrchestratorId,
    selectedTargetId
  ]);

  const applyDispatchPreviewRoute = (orchestratorId: string, targetId: string, enabled: boolean) => {
    if (!enabled || !canPreviewDispatch || !orchestratorId || !targetId) {
      onDispatchPreviewRouteIdChange(null);
      return;
    }

    onDispatchPreviewRouteIdChange(buildPotentialDispatchRouteId(orchestratorId, targetId));
  };

  return (
    <CollapsibleSection
      icon={<FlaskConical className="h-3.5 w-3.5" />}
      label="Preview tools"
      collapsed={collapsed}
      onToggle={() => setCollapsed((prev) => !prev)}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink-200">Mock running state</p>
              <p className="text-[11px] text-ink-500">
                {realRunActive
                  ? "Disabled while a real pipeline run is active."
                  : "Simulate a running pipeline to test canvas border glow and node animations."}
              </p>
            </div>
            <Switch checked={mockRunActive} disabled={realRunActive} onChange={onMockRunChange} />
          </div>
        </div>

        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-ink-200">Orchestrator dispatch preview</p>
                <p className="text-[11px] text-ink-500">
                  Simulate a running orchestrator route to inspect arrow animation without starting a real run.
                </p>
              </div>
              <Switch
                checked={dispatchPreviewEnabled}
                disabled={!canPreviewDispatch}
                onChange={(nextEnabled) => {
                  if (nextEnabled) {
                    const nextOrchestratorId = selectedOrchestratorId || orchestratorOptions[0]?.value || "";
                    const nextTargetId = selectedTargetId || targetOptions[0]?.value || "";
                    setSelectedOrchestratorId(nextOrchestratorId);
                    setSelectedTargetId(nextTargetId);
                    applyDispatchPreviewRoute(nextOrchestratorId, nextTargetId, true);
                    return;
                  }

                  applyDispatchPreviewRoute(selectedOrchestratorId, selectedTargetId, false);
                }}
              />
            </div>

            <div className="grid grid-cols-1 gap-2">
              <label className="block space-y-1.5">
                <span className="text-[11px] text-ink-400">Orchestrator</span>
                <Select
                  value={selectedOrchestratorId}
                  onValueChange={(nextOrchestratorId) => {
                    setSelectedOrchestratorId(nextOrchestratorId);
                    if (dispatchPreviewEnabled) {
                      applyDispatchPreviewRoute(nextOrchestratorId, selectedTargetId, true);
                    }
                  }}
                  options={orchestratorOptions}
                  placeholder="Select orchestrator"
                  disabled={!canPreviewDispatch}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] text-ink-400">Target instance</span>
                <Select
                  value={selectedTargetId}
                  onValueChange={(nextTargetId) => {
                    setSelectedTargetId(nextTargetId);
                    if (dispatchPreviewEnabled) {
                      applyDispatchPreviewRoute(selectedOrchestratorId, nextTargetId, true);
                    }
                  }}
                  options={targetOptions}
                  placeholder="Select target instance"
                  disabled={!canPreviewDispatch}
                />
              </label>
            </div>

            <p className="text-[11px] text-ink-500">
              {dispatchPreviewLocked
                ? "Disable mock/real running state before enabling dispatch preview."
                : orchestratorOptions.length === 0
                  ? "Add at least one orchestrator step to use this preview."
                  : targetOptions.length === 0
                    ? "Add at least one non-orchestrator step to target."
                    : "When enabled, the selected dispatch path is rendered as an active running route."}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink-200">Run completion modal</p>
              <p className="text-[11px] text-ink-500">Open a temporary mock to review and tune completion UI.</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0 whitespace-nowrap"
              onClick={onPreviewRunCompletionModal}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Open test modal
            </Button>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}
