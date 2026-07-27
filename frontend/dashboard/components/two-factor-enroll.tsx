"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BackupCodesModal } from "@/components/backup-codes-modal";
import { authClient } from "@/lib/auth-client";

type Step = "password" | "verify";

/**
 * The one enrollment flow used both by the post-sign-up opt-in prompt
 * (app/enroll-2fa) and inline in Settings/Security (PLAN.md §5 points 1-2):
 * password re-entry -> enable() issues a TOTP secret + backup codes ->
 * scan/enter it and confirm with a live code -> the backup-codes
 * acknowledgment modal, which is the only way out of this component.
 */
export function TwoFactorEnroll({ onEnrolled }: { onEnrolled: () => void }) {
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBackupModal, setShowBackupModal] = useState(false);

  // otpauth://totp/Tollgate:you@example.com?secret=...&issuer=Tollgate — the
  // manual-entry fallback is just this query param, scheme-agnostic to parse.
  const secret = totpURI !== null ? new URL(totpURI).searchParams.get("secret") : null;

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) {
        setError(result.error.message ?? "Could not enable two-factor authentication.");
        return;
      }
      setTotpURI(result.data.totpURI);
      setBackupCodes(result.data.backupCodes);
      setStep("verify");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(result.error.message ?? "That code didn't work — try again.");
        return;
      }
      setShowBackupModal(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (step === "password") {
    return (
      <form onSubmit={handleEnable} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Confirm your password to start enrolling an authenticator app.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="2fa-enable-password">Password</Label>
          <Input
            id="2fa-enable-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </form>
    );
  }

  return (
    <>
      <form onSubmit={handleVerify} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Scan this code with an authenticator app (1Password, Google Authenticator, etc.), or
          enter the secret manually.
        </p>

        {totpURI !== null && (
          <div className="flex justify-center rounded-lg border bg-white p-4">
            <QRCodeSVG value={totpURI} size={176} />
          </div>
        )}

        {secret !== null && (
          <div className="flex flex-col gap-1.5">
            <Label>Manual entry secret</Label>
            <code className="overflow-x-auto rounded-lg border bg-muted px-2.5 py-1.5 text-xs">
              {secret}
            </code>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="2fa-verify-code">6-digit code</Label>
          <Input
            id="2fa-verify-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
          />
        </div>

        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Verify and enable"}
        </Button>
      </form>

      <BackupCodesModal
        open={showBackupModal}
        codes={backupCodes ?? []}
        onAcknowledge={() => {
          setShowBackupModal(false);
          onEnrolled();
        }}
      />
    </>
  );
}
