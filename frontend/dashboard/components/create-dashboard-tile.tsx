"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Visual only — every prop is forwarded so this can be a base-ui
 * DialogTrigger's `render` target (see CreateDashboardDialog), which is where
 * the click handling actually comes from.
 */
export function CreateDashboardTile({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label="Create a dashboard"
      className={cn(
        "flex aspect-[2/1] w-full cursor-pointer items-center justify-center rounded-xl bg-card ring-1 ring-foreground/10 transition outline-none hover:ring-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      <Plus className="size-8" />
    </button>
  );
}
