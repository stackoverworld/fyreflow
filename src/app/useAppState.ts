import { useAppStateController } from "./state/useAppStateController";
import type { UseAppStateOptions } from "./state/appStateTypes";

export function useAppState({ activePanel, setActivePanel }: UseAppStateOptions) {
  return useAppStateController({ activePanel, setActivePanel });
}
