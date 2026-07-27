"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

interface TwoFactorChallengeProps {
  onVerified: () => void;
  /** The pending 2FA cookie expired, or this challenge hit its own 5-attempt
   *  cap (distinct from the plugin's 10-attempt account lockout) — either way
   *  Better Auth has discarded the challenge and a fresh sign-in is required. */
  onExpired: (message: string) => void;
}

const EXPIRED_CODES = new Set(["INVALID_TWO_FACTOR_COOKIE", "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"]);

/**
 * Code-entry screen shown after a correct password on a 2FA-enabled account
 * (PLAN.md §5) — Better Auth withholds the session cookie entirely until
 * this succeeds (see auth.ts's plugin comment). Toggles between a TOTP code
 * and a one-time backup code against the matching verify endpoint; "trust
 * this device" suppresses the prompt on this browser for the plugin's
 * configured window (30 days, library default).
 */
export function TwoFactorChallenge({ onVerified, onExpired }: TwoFactorChallengeProps) {
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice });

      if (result.error) {
        const err = result.error as { code?: string; message?: string };
        if (err.code !== undefined && EXPIRED_CODES.has(err.code)) {
          onExpired("Your sign-in expired. Please sign in again.");
          return;
        }
        setError(err.message ?? "That code didn't work — try again.");
        return;
      }

      onVerified();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {useBackupCode
          ? "Enter one of your backup codes."
          : "Enter the 6-digit code from your authenticator app."}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="2fa-challenge-code">
          {useBackupCode ? "Backup code" : "Authentication code"}
        </Label>
        <Input
          id="2fa-challenge-code"
          autoComplete="one-time-code"
          inputMode={useBackupCode ? "text" : "numeric"}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={useBackupCode ? "abcde-fghij" : "123456"}
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="trust-device"
          checked={trustDevice}
          onCheckedChange={() => setTrustDevice((t) => !t)}
        />
        <Label htmlFor="trust-device" className="font-normal">
          Trust this device for 30 days
        </Label>
      </div>

      {error !== null && (
        <p className="text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>

      <button
        type="button"
        className="text-sm text-muted-foreground hover:text-brand"
        onClick={() => {
          setUseBackupCode((v) => !v);
          setCode("");
          setError(null);
        }}
      >
        {useBackupCode ? "Use an authenticator code instead" : "Use a backup code instead"}
      </button>
    </form>
  );
}
