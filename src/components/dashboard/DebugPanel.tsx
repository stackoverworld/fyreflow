import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, TerminalSquare } from "lucide-react";

import type { Pipeline, PipelinePayload, PipelineRun, SmartRunPlan } from "@/lib/types";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import {
  formatAiChatDebugEvent,
  loadAiChatDebugEvents,
  subscribeAiChatDebug
} from "@/lib/aiChatDebugStorage";
import { usePersistedTab } from "./usePersistedTab";
import { copyTextToClipboard } from "./debug/utils";

import { StateTab } from "./debug/tabs/StateTab";
import { ConsoleTab } from "./debug/tabs/ConsoleTab";
import { ChecksTab } from "./debug/tabs/ChecksTab";
import { PreviewToolsSection } from "./debug/PreviewToolsSection";

type DebugTab = "state" | "console" | "checks";

const DEBUG_TABS = ["state", "console", "checks"] as const;

const TAB_SEGMENTS: Segment<DebugTab>[] = [
  { value: "state", label: "State", icon: <Activity className="h-3.5 w-3.5" /> },
  { value: "console", label: "Console", icon: <TerminalSquare className="h-3.5 w-3.5" /> },
  { value: "checks", label: "Checks", icon: <CheckCircle2 className="h-3.5 w-3.5" /> }
];

interface DebugPanelProps {
  draft: PipelinePayload;
  selectedPipeline: Pipeline | undefined;
  aiWorkflowKey: string;
  runs: PipelineRun[];
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  startingRun: boolean;
  mockRunActive: boolean;
  realRunActive: boolean;
  onMockRunChange: (active: boolean) => void;
  dispatchPreviewRouteId: string | null;
  onDispatchPreviewRouteIdChange: (routeId: string | null) => void;
  onPreviewRunCompletionModal: () => void;
}

export function DebugPanel({
  draft,
  selectedPipeline,
  aiWorkflowKey,
  runs,
  smartRunPlan,
  loadingSmartRunPlan,
  startingRun,
  mockRunActive,
  realRunActive,
  onMockRunChange,
  dispatchPreviewRouteId,
  onDispatchPreviewRouteIdChange,
  onPreviewRunCompletionModal
}: DebugPanelProps) {
  const [activeTab, handleTabChange] = usePersistedTab<DebugTab>("fyreflow:debug-tab", "state", DEBUG_TABS);
  const [logsCopyState, setLogsCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [aiLogsCopyState, setAiLogsCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [stepCopyState, setStepCopyState] = useState<{ key: string; status: "copied" | "error" } | null>(null);
  const [aiDebugLines, setAiDebugLines] = useState<string[]>([]);

  const scopedRuns = useMemo(() => {
    if (!selectedPipeline) {
      return [];
    }
    return runs.filter((run) => run.pipelineId === selectedPipeline.id).slice(0, 24);
  }, [runs, selectedPipeline]);

  const activeRun = useMemo(() => {
    const running = scopedRuns.find((run) => run.status === "running");
    if (running) return running;

    const awaiting = scopedRuns.find((run) => run.status === "awaiting_approval");
    if (awaiting) return awaiting;

    const paused = scopedRuns.find((run) => run.status === "paused");
    if (paused) return paused;

    const queued = scopedRuns.find((run) => run.status === "queued");
    if (queued) return queued;

    return scopedRuns[0] ?? null;
  }, [scopedRuns]);

  const activeStep = useMemo(() => {
    if (!activeRun) return null;
    return activeRun.steps.find((step) => step.status === "running") ?? null;
  }, [activeRun]);

  const passCount = (smartRunPlan?.checks ?? []).filter((check) => check.status === "pass").length;
  const blockedGateCount = useMemo(() => {
    if (!activeRun) return 0;
    return activeRun.steps.reduce((count, step) => {
      const failedBlocking = step.qualityGateResults.filter((gate) => gate.status === "fail" && gate.blocking).length;
      return count + failedBlocking;
    }, 0);
  }, [activeRun]);

  const recentLogs = activeRun?.logs.slice(-120) ?? [];
  const logsText = recentLogs.join("\n");
  const aiLogsText = aiDebugLines.join("\n");

  useEffect(() => {
    setAiDebugLines(loadAiChatDebugEvents(aiWorkflowKey).slice(-120).map((entry) => formatAiChatDebugEvent(entry)));
    return subscribeAiChatDebug(aiWorkflowKey, () => {
      setAiDebugLines(loadAiChatDebugEvents(aiWorkflowKey).slice(-120).map((entry) => formatAiChatDebugEvent(entry)));
    });
  }, [aiWorkflowKey]);

  useEffect(() => {
    if (logsCopyState === "idle") return;
    const timer = window.setTimeout(() => setLogsCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [logsCopyState]);

  useEffect(() => {
    if (aiLogsCopyState === "idle") return;
    const timer = window.setTimeout(() => setAiLogsCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [aiLogsCopyState]);

  useEffect(() => {
    if (!stepCopyState) return;
    const timer = window.setTimeout(() => setStepCopyState(null), 1800);
    return () => window.clearTimeout(timer);
  }, [stepCopyState]);

  const handleCopyLogs = async () => {
    if (logsText.length === 0) return;
    const copied = await copyTextToClipboard(logsText);
    setLogsCopyState(copied ? "copied" : "error");
  };

  const handleCopyStepLogs = async (stepKey: string, output: string) => {
    if (output.length === 0) return;
    const copied = await copyTextToClipboard(output);
    setStepCopyState({ key: stepKey, status: copied ? "copied" : "error" });
  };

  const handleCopyAiLogs = async () => {
    if (aiLogsText.length === 0) return;
    const copied = await copyTextToClipboard(aiLogsText);
    setAiLogsCopyState(copied ? "copied" : "error");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-[var(--divider)] bg-[var(--surface-base)] px-3 py-2">
        <SegmentedControl segments={TAB_SEGMENTS} value={activeTab} onValueChange={handleTabChange} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "state" && (
          <StateTab
            selectedPipeline={selectedPipeline}
            activeRun={activeRun}
            activeStep={activeStep}
            startingRun={startingRun}
            blockedGateCount={blockedGateCount}
          />
        )}

        {activeTab === "console" && (
          <ConsoleTab
            recentLogs={recentLogs}
            logsText={logsText}
            aiDebugLines={aiDebugLines}
            aiLogsText={aiLogsText}
            logsCopyState={logsCopyState}
            aiLogsCopyState={aiLogsCopyState}
            onCopyLogs={handleCopyLogs}
            onCopyAiLogs={handleCopyAiLogs}
          />
        )}

        {activeTab === "checks" && (
          <ChecksTab
            activeRun={activeRun}
            smartRunPlan={smartRunPlan}
            loadingSmartRunPlan={loadingSmartRunPlan}
            passCount={passCount}
            stepCopyState={stepCopyState}
            onCopyStepLogs={handleCopyStepLogs}
          />
        )}

        <PreviewToolsSection
          draft={draft}
          mockRunActive={mockRunActive}
          realRunActive={realRunActive}
          onMockRunChange={onMockRunChange}
          dispatchPreviewRouteId={dispatchPreviewRouteId}
          onDispatchPreviewRouteIdChange={onDispatchPreviewRouteIdChange}
          onPreviewRunCompletionModal={onPreviewRunCompletionModal}
        />
      </div>
    </div>
  );
}
