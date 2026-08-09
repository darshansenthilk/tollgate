"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboards", label: "My Dashboards", icon: User },
  { href: "/dashboards/shared", label: "Shared Dashboards", icon: Users },
] as const;

/**
 * Manage Dashboards' own view switcher, scoped to /dashboards and
 * /dashboards/shared only — distinct from the global MainNav (components/
 * main-nav.tsx), which keeps pointing its "Manage Dashboards" link at
 * /dashboards untouched. Real page navigations between two routes, not
 * client-side panel switches, so plain links + aria-current (mirroring
 * main-nav.tsx's active-link pattern) rather than an ARIA tablist.
 *
 * Icon-only, not a fixed sidebar and not a text segmented control (both
 * tried first — see git history): User for "My Dashboards", Users (two
 * overlapping people) for "Shared Dashboards" — a `title` + `aria-label`
 * carries the name for anyone who can't read the icon at a glance, same
 * pattern create-dashboard-tile.tsx uses for its icon-only Plus button.
 *
 * Active state is a flat `border-border` outline, not a shadow — this
 * app's page chrome is deliberately flat (globals.css:260-270, "page panels
 * are flat" — shadows are reserved for the one floating .mk-island top
 * nav), and `--background` vs `--muted` are too close in light mode
 * (~1.09:1 contrast) for a shadow to read as "lifted" on its own anyway.
 * The active icon also picks up `text-brand`, matching how every other
 * "you are here" signal in this app works (`.mk-nav-link-current`,
 * `text-brand` on the /agents and activity-log empty-state links) rather
 * than inventing a new convention.
 *
 * No responsive breakpoints needed: a compact, fixed-size icon pair reads
 * fine from a phone to a wide monitor without the mobile/desktop split the
 * text version needed, which also sidesteps that version's real bug — two
 * independent reviews of it found the track had no `items-center`, so a
 * wrapped two-line label next to a one-line sibling produced a visibly
 * broken, top-aligned active pill on narrow phones. Icons never wrap, so
 * that failure mode doesn't exist here. `size-11` (44px) targets the
 * ~44px WCAG 2.5.5 / Apple HIG touch-target recommendation the text
 * version's `py-2`/`py-1.5` fell short of (36px/32px).
 */
export function DashboardsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Manage Dashboards" className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "flex size-11 items-center justify-center rounded-full transition-colors",
              active
                ? "border border-border bg-background text-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
          </Link>
        );
      })}
    </nav>
  );
}
