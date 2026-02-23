import { useState } from "react";

/**
 * Persists the active tab to localStorage so it survives panel close/reopen.
 *
 * @param storageKey  - localStorage key, e.g. "fyreflow:run-tab"
 * @param defaultTab  - fallback when nothing is stored or value is invalid
 * @param validTabs   - whitelist of accepted values (used for safe parsing)
 */
export function usePersistedTab<T extends string>(
  storageKey: string,
  defaultTab: T,
  validTabs: readonly T[]
): [T, (tab: T) => void] {
  const [activeTab, setActiveTab] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null && (validTabs as readonly string[]).includes(stored)) {
        return stored as T;
      }
    } catch {
      // ignore storage errors
    }
    return defaultTab;
  });

  const handleTabChange = (tab: T) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(storageKey, tab);
    } catch {
      // ignore storage errors
    }
  };

  return [activeTab, handleTabChange];
}
