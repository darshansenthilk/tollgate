"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TwoFactorEnroll } from "@/components/two-factor-enroll";
import { TwoFactorManage } from "@/components/two-factor-manage";
import { UpstreamKeysSettings } from "@/components/upstream-keys-settings";
import { authClient } from "@/lib/auth-client";

/**
 * Settings/Security surface (PLAN.md §5). The two-factor card swaps between
 * TwoFactorEnroll and TwoFactorManage based on the live session's
 * twoFactorEnabled — both plugins' fetch hooks refresh that session atom on
 * every /two-factor/* call (see auth-client.ts), so this reacts immediately
 * after enrolling, disabling, or regenerating without a manual refresh.
 */
export default function SettingsPage() {
  const { data: sessionData, isPending } = authClient.useSession();
  const twoFactorEnabled = sessionData?.user?.twoFactorEnabled === true;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Account and security preferences.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            {twoFactorEnabled
              ? "Enabled — every sign-in from a new browser requires a code from your authenticator app."
              : "Optional, but recommended — makes your account significantly harder to breach even if your password leaks."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : twoFactorEnabled ? (
            <TwoFactorManage />
          ) : (
            // No-op on purpose: the reactive session update above already
            // swaps this card over to TwoFactorManage once enrolled.
            <TwoFactorEnroll onEnrolled={() => {}} />
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Provider keys</CardTitle>
          <CardDescription>
            Bring your own OpenAI and Anthropic keys so your agents&apos; usage
            bills to your provider account instead of Tollgate&apos;s. Keys are
            verified with the provider before they&apos;re saved, encrypted at
            rest, and never shown again afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UpstreamKeysSettings />
        </CardContent>
      </Card>
    </main>
  );
}
