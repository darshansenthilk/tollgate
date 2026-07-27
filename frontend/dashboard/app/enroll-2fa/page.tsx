"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TwoFactorEnroll } from "@/components/two-factor-enroll";
import { authClient } from "@/lib/auth-client";

type Step = "prompt" | "enroll";

/**
 * Post-sign-up 2FA opt-in prompt (PLAN.md §6, revised 2026-07-26 from a
 * mandatory gate to this encouragement screen). Reached once, right after a
 * fresh sign-up (see auth-form.tsx) — never forced on sign-in, and never
 * gated server-side (require-auth.ts doesn't check twoFactorEnabled at all).
 * "Skip for now" and the sign-out escape hatch both lead straight back to the
 * dashboard/sign-in; enabling reuses the same TwoFactorEnroll flow Settings
 * uses.
 */
export default function Enroll2FAPage() {
  const router = useRouter();
  const { data: sessionData, isPending } = authClient.useSession();
  const [step, setStep] = useState<Step>("prompt");

  useEffect(() => {
    if (!isPending && sessionData?.user?.twoFactorEnabled === true) {
      router.replace("/");
    }
  }, [isPending, sessionData, router]);

  function skip() {
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span aria-hidden className="size-9 bg-brand" />
          <span className="font-mono text-5xl uppercase tracking-[0.25em] text-foreground/90">
            Tollgate
          </span>
        </div>

        <Card>
          {step === "prompt" ? (
            <>
              <CardHeader>
                <CardTitle>Secure your account?</CardTitle>
                <CardDescription>
                  Turning on two-factor authentication makes it significantly harder for someone
                  else to get into your dashboard, even if they get hold of your password. It
                  takes about two minutes with an authenticator app already on your phone.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button type="button" onClick={() => setStep("enroll")}>
                  Enable two-factor authentication
                </Button>
                <Button type="button" variant="outline" onClick={skip}>
                  Skip for now
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  You can turn this on anytime later from Settings.
                </p>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Set up two-factor authentication</CardTitle>
                <CardDescription>
                  Scan the QR code with an authenticator app to finish enabling it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TwoFactorEnroll
                  onEnrolled={() => {
                    router.push("/");
                    router.refresh();
                  }}
                />
              </CardContent>
            </>
          )}
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Wrong account?{" "}
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={async () => {
              await authClient.signOut();
              router.push("/sign-in");
              router.refresh();
            }}
          >
            Sign out
          </button>
        </p>
      </div>
    </main>
  );
}
