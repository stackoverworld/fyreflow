import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, saveAppSettings, type ThemePreference } from "@/lib/appSettingsStorage";

type ResolvedTheme = "light" | "dark";

interface UseThemeReturn {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return getSystemTheme();
  }
  return preference;
}

function applyThemeToDOM(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved);
}

export function useTheme(): UseThemeReturn {
  const [preference, setPreference] = useState<ThemePreference>(() => loadAppSettings().theme);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
    const nextResolved = resolveTheme(next);
    setResolved(nextResolved);
    applyThemeToDOM(nextResolved);

    const current = loadAppSettings();
    saveAppSettings({ ...current, theme: next });
  }, []);

  // Apply theme on mount
  useEffect(() => {
    applyThemeToDOM(resolved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (preference !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const nextResolved = resolveTheme("system");
      setResolved(nextResolved);
      applyThemeToDOM(nextResolved);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [preference]);

  return { preference, resolved, setTheme };
}
