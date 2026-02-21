import { AppShell } from "@/app/AppShell";
import { useAppState } from "@/app/useAppState";
import { useKeyboardShortcuts } from "@/app/useKeyboardShortcuts";
import { useNavigationState } from "@/app/useNavigationState";

export default function App() {
  const navigation = useNavigationState();
  const state = useAppState({
    activePanel: navigation.activePanel,
    setActivePanel: navigation.setActivePanel
  });

  useKeyboardShortcuts({
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undoDraftChange: state.undoDraftChange,
    redoDraftChange: state.redoDraftChange,
    disabled: state.selectedPipelineEditLocked
  });

  return <AppShell state={state} navigation={navigation} />;
}
