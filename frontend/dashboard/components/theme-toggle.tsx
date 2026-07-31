"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { applyTheme, readStoredTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

/**
 * Settings' Appearance control. Reads the theme the no-flash inline script
 * (app/layout.tsx) already applied to <html> on mount, rather than assuming
 * DEFAULT_THEME — this component renders after that script has already run,
 * so document.documentElement is the source of truth for "what's actually
 * showing right now," not localStorage or a guess.
 */
export function ThemeToggle() {
  // Starts at DEFAULT_THEME's inverse-safe null so SSR and the first client
  // render agree (no theme has been read yet); the real value lands in the
  // effect below, one tick after mount — a one-frame flash of the wrong
  // button highlighted is a fair trade for zero hydration-mismatch risk.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  function choose(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  return (
    <div className="inline-flex gap-2">
      {OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          size="sm"
          variant={theme === opt.value ? "default" : "outline"}
          onClick={() => choose(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
