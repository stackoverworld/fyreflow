import { useState } from "react";

/**
 * Like `useState<boolean>` but persists the value to localStorage.
 * Useful for collapsible sections that should remember their open/closed state across mounts.
 */
export function usePersistedCollapsed(
  storageKey: string,
  defaultValue: boolean
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch {}
    return defaultValue;
  });

  const setPersisted = (next: boolean | ((prev: boolean) => boolean)) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try {
        localStorage.setItem(storageKey, String(resolved));
      } catch {}
      return resolved;
    });
  };

  return [value, setPersisted];
}
