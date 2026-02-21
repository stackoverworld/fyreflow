import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical } from "lucide-react";

import type { Pipeline, PipelineRun, RunStatus, SmartRunPlan, StepRunStatus } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Switch } from "@/components/optics/switch";

import { EventLogSection } from "./debug/sections/EventLogSection";
import { RunStateSection } from "./debug/sections/RunStateSection";

export type DebugSection = "trace" | "step" | "logs" | "preflight" | "timeline";

interface DebugPanelProps {
  selectedPipeline: Pipeline | undefined;
  runs: PipelineRun[];
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  startingRun: boolean;
  mockRunActive: boolean;
  onMockRunChange: (active: boolean) => void;
  onPreviewRunCompletionModal: () => void;
}

function runBadgeVariant(status: RunStatus): "neutral" | "success" | "running" | "danger" | "warning" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "running") {
    return "running";
  }
  return "warning";
}

function stepBadgeVariant(status: StepRunStatus): "neutral" | "success" | "running" | "danger" | "warning" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "running") {
    return "running";
  }
  return "neutral";
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleString();
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    if (typeof document !== "undefined") {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "absolute";
      helper.style.left = "-9999px";
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(helper);
      return copied;
    }

    return false;
  } catch {
    return false;
  }
}

export function DebugPanel({
  selectedPipeline,
  runs,
  smartRunPlan,
  loadingSmartRunPlan,
  startingRun,
  mockRunActive,
  onMockRunChange,
  onPreviewRunCompletionModal
}: DebugPanelProps) {
  const [logsCopyState, setLogsCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [stepCopyState, setStepCopyState] = useState<{ key: string; status: "copied" | "error" } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<DebugSection>>(new Set());

  const toggle = (section: DebugSection) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const scopedRuns = useMemo(() => {
    if (!selectedPipeline) {
      return [];
    }
    return runs.filter((run) => run.pipelineId === selectedPipeline.id).slice(0, 24);
  }, [runs, selectedPipeline]);

  const activeRun = useMemo(() => {
    const running = scopedRuns.find((run) => run.status === "running");
    if (running) {
      return running;
    }

    const awaiting = scopedRuns.find((run) => run.status === "awaiting_approval");
    if (awaiting) {
      return awaiting;
    }

    const paused = scopedRuns.find((run) => run.status === "paused");
    if (paused) {
      return paused;
    }

    const queued = scopedRuns.find((run) => run.status === "queued");
    if (queued) {
      return queued;
    }

    return scopedRuns[0] ?? null;
  }, [scopedRuns]);

  const activeStep = useMemo(() => {
    if (!activeRun) {
      return null;
    }
    return activeRun.steps.find((step) => step.status === "running") ?? null;
  }, [activeRun]);

  const passCount = (smartRunPlan?.checks ?? []).filter((check) => check.status === "pass").length;
  const blockedGateCount = useMemo(() => {
    if (!activeRun) {
      return 0;
    }

    return activeRun.steps.reduce((count, step) => {
      const failedBlocking = step.qualityGateResults.filter((gate) => gate.status === "fail" && gate.blocking).length;
      return count + failedBlocking;
    }, 0);
  }, [activeRun]);
  const recentLogs = activeRun?.logs.slice(-120) ?? [];
  const logsText = recentLogs.join("\n");

  useEffect(() => {
    if (logsCopyState === "idle") {
      return;
    }

    const timer = window.setTimeout(() => {
      setLogsCopyState("idle");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [logsCopyState]);

  useEffect(() => {
    if (!stepCopyState) {
      return;
    }

    const timer = window.setTimeout(() => {
      setStepCopyState(null);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [stepCopyState]);

  const handleCopyLogs = async () => {
    if (logsText.length === 0) {
      return;
    }

    const copied = await copyTextToClipboard(logsText);
    setLogsCopyState(copied ? "copied" : "error");
  };

  const handleCopyStepLogs = async (stepKey: string, output: string) => {
    if (output.length === 0) {
      return;
    }

    const copied = await copyTextToClipboard(output);
    setStepCopyState({ key: stepKey, status: copied ? "copied" : "error" });
  };

  return (
    <div>
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-ink-400">
          <FlaskConical className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Preview tools</span>
        </div>

        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink-200">Mock running state</p>
              <p className="text-[11px] text-ink-500">Simulate a running pipeline to test canvas border glow and node animations.</p>
            </div>
            <Switch checked={mockRunActive} onChange={onMockRunChange} />
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
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <RunStateSection
        selectedPipeline={selectedPipeline}
        activeRun={activeRun}
        activeStep={activeStep}
        startingRun={startingRun}
        blockedGateCount={blockedGateCount}
        collapsed={collapsed}
        onToggle={toggle}
        formatTime={formatTime}
        runBadgeVariant={runBadgeVariant}
        stepBadgeVariant={stepBadgeVariant}
      />

      <div className="my-5 h-px bg-[var(--divider)]" />

      <EventLogSection
        activeRun={activeRun}
        smartRunPlan={smartRunPlan}
        loadingSmartRunPlan={loadingSmartRunPlan}
        passCount={passCount}
        collapsed={collapsed}
        onToggle={toggle}
        logsText={logsText}
        recentLogs={recentLogs}
        logsCopyState={logsCopyState}
        stepCopyState={stepCopyState}
        formatTime={formatTime}
        onCopyLogs={handleCopyLogs}
        onCopyStepLogs={handleCopyStepLogs}
        stepBadgeVariant={stepBadgeVariant}
      />
    </div>
  );
}
