import { useState } from "react";

type PersistedJsonValidator<T> = (value: unknown) => value is T;

function isStorageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function readPersistedJsonState<T>(
  storageKey: string,
  defaultValue: T,
  validate?: PersistedJsonValidator<T>
): T {
  if (!isStorageAvailable()) {
    return defaultValue;
  }

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) {
      return defaultValue;
    }

    const parsed: unknown = JSON.parse(stored);
    if (validate && !validate(parsed)) {
      return defaultValue;
    }

    return parsed as T;
  } catch {
    return defaultValue;
  }
}

export function writePersistedJsonState<T>(storageKey: string, value: T): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export function usePersistedJsonState<T>(
  storageKey: string,
  defaultValue: T,
  validate?: PersistedJsonValidator<T>
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readPersistedJsonState(storageKey, defaultValue, validate));

  const setPersisted = (next: T | ((prev: T) => T)) => {
    setValue((previous) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(previous) : next;
      writePersistedJsonState(storageKey, resolved);
      return resolved;
    });
  };

  return [value, setPersisted];
}
