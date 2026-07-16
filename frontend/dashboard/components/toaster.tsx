"use client";

import {
  ToastClose,
  ToastDescription,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from "@/components/ui/toast";

/** Mounted once (app/layout.tsx, inside ToastProvider) — renders whatever
 *  toasts any component in the tree has added via useToastManager().add(). */
export function Toaster() {
  const { toasts } = useToastManager();

  return (
    <ToastViewport>
      {toasts.map((toast) => (
        <ToastRoot key={toast.id} toast={toast}>
          {toast.title !== undefined && <ToastTitle>{toast.title}</ToastTitle>}
          {toast.description !== undefined && (
            <ToastDescription>{toast.description}</ToastDescription>
          )}
          <ToastClose />
        </ToastRoot>
      ))}
    </ToastViewport>
  );
}
