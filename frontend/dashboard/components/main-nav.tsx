"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Top navigation. A client component solely because the active-route underline
 * needs usePathname() — layout.tsx stays a server component and just renders
 * this.
 *
 * Colour is set with utility classes, never an inline `style`: an inline style
 * outranks Tailwind's hover variant and silently kills `hover:text-brand`
 * (the bug fixed on 2026-07-24 — see docs/COMPLETION.md).
 */
const LINKS = [
  { href: "/", label: "Agent Dashboard" },
  { href: "/status", label: "System status" },
] as const;

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex items-center gap-5 border-b px-6 py-3 text-sm"
      style={{ borderColor: "var(--line)" }}
    >
      <span className="flex items-center gap-2">
        {/* Brand mark — sharp coral square, straight from the template. */}
        <span aria-hidden className="size-2.5 bg-brand" />
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-foreground/90">
          Tollgate
        </span>
      </span>
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // -bottom-3 matches the nav's py-3, so the bar lands exactly on
              // the nav's bottom border rather than floating above it.
              "relative transition-colors after:absolute after:inset-x-0 after:-bottom-3 after:h-0.5 after:bg-brand",
              active
                ? "text-foreground"
                : "text-muted-foreground after:hidden hover:text-brand",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
