import type { ReactNode } from "react";

import { RunPanel } from "@/components/dashboard/RunPanel";
import type { PanelRouteKey } from "./config";
import { panelRoutes } from "./config";

import type { AppShellRouteContext } from "./staticRoutes";

export type LazyPanelRouteKey = Extract<PanelRouteKey, "run">;

export interface LazyPanelRouteDefinition {
  key: LazyPanelRouteKey;
  path: `/${string}`;
  render: (context: AppShellRouteContext) => ReactNode;
}

const lazyPanelPath = (key: LazyPanelRouteKey): `/${string}` => {
  const route = panelRoutes.find((panelRoute) => panelRoute.key === key);
  return route?.path ?? `/${key}`;
};

export const lazyPanelRoutes: readonly LazyPanelRouteDefinition[] = [
  {
    key: "run",
    path: lazyPanelPath("run"),
    render: ({ state, actions }) => {
      const {
        aiWorkflowKey,
        aiChatPending,
        selectedPipeline,
        runs,
        storageConfig,
        smartRunPlan,
        loadingSmartRunPlan,
        scheduleDraft,
        activePipelineRun,
        startingRun,
        stoppingRun,
        pausingRun,
        resumingRun,
        resolvingApprovalId
      } = state;
      const {
        handleRunPanelDraftStateChange,
        handleLoadSmartRunPlan,
        handleStartRun,
        handleStopRun,
        handlePauseRun,
        handleResumeRun,
        handleResolveRunApproval,
        handleForgetSecureInput
      } = actions;

      return (
        <RunPanel
          draftStorageKey={aiWorkflowKey}
          aiChatPending={aiChatPending}
          selectedPipeline={selectedPipeline}
          runs={runs}
          smartRunPlan={smartRunPlan}
          loadingSmartRunPlan={loadingSmartRunPlan}
          storageConfig={storageConfig}
          syncedMode={scheduleDraft.runMode}
          syncedInputs={scheduleDraft.inputs}
          onDraftStateChange={handleRunPanelDraftStateChange}
          onRefreshSmartRunPlan={async (inputs, options) => {
            await handleLoadSmartRunPlan(inputs, options);
          }}
          onRun={async (task, inputs) => {
            await handleStartRun(task, inputs);
          }}
          onStop={async (runId) => {
            await handleStopRun(runId);
          }}
          onPause={async (runId) => {
            await handlePauseRun(runId);
          }}
          onResume={async (runId) => {
            await handleResumeRun(runId);
          }}
          onResolveApproval={async (runId, approvalId, decision, note) => {
            await handleResolveRunApproval(runId, approvalId, decision, note);
          }}
          onForgetSecretInput={async (key) => {
            await handleForgetSecureInput(key);
          }}
          activeRun={activePipelineRun}
          startingRun={startingRun}
          stoppingRun={stoppingRun}
          pausingRun={pausingRun}
          resumingRun={resumingRun}
          resolvingApprovalId={resolvingApprovalId}
        />
      );
    }
  }
] as const;

export function getLazyPanelRoute(panel: LazyPanelRouteKey): LazyPanelRouteDefinition | undefined {
  return lazyPanelRoutes.find((route) => route.key === panel);
}
