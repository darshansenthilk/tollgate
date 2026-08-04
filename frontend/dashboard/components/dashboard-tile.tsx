"use client";

import { Ellipsis } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Dashboard } from "@/lib/api";

interface DashboardTileProps {
  dashboard: Dashboard;
  active: boolean;
  onSelect: (id: string) => void;
  /** Renders the 3-dot menu when supplied. Optional so the tile stays usable as
   *  a plain selector; the menu's actions are the owner's business, not the
   *  tile's — it never calls the api itself. */
  onDelete?: (id: string) => void;
}

/**
 * A wrapper div holding TWO SIBLINGS rather than one button, and that structure
 * is load-bearing: this used to be a single bare <button>, and nesting the
 * 3-dot trigger inside it would be invalid HTML *and* would bubble every menu
 * click into onSelect, navigating to /agents instead of opening the menu.
 *
 * The active ring therefore moves to the wrapper (it has to enclose both
 * children), while focus-visible stays an OUTLINE on the select button — see the
 * comment below for why that distinction matters.
 */
export function DashboardTile({
  dashboard,
  active,
  onSelect,
  onDelete,
}: DashboardTileProps) {
  return (
    <div
      className={cn(
        // aspect-[2/1] w-full lives here now, so the tile stays dimensionally
        // identical to create-dashboard-tile.tsx even though the button inside
        // is absolutely positioned.
        "relative aspect-[2/1] w-full rounded-xl",
        active && "ring-2 ring-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(dashboard.id)}
        aria-current={active ? "true" : undefined}
        className={cn(
          // Outline, not ring, for focus (and so no `outline-none` here): a
          // focus ring would replace the active ring on the wrapper and lose the
          // "this is the current dashboard" cue while tabbing across tiles.
          "absolute inset-0 flex cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-center text-primary-foreground transition hover:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        {/* wrap-anywhere, not break-words: break-words is excluded from
            min-content intrinsic sizing, which is what let a long unbroken name
            push a fixed-size sibling out of the card entirely once before. */}
        <span className="text-sm font-medium wrap-anywhere">{dashboard.name}</span>
      </button>

      {onDelete !== undefined && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Options for ${dashboard.name}`}
            className="absolute right-2 bottom-2 flex size-7 cursor-pointer items-center justify-center rounded-md text-primary-foreground/70 transition outline-none hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-primary-foreground/15 data-popup-open:text-primary-foreground"
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(dashboard.id)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
