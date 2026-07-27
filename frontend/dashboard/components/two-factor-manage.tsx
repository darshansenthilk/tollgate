"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BackupCodesModal } from "@/components/backup-codes-modal";
import { authClient } from "@/lib/auth-client";

/**
 * Manage an already-enrolled account: regenerate backup codes and disable
 * 2FA, both gated by password re-entry (PLAN.md §5 points 3-4). There is no
 * "view existing backup codes" action — Better Auth only exposes regenerate,
 * which invalidates the old set (see the plugin's viewBackupCodes endpoint,
 * server-only with no client method) — this UI reflects that limit rather
 * than working around it.
 *
 * 2FA is opt-in (PLAN.md §6, revised 2026-07-26), so disabling here is a real
 * opt-out: require-auth.ts doesn't gate on twoFactorEnabled at all, so the
 * account keeps full dashboard access on password alone afterward. Settings
 * swaps this card back to TwoFactorEnroll so re-enabling later is just as
 * easy.
 */
export function TwoFactorManage() {
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenPending, setRegenPending] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disablePending, setDisablePending] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  async function handleRegenerate(e: React.FormEvent) {
    e.preventDefault();
    setRegenPending(true);
    setRegenError(null);
    try {
      const result = await authClient.twoFactor.generateBackupCodes({ password: regenPassword });
      if (result.error) {
        setRegenError(result.error.message ?? "Could not regenerate backup codes.");
        return;
      }
      setRegenOpen(false);
      setRegenPassword("");
      setNewBackupCodes(result.data.backupCodes);
    } catch {
      setRegenError("Something went wrong. Please try again.");
    } finally {
      setRegenPending(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setDisablePending(true);
    setDisableError(null);
    try {
      const result = await authClient.twoFactor.disable({ password: disablePassword });
      if (result.error) {
        setDisableError(result.error.message ?? "Could not disable two-factor authentication.");
        return;
      }
      setDisableOpen(false);
      setDisablePassword("");
    } catch {
      setDisableError("Something went wrong. Please try again.");
    } finally {
      setDisablePending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Dialog
          open={regenOpen}
          onOpenChange={(next) => {
            setRegenOpen(next);
            if (!next) {
              setRegenPassword("");
              setRegenError(null);
            }
          }}
        >
          <DialogTrigger render={<Button type="button" variant="outline" />}>
            Regenerate backup codes
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleRegenerate} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>Regenerate backup codes</DialogTitle>
                <DialogDescription>
                  Your existing backup codes will stop working. Confirm your password to
                  continue.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="regen-password">Password</Label>
                <Input
                  id="regen-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={regenPassword}
                  onChange={(e) => setRegenPassword(e.target.value)}
                />
              </div>
              {regenError !== null && (
                <p className="text-sm" style={{ color: "var(--err)" }}>
                  {regenError}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={regenPending}>
                  {regenPending ? "Regenerating…" : "Regenerate"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={disableOpen}
          onOpenChange={(next) => {
            setDisableOpen(next);
            if (!next) {
              setDisablePassword("");
              setDisableError(null);
            }
          }}
        >
          <DialogTrigger render={<Button type="button" variant="destructive" />}>
            Disable 2FA
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleDisable} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>Disable two-factor authentication</DialogTitle>
                <DialogDescription>
                  You&apos;ll be able to sign in with just your password afterward. You can turn
                  2FA back on anytime from here. Confirm your password to continue.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="disable-password">Password</Label>
                <Input
                  id="disable-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                />
              </div>
              {disableError !== null && (
                <p className="text-sm" style={{ color: "var(--err)" }}>
                  {disableError}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" variant="destructive" disabled={disablePending}>
                  {disablePending ? "Disabling…" : "Disable"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <BackupCodesModal
        open={newBackupCodes !== null}
        codes={newBackupCodes ?? []}
        onAcknowledge={() => setNewBackupCodes(null)}
      />
    </>
  );
}
