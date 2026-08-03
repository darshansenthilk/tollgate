"use client";

import { cn } from "@/lib/utils";
import type { Dashboard } from "@/lib/api";

interface DashboardTileProps {
  dashboard: Dashboard;
  active: boolean;
  onSelect: (id: string) => void;
}

export function DashboardTile({
  dashboard,
  active,
  onSelect,
}: DashboardTileProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(dashboard.id)}
      aria-current={active ? "true" : undefined}
      className={cn(
        // Outline, not ring, for focus (and so no `outline-none` here): a focus
        // ring would replace the active ring below and lose the "this is the
        // current dashboard" cue while tabbing across tiles.
        "flex aspect-[2/1] w-full cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-center text-primary-foreground transition hover:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active && "ring-2 ring-foreground",
      )}
    >
      <span className="text-sm font-medium break-words">{dashboard.name}</span>
    </button>
  );
}
