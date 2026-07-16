"use client"

import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        // Normal flow (not absolutely-positioned children) so every toast is
        // always visible, stacked top-to-bottom, without needing base-ui's
        // hover/focus-triggered "expanded" state — a new toast renders first
        // (toasts is newest-first) and pushes earlier ones down permanently.
        "fixed top-4 right-4 z-50 flex w-full max-w-[calc(100%-2rem)] flex-col gap-2 outline-none sm:max-w-sm",
        className
      )}
      {...props}
    />
  )
}

function ToastRoot({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "w-full rounded-xl bg-popover p-4 pr-8 text-sm text-popover-foreground ring-1 ring-foreground/10 shadow-lg outline-none transition-all duration-300",
        "data-starting-style:translate-y-0 data-starting-style:opacity-0 data-starting-style:[transform:translateY(-0.5rem)]",
        "data-ending-style:opacity-0 data-ending-style:[transform:scale(0.95)]",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("font-heading text-sm leading-snug font-medium", className)}
      {...props}
    />
  )
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("mt-1 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      render={
        <Button
          variant="ghost"
          className={cn("absolute top-2 right-2", className)}
          size="icon-sm"
        />
      }
      {...props}
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </ToastPrimitive.Close>
  )
}

// The top-level `@base-ui/react/toast` entry re-exports useToastManager as a
// type only — the runtime hook lives on the `Toast` namespace import used
// above (index.parts.js), so it's re-exported from there instead.
const useToastManager = ToastPrimitive.useToastManager

export {
  ToastProvider,
  ToastViewport,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastClose,
  useToastManager,
}
