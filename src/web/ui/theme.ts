import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Theme handling for the three states the tokens support:
 *
 *   "system" — no `data-theme` attribute; `prefers-color-scheme` decides.
 *   "light"  — `data-theme="light"`, pinned regardless of the system.
 *   "dark"   — `data-theme="dark"`, pinned regardless of the system.
 *
 * The choice is stored per browser in `localStorage`. Nothing else in the
 * application needs to know the theme: every colour flows through a token that
 * swaps itself.
 */
export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "stam.theme";
const listeners = new Set<() => void>();

let preference: ThemePreference = "system";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return "system";
  }
}

function applyPreference(next: ThemePreference): void {
  const root = document.documentElement;
  if (next === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", next);
  }
}

/**
 * Applies the stored preference to <html>. Call once, as early as possible —
 * `main.tsx` does this before rendering so the first paint is already correct.
 */
export function initializeTheme(): void {
  preference = readStoredPreference();
  applyPreference(preference);
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  applyPreference(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A theme that cannot be remembered is still a theme that works now.
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemePreference {
  return preference;
}

function getServerSnapshot(): ThemePreference {
  return "system";
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
  toggle: () => void;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolved = useResolvedTheme(current);

  const toggle = useCallback(() => {
    setThemePreference(resolved === "dark" ? "light" : "dark");
  }, [resolved]);

  return { preference: current, resolved, setPreference: setThemePreference, toggle };
}

function useResolvedTheme(current: ThemePreference): "light" | "dark" {
  const systemDark = useSystemPrefersDark();
  if (current === "system") {
    return systemDark ? "dark" : "light";
  }
  return current;
}

function useSystemPrefersDark(): boolean {
  const subscribeToQuery = useCallback((listener: () => void) => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return useSyncExternalStore(
    subscribeToQuery,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
}

/**
 * Keeps a component tree in sync when the preference is changed elsewhere,
 * for example in another tab. Mounted once by `AppShell`.
 */
export function useThemeStorageSync(): void {
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) {
        return;
      }
      const next = isThemePreference(event.newValue) ? event.newValue : "system";
      preference = next;
      applyPreference(next);
      for (const listener of listeners) {
        listener();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
