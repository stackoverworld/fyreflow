import type { WorkspacePanel } from "@/app/useNavigationState";

export interface PanelGuardContext {
  debugEnabled: boolean;
}

export type PanelRouteGuard = (_context: PanelGuardContext) => boolean;

export const panelRouteGuards: Record<Exclude<WorkspacePanel, null>, PanelRouteGuard> = {
  pipelines: () => true,
  flow: () => true,
  schedules: () => true,
  contracts: () => true,
  mcp: () => true,
  run: () => true,
  ai: () => true,
  debug: () => true
};

export function canActivatePanel(panel: Exclude<WorkspacePanel, null>, context: PanelGuardContext): boolean {
  return panelRouteGuards[panel](context);
}
