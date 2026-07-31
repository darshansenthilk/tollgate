export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "tollgate-theme";

/** Dashboard default — matches the look the app has always had, so nobody's
 *  screen changes color until they opt into light. The marketing pages
 *  aren't affected either way (see app/(marketing)/layout.tsx). */
export const DEFAULT_THEME: Theme = "dark";

/** Applies `theme` to <html> and persists it. Shared by the inline
 *  no-flash script in app/layout.tsx (as a string, see THEME_INIT_SCRIPT)
 *  and theme-toggle.tsx (as this real function) — the two must stay in
 *  sync, which is why the script below is generated from the same
 *  constants rather than duplicating the class name and storage key. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
}

/**
 * Runs synchronously in <head>, before hydration, so the correct class is
 * already on <html> at first paint — without this, the page would flash
 * dark-then-light (or vice versa) every load for anyone who chose light.
 * Wrapped in try/catch: localStorage can throw in some privacy-mode
 * configurations, and a themeing preference is never worth a crashed page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t!=="light"&&t!=="dark"){t=${JSON.stringify(DEFAULT_THEME)};}document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}})();`;
