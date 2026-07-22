"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * A right-edge sliding panel built directly on @base-ui/react/dialog (same
 * primitive as ui/dialog.tsx) rather than the heavier drawer primitive —
 * this only needs backdrop + portal + focus trap + the data-open/data-closed
 * transition dialog.tsx already relies on, just repositioned to an edge
 * instead of centered.
 */
function Sidebar({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sidebar" {...props} />
}

function SidebarPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="sidebar-portal" {...props} />
}

function SidebarClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sidebar-close" {...props} />
}

function SidebarOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sidebar-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/25 duration-300 supports-backdrop-filter:backdrop-blur-md data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <SidebarPortal>
      <SidebarOverlay />
      <DialogPrimitive.Popup
        data-slot="sidebar-content"
        className={cn(
          // Liquid-glass panel: translucent + blurred + saturated backdrop
          // (backdrop-filter is what actually blurs/saturates whatever's
          // behind the panel — gated behind `supports-backdrop-filter:` so
          // browsers without it fall back to a plain, more opaque panel
          // instead of looking washed out), plus a soft inset highlight
          // along the top/left edge to read as a glass rim catching light.
          "fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-sm flex-col gap-4 overflow-y-auto border-l border-white/15 bg-popover/90 p-4 text-sm text-popover-foreground outline-none duration-300 ease-out shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5),inset_1px_0_0_0_rgba(255,255,255,0.08),inset_0_1px_0_0_rgba(255,255,255,0.12)] supports-backdrop-filter:bg-popover/55 supports-backdrop-filter:backdrop-blur-2xl supports-backdrop-filter:backdrop-saturate-150 data-open:animate-in data-open:slide-in-from-right data-open:fade-in-0 data-closed:animate-out data-closed:slide-out-to-right data-closed:fade-out-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sidebar-close"
            render={
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </SidebarPortal>
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-header" className={cn("flex flex-col gap-2 pr-6", className)} {...props} />
  )
}

function SidebarTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="sidebar-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function SidebarDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="sidebar-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarClose,
  SidebarContent,
  SidebarDescription,
  SidebarHeader,
  SidebarTitle,
}
