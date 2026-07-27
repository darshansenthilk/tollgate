"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface BackupCodesModalProps {
  open: boolean;
  codes: string[];
  onAcknowledge: () => void;
}

/**
 * Shown once right after backup codes are (re)issued — enrollment and
 * regenerate both funnel through this (PLAN.md §5 points 2 & 4). Codes are
 * never recoverable in plaintext again once dismissed, so dismissal is
 * blocked until the acknowledgment box is checked: no close button, and
 * onOpenChange never flips `open` off on its own, so Escape/outside-click
 * are no-ops — only the Continue button can close this.
 */
export function BackupCodesModal({ open, codes, onAcknowledge }: BackupCodesModalProps) {
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Codes are still selectable by hand from the list below.
    }
  }

  function handleContinue() {
    setChecked(false);
    setCopied(false);
    onAcknowledge();
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save your backup codes</DialogTitle>
          <DialogDescription>
            Each code works once, as a substitute for your authenticator app if you lose access
            to it. They&apos;re shown only this one time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-3 font-mono text-xs">
          {codes.map((code) => (
            <code key={code}>{code}</code>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy all"}
        </Button>

        <div className="flex items-start gap-2">
          <Checkbox
            id="backup-codes-ack"
            checked={checked}
            onCheckedChange={() => setChecked((c) => !c)}
          />
          <Label htmlFor="backup-codes-ack" className="font-normal">
            I&apos;ve saved these backup codes somewhere safe.
          </Label>
        </div>

        <DialogFooter>
          <Button type="button" disabled={!checked} onClick={handleContinue}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
