import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export type WorkspacePanel = "pipelines" | "flow" | "schedules" | "contracts" | "mcp" | "run" | "ai" | "debug" | null;

export interface NavigationState {
  activePanel: WorkspacePanel;
  stepPanelOpen: boolean;
  setActivePanel: Dispatch<SetStateAction<WorkspacePanel>>;
  setStepPanelOpen: Dispatch<SetStateAction<boolean>>;
  handleStepPanelChange: (open: boolean) => void;
  togglePanel: (panel: Exclude<WorkspacePanel, null>) => void;
}

export function useNavigationState(): NavigationState {
  const [activePanel, setActivePanel] = useState<WorkspacePanel>(null);
  const [stepPanelOpen, setStepPanelOpen] = useState(false);

  const togglePanel = useCallback((panel: Exclude<WorkspacePanel, null>) => {
    setActivePanel((current) => (current === panel ? null : panel));
  }, []);

  const handleStepPanelChange = useCallback((open: boolean) => {
    setStepPanelOpen(open);
    if (open) {
      setActivePanel((current) => (current === "run" ? null : current));
    }
  }, []);

  return {
    activePanel,
    stepPanelOpen,
    setActivePanel,
    setStepPanelOpen,
    handleStepPanelChange,
    togglePanel
  };
}
