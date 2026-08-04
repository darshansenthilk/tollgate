"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

/**
 * Dropdown menu over @base-ui/react/menu, following ui/select.tsx's wrapper
 * conventions — it is the only other positioned-popup primitive in here, so the
 * Portal → Positioner → Popup nesting, the data-slot attributes and the popup's
 * surface classes are all copied from it deliberately.
 *
 * ONE THING IS NOT COPIED: `alignItemWithTrigger`. That is a Select-only prop
 * (it lines the selected item up over the trigger, which only makes sense when
 * the popup has a "current" item); a menu has no selected item and passing it
 * would just be noise.
 */

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  children,
  side = "bottom",
  align = "end",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & {
  side?: MenuPrimitive.Positioner.Props["side"]
  align?: MenuPrimitive.Positioner.Props["align"]
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"]
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-50 outline-none select-none"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "min-w-36 origin-[var(--transform-origin)] rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10 outline-none data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95 data-starting-style:animate-in data-starting-style:fade-in-0 data-starting-style:zoom-in-95",
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  /** `destructive` tints the label with the same --err token inline errors use,
   *  so a Delete row doesn't read like an ordinary action. */
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        variant === "destructive" &&
          "text-(--err) data-highlighted:bg-(--err)/10 data-highlighted:text-(--err)",
        className
      )}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
