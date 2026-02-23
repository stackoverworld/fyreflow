import { ArrowDown, Check, Copy, Sparkles, TerminalSquare } from "lucide-react";

import { Button } from "@/components/optics/button";
import { Tooltip } from "@/components/optics/tooltip";
import { CollapsibleSection } from "@/components/dashboard/pipeline-editor/sections/CollapsibleSection";
import { usePersistedJsonState } from "@/components/dashboard/usePersistedJsonState";
import { useAutoScroll } from "../useAutoScroll";

interface ConsoleTabProps {
  recentLogs: string[];
  logsText: string;
  aiDebugLines: string[];
  aiLogsText: string;
  logsCopyState: "idle" | "copied" | "error";
  aiLogsCopyState: "idle" | "copied" | "error";
  onCopyLogs: () => Promise<void>;
  onCopyAiLogs: () => Promise<void>;
}

interface ConsoleCollapsedState {
  runtime: boolean;
  ai: boolean;
}

const DEFAULT_COLLAPSED_STATE: ConsoleCollapsedState = {
  runtime: false,
  ai: false
};

function isConsoleCollapsedState(value: unknown): value is ConsoleCollapsedState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<ConsoleCollapsedState>;
  return typeof state.runtime === "boolean" && typeof state.ai === "boolean";
}

export function ConsoleTab({
  recentLogs,
  logsText,
  aiDebugLines,
  aiLogsText,
  logsCopyState,
  aiLogsCopyState,
  onCopyLogs,
  onCopyAiLogs
}: ConsoleTabProps) {
  const [collapsed, setCollapsed] = usePersistedJsonState<ConsoleCollapsedState>(
    "fyreflow:debug-console-collapsed",
    DEFAULT_COLLAPSED_STATE,
    isConsoleCollapsedState
  );

  const runtimeScroll = useAutoScroll(logsText);
  const aiScroll = useAutoScroll(aiLogsText);

  return (
    <div>
      <CollapsibleSection
        icon={<TerminalSquare className="h-3.5 w-3.5" />}
        label="Pipeline runtime"
        collapsed={collapsed.runtime}
        onToggle={() => setCollapsed((prev) => ({ ...prev, runtime: !prev.runtime }))}
      >
        <div className="relative">
          <pre
            ref={runtimeScroll.containerRef}
            className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800/50 bg-ink-950/70 p-3 pr-12 font-mono text-[11px] text-ink-400"
          >
            {recentLogs.length > 0 ? recentLogs.join("\n") : "No runtime logs yet."}
          </pre>

          {runtimeScroll.showLatest && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 gap-1 rounded-full border-ink-700/80 bg-ink-900/95 px-3 text-[11px]"
              onClick={runtimeScroll.scrollToBottom}
            >
              <ArrowDown className="h-3 w-3" />
              Latest
            </Button>
          )}

          <Tooltip
            side="left"
            content={
              logsCopyState === "copied"
                ? "Copied"
                : logsCopyState === "error"
                  ? "Copy failed"
                  : "Copy logs"
            }
          >
            <span className="absolute top-2 right-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 w-7 rounded-md border-ink-700/80 bg-ink-900/85 px-0"
                aria-label="Copy live logs"
                disabled={logsText.length === 0}
                onClick={() => void onCopyLogs()}
              >
                {logsCopyState === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </span>
          </Tooltip>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Sparkles className="h-3.5 w-3.5" />}
        label="AI Builder diagnostics"
        collapsed={collapsed.ai}
        onToggle={() => setCollapsed((prev) => ({ ...prev, ai: !prev.ai }))}
      >
        <div className="relative">
          <pre
            ref={aiScroll.containerRef}
            className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800/50 bg-ink-950/70 p-3 pr-12 font-mono text-[11px] text-ink-400"
          >
            {aiDebugLines.length > 0 ? aiDebugLines.join("\n") : "No AI Builder diagnostics yet."}
          </pre>

          {aiScroll.showLatest && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 gap-1 rounded-full border-ink-700/80 bg-ink-900/95 px-3 text-[11px]"
              onClick={aiScroll.scrollToBottom}
            >
              <ArrowDown className="h-3 w-3" />
              Latest
            </Button>
          )}

          <Tooltip
            side="left"
            content={
              aiLogsCopyState === "copied"
                ? "Copied"
                : aiLogsCopyState === "error"
                  ? "Copy failed"
                  : "Copy logs"
            }
          >
            <span className="absolute top-2 right-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 w-7 rounded-md border-ink-700/80 bg-ink-900/85 px-0"
                aria-label="Copy AI builder diagnostics"
                disabled={aiLogsText.length === 0}
                onClick={() => void onCopyAiLogs()}
              >
                {aiLogsCopyState === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </span>
          </Tooltip>
        </div>
      </CollapsibleSection>
    </div>
  );
}
