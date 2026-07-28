export type AppTheme = "light" | "dark";

const STORAGE_KEY = "lightscript.theme";

export function normalizeAppTheme(value: unknown): AppTheme {
  return value === "dark" ? "dark" : "light";
}

export function getStoredTheme(): AppTheme {
  try {
    return normalizeAppTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function setStoredTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}
