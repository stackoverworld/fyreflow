import type { WorkspacePanel } from "@/app/useNavigationState";

export type PanelRouteKey = Exclude<WorkspacePanel, null>;

export interface PanelRouteConfig {
  key: PanelRouteKey;
  path: `/${string}`;
  title: string;
}

export const panelRoutes: readonly PanelRouteConfig[] = [
  { key: "pipelines", path: "/flows", title: "Flows" },
  { key: "flow", path: "/flow", title: "Flow Settings" },
  { key: "schedules", path: "/schedules", title: "Cron Schedules" },
  { key: "contracts", path: "/contracts", title: "Contracts & Gates" },
  { key: "mcp", path: "/mcp", title: "MCP & Storage" },
  { key: "files", path: "/files", title: "Files" },
  { key: "ai", path: "/ai", title: "AI Builder" },
  { key: "debug", path: "/debug", title: "Debug" },
  { key: "run", path: "/run", title: "Run" }
] as const;

export function getPanelTitle(panel: WorkspacePanel): string {
  const route = panelRoutes.find((routeConfig) => routeConfig.key === panel);
  return route?.title ?? "Panel";
}
