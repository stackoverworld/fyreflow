import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDown, Brain, Check, Copy, FileText, MessageSquareText, Search, TerminalSquare, Wrench, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/optics/button";
import { Badge } from "@/components/optics/badge";
import { Tooltip } from "@/components/optics/tooltip";
import { useAutoScroll } from "@/components/dashboard/debug/useAutoScroll";
import { copyTextToClipboard } from "@/components/dashboard/debug/utils";
import { subscribeRunEvents } from "@/lib/api";
import type { PipelinePayload, PipelineRun } from "@/lib/types";
import { deriveStepLiveActivityEvents, deriveStepLiveActivityLines, type StepLiveActivityEvent } from "../liveActivity";

interface StepLiveActivitySectionProps {
  activeRun?: PipelineRun | null;
  selectedStep: PipelinePayload["steps"][number];
}

interface RunLogEventPayload {
  runId?: string;
  logIndex?: number;
  message?: string;
  status?: string;
  at?: string;
}

interface StreamedLogEntry {
  logIndex: number;
  message: string;
}

type StreamState = "idle" | "connecting" | "live" | "error";

function statusBadgeVariant(status: PipelineRun["status"]): "neutral" | "success" | "running" | "danger" | "warning" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "paused" || status === "awaiting_approval") {
    return "warning";
  }
  return "neutral";
}

function outcomeLabel(outcome: string | undefined): string {
  if (outcome === "pass") return "Passed";
  if (outcome === "fail") return "Failed";
  return "Pending";
}

function isTerminalRunStatus(status: PipelineRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function toRunLogPayload(value: unknown): RunLogEventPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  return {
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    logIndex: typeof payload.logIndex === "number" ? payload.logIndex : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    status: typeof payload.status === "string" ? payload.status : undefined,
    at: typeof payload.at === "string" ? payload.at : undefined
  };
}

function insertOrUpdateLogEntry(entries: StreamedLogEntry[], incoming: StreamedLogEntry): StreamedLogEntry[] {
  const index = entries.findIndex((entry) => entry.logIndex === incoming.logIndex);
  if (index === -1) {
    return [...entries, incoming].sort((left, right) => left.logIndex - right.logIndex);
  }

  const next = [...entries];
  next[index] = incoming;
  return next;
}

function activityEventIcon(event: StepLiveActivityEvent) {
  if (event.kind === "thinking") {
    return Brain;
  }
  if (event.kind === "summary") {
    return MessageSquareText;
  }
  if (event.kind === "command" || event.kind === "command_progress") {
    return TerminalSquare;
  }
  if (event.kind === "tool") {
    const t = event.title.toLowerCase();
    if (t.includes("read file") || t.includes("write file") || t.includes("edit file")) {
      return FileText;
    }
    if (t.includes("search text") || t.includes("find files")) {
      return Search;
    }
    return Wrench;
  }
  if (event.kind === "error") {
    return AlertTriangle;
  }
  return Info;
}

function activityEventAccent(event: StepLiveActivityEvent): { border: string; icon: string } {
  if (event.kind === "error") {
    return { border: "border-l-ink-600", icon: "text-ink-300" };
  }
  return { border: "border-l-ink-700", icon: "text-ink-400" };
}

function renderEventDetail(event: StepLiveActivityEvent): JSX.Element | null {
  if (event.command) {
    return (
      <div className="mt-2 space-y-2">
        <pre className="overflow-auto rounded-md border border-ink-800/50 bg-[var(--surface-inset)] px-2 py-1.5 font-mono text-[11px] text-ink-300">
          {event.command}
        </pre>
        {event.cwd ? (
          <p className="text-[11px] text-ink-400">
            Working dir: <code className="font-mono text-ink-200">{event.cwd}</code>
          </p>
        ) : null}
        {event.detail ? <p className="text-[11px] text-ink-400">{event.detail}</p> : null}
      </div>
    );
  }

  if (!event.detail) {
    return null;
  }

  if (event.kind === "output") {
    return (
      <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border border-ink-800/50 bg-[var(--surface-inset)] px-2 py-1.5 font-mono text-[11px] text-ink-300">
        {event.detail}
      </pre>
    );
  }

  return <p className="mt-2 whitespace-pre-wrap text-[11px] text-ink-400">{event.detail}</p>;
}

export function StepLiveActivitySection({ activeRun, selectedStep }: StepLiveActivitySectionProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamedLogs, setStreamedLogs] = useState<StreamedLogEntry[]>([]);

  useEffect(() => {
    setStreamedLogs([]);
    setStreamError(null);
    if (!activeRun || isTerminalRunStatus(activeRun.status)) {
      setStreamState("idle");
      return;
    }

    setStreamState("connecting");
    const unsubscribe = subscribeRunEvents(activeRun.id, {
      cursor: activeRun.logs.length,
      onOpen: () => {
        setStreamState("live");
      },
      onEvent: (event) => {
        const payload = toRunLogPayload(event.data);
        if (event.event === "log" && payload && typeof payload.logIndex === "number" && typeof payload.message === "string") {
          setStreamedLogs((prev) =>
            insertOrUpdateLogEntry(prev, {
              logIndex: payload.logIndex,
              message: payload.message
            })
          );
          return;
        }

        if (event.event === "complete") {
          setStreamState("idle");
          return;
        }

        if (event.event === "error") {
          setStreamState("error");
          const nextError = typeof payload?.message === "string" ? payload.message : "Live activity stream failed.";
          setStreamError(nextError);
        }
      },
      onError: (error) => {
        setStreamState("error");
        setStreamError(error.message);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeRun?.id]);

  useEffect(() => {
    if (!activeRun) {
      setStreamedLogs([]);
      return;
    }

    const cutoff = activeRun.logs.length;
    setStreamedLogs((prev) => prev.filter((entry) => entry.logIndex >= cutoff));
  }, [activeRun?.id, activeRun?.logs.length]);

  const mergedLogs = useMemo(() => {
    if (!activeRun) {
      return [];
    }

    const byIndex = new Map<number, string>();
    activeRun.logs.forEach((line, index) => {
      byIndex.set(index, line);
    });
    for (const entry of streamedLogs) {
      if (!byIndex.has(entry.logIndex)) {
        byIndex.set(entry.logIndex, entry.message);
      }
    }

    return [...byIndex.entries()]
      .sort((left, right) => left[0] - right[0])
      .map((entry) => entry[1]);
  }, [activeRun, streamedLogs]);

  const mergedRun = useMemo(() => {
    if (!activeRun) {
      return null;
    }
    if (mergedLogs === activeRun.logs) {
      return activeRun;
    }
    return {
      ...activeRun,
      logs: mergedLogs
    };
  }, [activeRun, mergedLogs]);

  const stepRun = useMemo(
    () => activeRun?.steps.find((entry) => entry.stepId === selectedStep.id),
    [activeRun?.steps, selectedStep.id]
  );

  const activityEvents = useMemo(
    () => deriveStepLiveActivityEvents(mergedRun, selectedStep),
    [mergedRun, selectedStep]
  );
  const activityLines = useMemo(
    () => deriveStepLiveActivityLines(mergedRun, selectedStep),
    [mergedRun, selectedStep]
  );
  const activityText = activityLines.join("\n");
  const latestSummaryEvent = useMemo(() => {
    for (let index = activityEvents.length - 1; index >= 0; index -= 1) {
      const event = activityEvents[index];
      if (event?.kind === "summary" && typeof event.detail === "string" && event.detail.trim().length > 0) {
        return event;
      }
    }
    return null;
  }, [activityEvents]);
  const scrollSignal = `${activityEvents.length}:${activityEvents.map((event) => event.id).join("|")}`;
  const activityScroll = useAutoScroll(scrollSignal);

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(activityText);
    setCopyState(copied ? "copied" : "error");
    window.setTimeout(() => setCopyState("idle"), copied ? 1_200 : 1_600);
  };

  if (!activeRun) {
    return (
      <section className="space-y-4 px-4 pb-6 pt-3">
        <div className="flex items-center gap-2 text-ink-400">
          <Activity className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Live Activity</span>
        </div>
        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
          Start a run to see model activity for this step in real time.
        </div>
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="shrink-0 space-y-4 px-4 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink-400">
            <Activity className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Live Activity</span>
          </div>
          <Badge variant={statusBadgeVariant(activeRun.status)}>{activeRun.status}</Badge>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink-200">{stepRun?.stepName ?? (selectedStep.name || "Selected step")}</p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              Attempt {Math.max(1, stepRun?.attempts ?? 1)} · {outcomeLabel(stepRun?.workflowOutcome)}
            </p>
          </div>
        </div>

        {latestSummaryEvent?.detail ? (
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Model summary</p>
              <span className="text-[10px] uppercase tracking-wide text-ink-500">
                {typeof latestSummaryEvent.attempt === "number" ? `attempt ${latestSummaryEvent.attempt}` : "step"}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-200">{latestSummaryEvent.detail}</p>
          </div>
        ) : null}
      </section>

      <div className="my-3 h-px shrink-0 bg-ink-800/60" />

      <section className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={activityScroll.containerRef}
          className="min-h-0 flex-1 overflow-auto px-4 pt-1 pb-4"
        >
          {activityText.length > 0 ? (
            <div className="sticky top-0 z-10 flex justify-end pointer-events-none">
              <Tooltip side="left" content={copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy activity"}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="pointer-events-auto h-6 w-6 px-0 backdrop-blur-sm"
                  aria-label="Copy step live activity"
                  onClick={() => void handleCopy()}
                >
                  {copyState === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </Tooltip>
            </div>
          ) : null}
          {activityEvents.length > 0 ? (
            <ol className="space-y-3">
              {activityEvents.map((event) => {
                const EventIcon = activityEventIcon(event);
                const accent = activityEventAccent(event);
                return (
                  <li
                    key={event.id}
                    className={`border-l-2 ${accent.border} pl-3 py-1.5`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5">
                        <EventIcon className={`mt-px h-3.5 w-3.5 shrink-0 ${accent.icon}`} />
                        <p className="text-[12px] font-medium text-ink-200">{event.title}</p>
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-500">
                        {typeof event.attempt === "number" ? `attempt ${event.attempt}` : "step"}
                      </span>
                    </div>
                    {renderEventDetail(event)}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-xs text-ink-500">
              No model activity lines yet for this step. Keep the run active and wait for the next provider event.
            </p>
          )}
        </div>

        {activityScroll.showLatest ? (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 gap-1 rounded-full border-ink-700/60 bg-[var(--surface-overlay)] px-3 text-[11px]"
            onClick={activityScroll.scrollToBottom}
          >
            <ArrowDown className="h-3 w-3" />
            Latest
          </Button>
        ) : null}

        {streamState === "error" && streamError ? (
          <div className="absolute bottom-10 left-4 right-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-[11px] text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Live stream error: {streamError}
          </div>
        ) : null}
      </section>
    </div>
  );
}
