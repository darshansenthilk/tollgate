"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreateDashboardTile } from "@/components/create-dashboard-tile";
import { ApiError, createDashboard, type Dashboard } from "@/lib/api";

export function CreateDashboardDialog({
  onCreated,
}: {
  onCreated?: (dashboard: Dashboard) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();

  function resetAndClose() {
    setOpen(false);
    // Reset after the close animation so the form doesn't visibly flash blank.
    setTimeout(() => {
      setName("");
      setError(null);
    }, 150);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const dashboard = await createDashboard(trimmedName);
      onCreated?.(dashboard);
      resetAndClose();
      // The new dashboard is already active server-side, so open it straight
      // away like Google Docs opens a doc created from a template.
      router.push("/agents");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetAndClose();
        else setOpen(true);
      }}
    >
      <DialogTrigger render={<CreateDashboardTile />} />
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create dashboard</DialogTitle>
            <DialogDescription>
              Opens straight away once created.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-name">Name</Label>
            <Input
              id="dashboard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Platform team"
              required
              maxLength={50}
            />
            <p className="text-right text-xs text-muted-foreground">
              {name.length}/50
            </p>
          </div>

          {error !== null && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending || trimmedName === ""}>
              {pending ? "Creating…" : "Create dashboard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
