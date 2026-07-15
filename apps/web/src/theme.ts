/**
 * Dashboard theme: dark (default, the brand look) or light. The choice is
 * stamped on <html data-theme> so plain CSS variables do all the work, and
 * persisted in localStorage. No system-preference magic: an explicit toggle
 * beats guessing for a product surface.
 */

export type Theme = "dark" | "light";

const KEY = "keyline.theme";

export function loadTheme(storage: Storage = localStorage): Theme {
  try {
    return storage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme, storage: Storage = localStorage): void {
  document.documentElement.dataset.theme = theme;
  try {
    storage.setItem(KEY, theme);
  } catch {
    // Private mode without storage: the toggle still works for this tab.
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
