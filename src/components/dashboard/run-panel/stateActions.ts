import type { Dispatch, MutableRefObject, SetStateAction } from "react";

interface UseRunPanelStateActionsArgs {
  onRefreshSmartRunPlan: (inputs?: Record<string, string>, options?: { force?: boolean }) => Promise<void>;
  onForgetSecretInput?: (key: string) => Promise<void>;
  setSmartInputs: Dispatch<SetStateAction<Record<string, string>>>;
  setForgettingSecretKeys: Dispatch<SetStateAction<Record<string, boolean>>>;
  smartInputsRef: MutableRefObject<Record<string, string>>;
}

export interface RunPanelStateActions {
  refreshSmartRunPlan: (options?: { force?: boolean }) => Promise<void>;
  forgetSecretInput: (fieldKey: string) => Promise<void>;
}

export function createRunPanelStateActions({
  onRefreshSmartRunPlan,
  onForgetSecretInput,
  setSmartInputs,
  setForgettingSecretKeys,
  smartInputsRef
}: UseRunPanelStateActionsArgs): RunPanelStateActions {
  const refreshSmartRunPlan = async (options: { force?: boolean } = {}) => {
    await onRefreshSmartRunPlan(smartInputsRef.current, options);
  };

  const forgetSecretInput = async (fieldKey: string) => {
    if (!onForgetSecretInput) {
      return;
    }

    setForgettingSecretKeys((current) => ({
      ...current,
      [fieldKey]: true
    }));
    try {
      await onForgetSecretInput(fieldKey);
      const nextInputs = {
        ...smartInputsRef.current,
        [fieldKey]: ""
      };
      smartInputsRef.current = nextInputs;
      setSmartInputs(nextInputs);
      await onRefreshSmartRunPlan(nextInputs, { force: true });
    } finally {
      setForgettingSecretKeys((current) => ({
        ...current,
        [fieldKey]: false
      }));
    }
  };

  return {
    forgetSecretInput,
    refreshSmartRunPlan
  };
}
