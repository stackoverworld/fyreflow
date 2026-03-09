import type { ReactNode } from "react";
import { Workflow, ShieldCheck } from "lucide-react";

import { AiBuilderPanel } from "@/components/dashboard/AiBuilderPanel";
import { CronSchedulesPanel } from "@/components/dashboard/CronSchedulesPanel";
import { DebugPanel } from "@/components/dashboard/DebugPanel";
import { Input } from "@/components/optics/input";
import { McpSettings } from "@/components/dashboard/McpSettings";
import { FilesPanel } from "@/components/dashboard/FilesPanel";
import { PipelineList } from "@/components/dashboard/PipelineList";
import { QualityGatesPanel } from "@/components/dashboard/QualityGatesPanel";
import { cn } from "@/lib/cn";
import {
  canUseClaudeFastMode,
  canUseOpenAiFastMode,
  getClaudeFastModeUnavailableNote,
  getOpenAiFastModeUnavailableNote
} from "@/lib/providerCapabilities";
import type { PipelinePayload } from "@/lib/types";
import { Textarea } from "@/components/optics/textarea";
import { type useAppState } from "@/app/useAppState";
import type { AppShellActions } from "../useAppShellActions";
import type { PanelRouteKey } from "./config";
import { panelRoutes } from "./config";

type StaticPanelRouteKey = Exclude<PanelRouteKey, "run">;

export interface AppShellRouteContext {
  state: ReturnType<typeof useAppState>;
  actions: AppShellActions;
}

export interface StaticPanelRouteDefinition {
  key: StaticPanelRouteKey;
  path: `/${string}`;
  render: (context: AppShellRouteContext) => ReactNode;
}

const staticPanelPath = (key: StaticPanelRouteKey): `/${string}` => {
  const route = panelRoutes.find((panelRoute) => panelRoute.key === key);
  return route?.path ?? `/${key}`;
};

function buildAppliedFlowSignature(draft: PipelinePayload): string {
  return JSON.stringify({
    name: draft.name,
    description: draft.description,
    steps: draft.steps.map((step) => ({
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
      position: step.position,
      contextTemplate: step.contextTemplate,
      enableDelegation: step.enableDelegation,
      delegationCount: step.delegationCount,
      enableIsolatedStorage: step.enableIsolatedStorage,
      enableSharedStorage: step.enableSharedStorage,
      enabledMcpServerIds: step.enabledMcpServerIds,
      sandboxMode: step.sandboxMode ?? "auto",
      outputFormat: step.outputFormat,
      requiredOutputFields: step.requiredOutputFields,
      requiredOutputFiles: step.requiredOutputFiles,
      scenarios: step.scenarios,
      skipIfArtifacts: step.skipIfArtifacts,
      policyProfileIds: step.policyProfileIds,
      cacheBypassInputKeys: step.cacheBypassInputKeys,
      cacheBypassOrchestratorPromptPatterns: step.cacheBypassOrchestratorPromptPatterns
    })),
    links: draft.links.map((link) => ({
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition ?? "always",
      conditionExpression: link.conditionExpression ?? ""
    })),
    qualityGates: draft.qualityGates.map((gate) => ({
      name: gate.name,
      targetStepId: gate.targetStepId,
      kind: gate.kind,
      blocking: gate.blocking,
      pattern: gate.pattern ?? "",
      flags: gate.flags ?? "",
      jsonPath: gate.jsonPath ?? "",
      artifactPath: gate.artifactPath ?? "",
      message: gate.message ?? ""
    })),
    runtime: draft.runtime ?? null,
    schedule: draft.schedule ?? null
  });
}

function resolveAppliedDraft(
  generatedDraft: PipelinePayload,
  savedDraft: PipelinePayload | undefined
): PipelinePayload {
  if (!savedDraft) {
    return generatedDraft;
  }

  return buildAppliedFlowSignature(savedDraft) === buildAppliedFlowSignature(generatedDraft)
    ? savedDraft
    : generatedDraft;
}

export const staticPanelRoutes: readonly StaticPanelRouteDefinition[] = [
  {
    key: "ai",
    path: staticPanelPath("ai"),
    render: ({ state, actions }) => {
      const {
        draft,
        mcpServers,
        providers,
        providerOauthStatuses,
        selectedPipelineEditLocked,
        aiWorkflowKey,
        handleSavePipeline
      } = state;
      const { applyEditableDraftChange, setNotice } = actions;
      if (!providers) {
        return null;
      }
      const openAiProvider = providers?.openai;
      const claudeProvider = providers?.claude;
      const openAiFastModeAvailable = canUseOpenAiFastMode(openAiProvider);
      const openAiFastModeUnavailableNote = openAiFastModeAvailable
        ? undefined
        : getOpenAiFastModeUnavailableNote(openAiProvider);
      const claudeFastModeAvailable = canUseClaudeFastMode(claudeProvider);
      const claudeFastModeUnavailableNote = claudeFastModeAvailable
        ? undefined
        : getClaudeFastModeUnavailableNote(claudeProvider);

      return (
        <AiBuilderPanel
          workflowKey={aiWorkflowKey}
          currentDraft={draft}
          mcpServers={mcpServers}
          providers={providers}
          oauthStatuses={providerOauthStatuses}
          openAiFastModeAvailable={openAiFastModeAvailable}
          openAiFastModeUnavailableNote={openAiFastModeUnavailableNote}
          claudeFastModeAvailable={claudeFastModeAvailable}
          claudeFastModeUnavailableNote={claudeFastModeUnavailableNote}
          readOnly={selectedPipelineEditLocked}
          onApplyDraft={async (generatedDraft) => {
            const saveResult = await handleSavePipeline({ draftSnapshot: generatedDraft });
            if (!saveResult.saved || !saveResult.pipelineId) {
              throw new Error(saveResult.errorMessage ?? "Failed to save AI-generated flow.");
            }
            applyEditableDraftChange(resolveAppliedDraft(generatedDraft, saveResult.savedDraft));
            return {
              workflowKey: saveResult.pipelineId
            };
          }}
          onNotice={setNotice}
        />
      );
    }
  },
  {
    key: "pipelines",
    path: staticPanelPath("pipelines"),
    render: ({ state, actions }) => {
      const { pipelines, selectedPipelineId, activeRunPipelineIds } = state;
      const { selectPipeline, handleCreatePipelineDraft, handleDeletePipeline } = actions;

      return (
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
      );
    }
  },
  {
    key: "flow",
    path: staticPanelPath("flow"),
    render: ({ state, actions }) => {
      const {
        draft,
        runtimeDraft,
        isDirty,
        isNewDraft,
        pipelineSaveValidationError,
        autosaveStatusLabel,
        selectedPipelineEditLocked
      } = state;
      const { applyDraftChange } = actions;

      return (
        <div>
          {selectedPipelineEditLocked ? (
            <p className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
              This flow is running. Flow settings are locked until it finishes or is stopped.
            </p>
          ) : null}

          <fieldset disabled={selectedPipelineEditLocked} className={cn(selectedPipelineEditLocked && "opacity-70")}>
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

            <div className="my-5 h-px bg-[var(--divider)]" />

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
                  max={18000000}
                  step={1000}
                  value={runtimeDraft.stageTimeoutMs}
                  onChange={(event) =>
                    applyDraftChange({
                      ...draft,
                      runtime: {
                        ...runtimeDraft,
                        stageTimeoutMs: Math.max(
                          10000,
                          Math.min(18000000, Number.parseInt(event.target.value, 10) || 10000)
                        )
                      }
                    })
                  }
                />
              </label>
            </section>
          </fieldset>

          <div className="my-5 h-px bg-[var(--divider)]" />

          <p className="text-xs text-ink-500">
            {isNewDraft ? "New flow draft" : "Editing existing flow"}
            {" · "}
            <span className={pipelineSaveValidationError || isDirty ? "text-amber-400" : "text-emerald-400"}>
              {autosaveStatusLabel}
            </span>
          </p>
        </div>
      );
    }
  },
  {
    key: "schedules",
    path: staticPanelPath("schedules"),
    render: ({ state, actions }) => {
      const { draft, selectedPipelineId, scheduleRunPlan, loadingScheduleRunPlan } = state;
      const { applyEditableDraftChange, handleLoadScheduleRunPlan } = actions;

      return (
        <CronSchedulesPanel
          draft={draft}
          pipelineId={selectedPipelineId ?? undefined}
          smartRunPlan={scheduleRunPlan}
          loadingSmartRunPlan={loadingScheduleRunPlan}
          readOnly={state.selectedPipelineEditLocked}
          onRefreshSmartRunPlan={async (runMode, inputs, options) => {
            await handleLoadScheduleRunPlan(runMode, inputs, options);
          }}
          onChange={applyEditableDraftChange}
        />
      );
    }
  },
  {
    key: "contracts",
    path: staticPanelPath("contracts"),
    render: ({ state, actions }) => {
      const { draft } = state;
      const { applyEditableDraftChange } = actions;

      return <QualityGatesPanel draft={draft} readOnly={state.selectedPipelineEditLocked} onChange={applyEditableDraftChange} />;
    }
  },
  {
    key: "mcp",
    path: staticPanelPath("mcp"),
    render: ({ state, actions }) => {
      const { mcpServers, storageConfig } = state;
      const { handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer, handleSaveStorageConfig } = actions;

      return (
        <McpSettings
          mcpServers={mcpServers}
          storage={storageConfig!}
          onCreateServer={handleCreateMcpServer}
          onUpdateServer={handleUpdateMcpServer}
          onDeleteServer={handleDeleteMcpServer}
          onSaveStorage={handleSaveStorageConfig}
        />
      );
    }
  },
  {
    key: "files",
    path: staticPanelPath("files"),
    render: ({ state, actions }) => {
      const { selectedPipeline, runs, storageConfig } = state;
      const { setNotice } = actions;

      return (
        <FilesPanel
          selectedPipeline={selectedPipeline}
          runs={runs}
          storageConfig={storageConfig}
          onNotice={setNotice}
        />
      );
    }
  },
  {
    key: "debug",
    path: staticPanelPath("debug"),
    render: ({ state, actions }) => {
      const {
        draft,
        selectedPipeline,
        runs,
        smartRunPlan,
        loadingSmartRunPlan,
        startingRun,
        mockRunActive,
        selectedPipelineRealRunActive,
        aiWorkflowKey,
        debugPreviewDispatchRouteId
      } = state;
      const { setRunCompletionModal, setMockRunActive, setDebugPreviewDispatchRouteId } = actions;

      return (
        <DebugPanel
          draft={draft}
          selectedPipeline={selectedPipeline}
          aiWorkflowKey={aiWorkflowKey}
          runs={runs}
          smartRunPlan={smartRunPlan}
          loadingSmartRunPlan={loadingSmartRunPlan}
          startingRun={startingRun}
          mockRunActive={mockRunActive}
          realRunActive={selectedPipelineRealRunActive}
          onMockRunChange={setMockRunActive}
          dispatchPreviewRouteId={debugPreviewDispatchRouteId}
          onDispatchPreviewRouteIdChange={setDebugPreviewDispatchRouteId}
          onPreviewRunCompletionModal={() => {
            // TEMP: remove this mock trigger after completion modal UI review.
            const previewRun =
              (selectedPipeline ? runs.find((run) => run.pipelineId === selectedPipeline.id) : null) ??
              runs[0] ??
              null;
            const previewOutputStep = previewRun
              ? [...previewRun.steps].reverse().find((step) => step.output.trim().length > 0)
              : null;
            const previewOutput = previewOutputStep?.output
              ? previewOutputStep.output.replace(/\s+/g, " ").trim().slice(0, 320)
              : undefined;

            setRunCompletionModal({
              runId: previewRun?.id ?? "test-run-preview",
              pipelineId: previewRun?.pipelineId ?? "test-pipeline-preview",
              pipelineName: previewRun?.pipelineName ?? "Test Run Completion Preview",
              status: "completed",
              task:
                previewRun?.task && previewRun.task.trim().length > 0
                  ? previewRun.task
                  : "Verify completion summary, output details, and result location guidance.",
              completedSteps: previewRun ? previewRun.steps.filter((step) => step.status === "completed").length : 3,
              totalSteps: previewRun?.steps.length ?? 3,
              finishedAt: previewRun?.finishedAt ?? new Date().toISOString(),
              finalStepName: previewOutputStep?.stepName ?? "Result Reporter",
              finalOutputPreview:
                previewOutput && previewOutput.length > 0
                  ? previewOutput
                  : "Generated final report with action items, QA status, and artifact links for follow-up."
            });
          }}
        />
      );
    }
  }
] as const;

export function getStaticPanelRoute(panel: StaticPanelRouteKey): StaticPanelRouteDefinition | undefined {
  return staticPanelRoutes.find((route) => route.key === panel);
}
