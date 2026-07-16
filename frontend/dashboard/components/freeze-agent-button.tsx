"use client";

import { useState } from "react";
import type { AgentStatus } from "@tollgate/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, freezeAgent, unfreezeAgent } from "@/lib/api";

const FROZEN_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "soft_frozen",
  "hard_frozen",
]);

/**
 * Copy pulled from the AgentStatus doc comment (backend/shared/src/index.ts):
 * soft_frozen = "new operations denied; in-flight + completion ops drain
 * (SIGTERM)", hard_frozen = "total revocation (SIGKILL)". Soft stays the
 * default — it's the reversible, graceful option.
 */
const FREEZE_MODES = [
  { value: "soft", label: "Soft freeze" },
  { value: "hard", label: "Hard freeze" },
] as const;

type FreezeMode = (typeof FREEZE_MODES)[number]["value"];

const FREEZE_MODE_COPY: Record<FreezeMode, string> = {
  soft: "This denies the agent's next proxy request immediately (soft freeze: in-flight work drains, new requests are refused).",
  hard: "This is a total revocation, not a graceful drain — the agent is cut off immediately and completely, with no in-flight grace period (soft freeze is the SIGTERM-style drain; this is SIGKILL).",
};

interface FreezeAgentButtonProps {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  onStatusChange: (status: AgentStatus) => void;
}

export function FreezeAgentButton({
  agentId,
  agentName,
  status,
  onStatusChange,
}: FreezeAgentButtonProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FreezeMode>("soft");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "archived") return null;

  const isFrozen = FROZEN_STATUSES.has(status);
  const action = isFrozen ? "Unfreeze" : "Freeze";

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset after the close animation so the dialog doesn't flash blank,
      // and so a pasted token doesn't linger in state after closing.
      setTimeout(() => {
        setMode("soft");
        setToken("");
        setError(null);
      }, 150);
    }
  }

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const trimmedToken = token.trim() || undefined;
      const result = isFrozen
        ? await unfreezeAgent(agentId, trimmedToken)
        : await freezeAgent(agentId, mode, trimmedToken);
      if (result.status !== undefined) onStatusChange(result.status);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  const confirmLabel = isFrozen ? "Unfreeze" : mode === "hard" ? "Hard freeze" : "Soft freeze";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={isFrozen ? "default" : "outline"} size="sm" />
        }
      >
        {action}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action} {agentName}?
          </DialogTitle>
          <DialogDescription>
            {isFrozen
              ? "This restores the agent to active — its next proxy request will be evaluated normally again."
              : FREEZE_MODE_COPY[mode]}
          </DialogDescription>
        </DialogHeader>

        {!isFrozen && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="freeze-mode">Freeze mode</Label>
            <Select
              items={FREEZE_MODES}
              value={mode}
              onValueChange={(value) => {
                if (value !== null) setMode(value);
              }}
            >
              <SelectTrigger id="freeze-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREEZE_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === "hard" && !isFrozen && (
          <div
            className="rounded-lg border p-3"
            style={{
              borderColor: "var(--err)",
              background: "color-mix(in oklch, var(--err) 10%, transparent)",
            }}
          >
            <p className="text-sm font-medium" style={{ color: "var(--err)" }}>
              Hard freeze is total revocation — there's no drain period, unlike
              soft freeze.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="freeze-token">Agent token (optional)</Label>
          <Input
            id="freeze-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="tg_..."
          />
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Sent as an <code>Authorization: Bearer</code> header. Not verified
            server-side yet — backend/api/src/routes/agents.ts's freeze/unfreeze
            handlers don't read it, so pasting a token here has no effect on
            the request today.
          </p>
        </div>

        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant={isFrozen ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
