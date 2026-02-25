import { useEffect, useRef, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Loader2, Pause, Play, Plus, Redo2, Settings2, Square, Sparkles, Undo2, Wand2, Workflow, Cable, Clock3, Layers, ListChecks, Bug, Zap, FolderOpen } from "lucide-react";

import { cn } from "@/lib/cn";
import { MODEL_CATALOG } from "@/lib/modelCatalog";
import { canUseClaudeFastMode, getClaudeFastModeUnavailableNote } from "@/lib/providerCapabilities";
import { loadRunDraft } from "@/lib/runDraftStorage";
import { PipelineEditor } from "@/components/dashboard/PipelineEditor";
import { ToolButton } from "@/components/dashboard/ToolButton";
import { Button } from "@/components/optics/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider } from "@/components/optics/dropdown-menu";
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarDivider
} from "@/components/optics/floating-toolbar";
import { Tooltip } from "@/components/optics/tooltip";
import { ElapsedTimeBadge } from "@/components/dashboard/ElapsedTimeBadge";
import { RunRipple, useRunRipple } from "@/components/dashboard/RunRipple";
import { type useAppState } from "@/app/useAppState";
import { type useNavigationState } from "@/app/useNavigationState";
import { AppShellRoutes } from "./AppShellRoutes";
import type { AppShellActions } from "./useAppShellActions";

interface AppShellLayoutProps {
  state: ReturnType<typeof useAppState>;
  navigation: ReturnType<typeof useNavigationState>;
  actions: AppShellActions;
}

export function AppShellLayout({
  state,
  navigation,
  actions
}: AppShellLayoutProps) {
  const {
    draft,
    mcpServers,
    selectedPipelineEditLocked,
    hasOrchestrator,
    canUndo,
    canRedo,
    selectedPipelineRunActive,
    runTooltip,
    runPanelToggleDisabled,
    canPauseActiveRun,
    canResumeActiveRun,
    startingRun,
    stoppingRun,
    pausingRun,
    resumingRun
  } = state;

  const {
    activePanel,
    stepPanelOpen,
    handleStepPanelChange,
    togglePanel
  } = navigation;

  const {
    applyEditableDraftChange,
    setCanvasDragActive,
    handleAddStep,
    handleSpawnOrchestrator,
    undoDraftChange,
    redoDraftChange,
    handleStartRun,
    handlePauseRun,
    handleResumeRun,
    handleStopRun
  } = actions;

  const claudeProvider = state.providers?.claude;
  const claudeFastModeAvailable = canUseClaudeFastMode(claudeProvider);
  const claudeFastModeUnavailableNote = claudeFastModeAvailable
    ? undefined
    : getClaudeFastModeUnavailableNote(claudeProvider);

  const runDraft = loadRunDraft(state.aiWorkflowKey);
  const runModeIcon = runDraft.mode === "smart"
    ? <Wand2 className="h-3.5 w-3.5" />
    : <Zap className="h-3.5 w-3.5" />;

  const { ripple, runButtonRef, trigger: triggerRipple, triggerFromRunButton, clear: clearRipple } = useRunRipple();

  const prevMockRunRef = useRef(state.mockRunActive);
  useEffect(() => {
    if (state.mockRunActive && !prevMockRunRef.current) {
      triggerFromRunButton();
    }
    prevMockRunRef.current = state.mockRunActive;
  }, [state.mockRunActive, triggerFromRunButton]);

  const fireRun = (e: React.MouseEvent, task: string, inputs?: Record<string, string>) => {
    triggerRipple(e);
    void handleStartRun(task, inputs);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas text-ink-50">
      <aside className="glass-panel-dense absolute left-0 top-0 z-30 flex h-full w-[56px] select-none flex-col items-center gap-1 px-1.5 pt-[46px] pb-3">
        <ToolButton
          label="AI builder"
          variant="accent"
          active={activePanel === "ai"}
          onClick={() => {
            togglePanel("ai");
          }}
        >
          <Sparkles className="h-4 w-4" />
        </ToolButton>

        <div className="my-1 h-px w-6 bg-ink-700/50" />

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
          label="Cron schedules"
          active={activePanel === "schedules"}
          onClick={() => {
            togglePanel("schedules");
          }}
        >
          <Clock3 className="h-4 w-4" />
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
          label="Files"
          active={activePanel === "files"}
          onClick={() => {
            togglePanel("files");
          }}
        >
          <FolderOpen className="h-4 w-4" />
        </ToolButton>

        <div className="my-1 h-px w-6 bg-ink-700/50" />

        <ToolButton label="Undo (Cmd/Ctrl+Z)" disabled={!canUndo || selectedPipelineEditLocked} onClick={undoDraftChange}>
          <Undo2 className="h-4 w-4" />
        </ToolButton>

        <ToolButton
          label="Redo (Cmd/Ctrl+Shift+Z)"
          disabled={!canRedo || selectedPipelineEditLocked}
          onClick={redoDraftChange}
        >
          <Redo2 className="h-4 w-4" />
        </ToolButton>

        <div className="mt-auto h-px w-6 bg-ink-700/50" />

        <ToolButton
          label="Settings"
          active={state.settingsOpen}
          onClick={() => actions.setSettingsOpen(true)}
        >
          <Settings2 className="h-4 w-4" />
        </ToolButton>

        {state.debugEnabled && (
          <ToolButton
            label="Debug mode"
            active={activePanel === "debug"}
            onClick={() => {
              togglePanel("debug");
            }}
          >
            <Bug className="h-4 w-4" />
          </ToolButton>
        )}
      </aside>

      <div
        className="glass-panel-dense absolute left-0 top-0 right-0 z-20 flex h-[38px] items-center justify-center"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      >
        <span className="text-[11px] font-medium text-ink-500 select-none">{draft.name || "Untitled flow"}</span>
      </div>

      <PipelineEditor
        draft={draft}
        activeRun={state.activePipelineRun}
        readOnly={selectedPipelineEditLocked}
        modelCatalog={MODEL_CATALOG}
        mcpServers={mcpServers.map((server) => ({ id: server.id, name: server.name, enabled: server.enabled }))}
        claudeFastModeAvailable={claudeFastModeAvailable}
        claudeFastModeUnavailableNote={claudeFastModeUnavailableNote}
        startingRun={startingRun}
        debugPreviewDispatchRouteId={state.debugPreviewDispatchRouteId}
        onChange={applyEditableDraftChange}
        onCanvasDragStateChange={setCanvasDragActive}
        onStepPanelChange={handleStepPanelChange}
        stepPanelBlocked={activePanel === "run"}
        onAddStep={handleAddStep}
        onSpawnOrchestrator={handleSpawnOrchestrator}
        hasOrchestrator={hasOrchestrator}
        className="absolute left-[56px] top-[38px] right-0 bottom-0"
      />

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
        <AnimatePresence mode="wait" initial={false}>
          {selectedPipelineRunActive ? (
            <motion.div
              key="running-toolbar"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <FloatingToolbar className="static translate-x-0 bottom-auto left-auto">
                <FloatingToolbarButton active onClick={() => togglePanel("run")}>
                  {state.activePipelineRun?.status === "paused" ? (
                    <Pause className="h-3 w-3 text-amber-400" />
                  ) : (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  {state.activePipelineRun?.status === "paused" ? "Paused" : "Running"}
                  <ElapsedTimeBadge startedAt={state.activePipelineRun?.startedAt} paused={state.activePipelineRun?.status === "paused"} />
                </FloatingToolbarButton>

                <FloatingToolbarDivider />

                {canPauseActiveRun ? (
                  <FloatingToolbarButton
                    disabled={stoppingRun || pausingRun || resumingRun}
                    onClick={() => {
                      void handlePauseRun(state.activePipelineRun?.id);
                    }}
                  >
                    {pausingRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                    {pausingRun ? "Pausing" : "Pause"}
                  </FloatingToolbarButton>
                ) : canResumeActiveRun ? (
                  <FloatingToolbarButton
                    disabled={stoppingRun || pausingRun || resumingRun}
                    onClick={() => {
                      void handleResumeRun(state.activePipelineRun?.id);
                    }}
                  >
                    {resumingRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    {resumingRun ? "Resuming" : "Resume"}
                  </FloatingToolbarButton>
                ) : null}

                <FloatingToolbarDivider />

                <FloatingToolbarButton
                  danger
                  disabled={!state.activePipelineRun || stoppingRun || pausingRun || resumingRun}
                  onClick={() => {
                    void handleStopRun(state.activePipelineRun?.id);
                  }}
                >
                  {stoppingRun ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  {stoppingRun ? "Stopping" : "Stop"}
                </FloatingToolbarButton>
              </FloatingToolbar>
            </motion.div>
          ) : (
            <motion.div
              ref={runButtonRef}
              key="run-button"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center"
            >
              <Tooltip content={runTooltip} side="bottom">
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-r-none border-r-0"
                  disabled={runPanelToggleDisabled}
                  onClick={(e) => {
                    fireRun(e, runDraft.task, runDraft.mode === "smart" ? runDraft.inputs : undefined);
                  }}
                >
                  {startingRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : runModeIcon}
                  {startingRun ? "Starting" : runDraft.mode === "smart" ? "Smart Run" : "Quick Run"}
                </Button>
              </Tooltip>

              <DropdownMenu
                align="right"
                trigger={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-l-none border-l-ink-700/40 px-1.5"
                    disabled={runPanelToggleDisabled}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                }
              >
                <DropdownMenuItem
                  icon={<Wand2 className="h-3.5 w-3.5" />}
                  label="Start Smart Run"
                  description="AI-validated with preflight checks"
                  disabled={runPanelToggleDisabled}
                  onClick={(e) => {
                    fireRun(e, runDraft.task, runDraft.inputs);
                  }}
                />
                <DropdownMenuItem
                  icon={<Zap className="h-3.5 w-3.5" />}
                  label="Start Quick Run"
                  description="Minimal checks, no custom inputs"
                  disabled={runPanelToggleDisabled}
                  onClick={(e) => {
                    fireRun(e, runDraft.task);
                  }}
                />
                <DropdownMenuDivider />
                <DropdownMenuItem
                  icon={<Settings2 className="h-3.5 w-3.5" />}
                  label="Configure Run..."
                  description="Open panel to edit task, inputs & mode"
                  onClick={() => {
                    if (activePanel !== "run") {
                      togglePanel("run");
                    }
                  }}
                />
              </DropdownMenu>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AppShellRoutes state={state} navigation={navigation} actions={actions} />

      <RunRipple ripple={ripple} onComplete={clearRipple} />
    </div>
  );
}
