"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TwoFactorChallenge } from "@/components/two-factor-challenge";
import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in",
    description:
      "Welcome back. Enter your credentials to reach your dashboard.",
    submit: "Sign in",
    pending: "Signing in…",
    altText: "New to Tollgate?",
    altLabel: "Create an account",
    altHref: "/sign-up",
  },
  "sign-up": {
    title: "Create account",
    description:
      "Sign up with an email and password to get your own dashboard.",
    submit: "Create account",
    pending: "Creating…",
    altText: "Already have an account?",
    altLabel: "Sign in",
    altHref: "/sign-in",
  },
} as const;

// The signed-out client mirrors the server's lockout purely for UX — the api
// (backend/api/src/lib/login-throttle.ts) is the real gate. Stashing the unlock
// time in localStorage keeps the countdown alive across a reload.
const LOCK_STORAGE_KEY = "tollgate:signin-lock-until";

function formatCountdown(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Shared sign-in / sign-up form. Email + password, no name field (the
 * account's display name defaults to its email). Talks to Better Auth on the
 * api via authClient; on success the session cookie is set and we navigate to
 * the dashboard — UNLESS the account has TOTP enabled (PLAN.md, Layer 2), in
 * which case sign-in withholds the session entirely and this instead renders
 * the 2FA challenge screen (see twoFactorPending below). Errors are kept
 * generic on sign-in to avoid account enumeration, except the throttle's own
 * "N attempts remaining" / lockout messages, which are safe to surface (the
 * api counts real and fake emails identically, so nothing leaks).
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockRemaining, setLockRemaining] = useState(0);
  // Set once a sign-in's password step succeeds but the account still needs a
  // TOTP/backup code (Better Auth's twoFactorRedirect response) — swaps the
  // card over to TwoFactorChallenge instead of navigating to the dashboard.
  // Sign-up never sets this: a brand-new account's twoFactorEnabled defaults
  // false, so the plugin's sign-in hook never fires for it.
  const [twoFactorPending, setTwoFactorPending] = useState(false);

  const copy = COPY[mode];
  const locked = lockedUntil !== null && lockRemaining > 0;

  // Restore an in-progress lockout after a reload.
  useEffect(() => {
    const raw = window.localStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) return;
    const until = Number(raw);
    if (Number.isFinite(until) && until > Date.now()) setLockedUntil(until);
    else window.localStorage.removeItem(LOCK_STORAGE_KEY);
  }, []);

  // Tick the countdown while locked; clear everything once it lapses.
  useEffect(() => {
    if (lockedUntil === null) {
      setLockRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((lockedUntil - Date.now()) / 1000),
      );
      setLockRemaining(remaining);
      if (remaining <= 0) {
        setLockedUntil(null);
        setError(null);
        window.localStorage.removeItem(LOCK_STORAGE_KEY);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    setPending(true);
    setError(null);
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name: email })
          : await authClient.signIn.email({ email, password });

      if (result.error) {
        const err = result.error as {
          code?: string;
          message?: string;
          retryAfter?: number;
        };

        if (err.code === "ACCOUNT_LOCKED") {
          // Throttled by the api. Mirror its cooldown so the form disables and a
          // countdown ticks locally without further round-trips.
          const seconds =
            typeof err.retryAfter === "number" && err.retryAfter > 0
              ? err.retryAfter
              : 300;
          const until = Date.now() + seconds * 1000;
          setLockedUntil(until);
          window.localStorage.setItem(LOCK_STORAGE_KEY, String(until));
          setError(
            err.message ?? "Too many failed attempts. Please try again later.",
          );
        } else if (mode === "sign-in") {
          // Generic to avoid enumeration — except the throttle's remaining-count
          // message, which is uniform for real and fake emails.
          setError(
            err.code === "LOGIN_ATTEMPTS_REMAINING"
              ? (err.message ?? "Invalid email or password.")
              : "Invalid email or password.",
          );
        } else {
          // Sign-up surfaces the real message (password length / duplicate email).
          setError(err.message ?? "Could not create your account.");
        }
        return;
      }

      // A 2FA-enabled account: Better Auth deleted the session it just
      // issued and withheld the cookie, returning this shape instead (see
      // auth.ts's plugin comment). Swap to the challenge screen rather than
      // navigating — there's no session yet to navigate with.
      const data = result.data as { twoFactorRedirect?: boolean } | null;
      if (data?.twoFactorRedirect) {
        setTwoFactorPending(true);
        return;
      }

      // Session cookie is set. A fresh sign-up goes through the 2FA opt-in
      // prompt first (encourages, doesn't force, enabling TOTP — PLAN.md §6);
      // an existing account signing in without 2FA goes straight to the
      // dashboard. refresh() re-runs the middleware so the now-authenticated
      // state is picked up either way.
      router.push(mode === "sign-up" ? "/enroll-2fa" : "/agents");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Brand mark — the same wordmark as the dashboard nav (see
            main-nav.tsx), scaled up to span the card's width as a page
            header. Rendered near its native size (240x48) rather than the
            nav's small icon-sized rendering. */}
        <div className="mb-6 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size
              wordmark; next/image's overhead isn't worth it here. */}
          <img src="/logo.svg" alt="Tollgate" className="h-12 w-auto" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {twoFactorPending ? "Two-factor authentication" : copy.title}
            </CardTitle>
            <CardDescription>
              {twoFactorPending
                ? "Confirm it's you to finish signing in."
                : copy.description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {twoFactorPending ? (
              <TwoFactorChallenge
                onVerified={() => {
                  // Session cookie is now set (see verify-two-factor.ts) —
                  // head to the dashboard same as a non-2FA sign-in.
                  router.push("/agents");
                  router.refresh();
                }}
                onExpired={(message) => {
                  // The pending 2FA cookie died (window lapsed, or 5 wrong
                  // attempts) — there's no session to challenge anymore, so
                  // drop back to credentials and make them sign in again.
                  setTwoFactorPending(false);
                  setPassword("");
                  setError(message);
                }}
              />
            ) : (
              <>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={locked}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete={
                        mode === "sign-up" ? "new-password" : "current-password"
                      }
                      required
                      minLength={8}
                      disabled={locked}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                  </div>

                  {error !== null && (
                    <p className="text-sm" style={{ color: "var(--err)" }}>
                      {error}
                    </p>
                  )}

                  <Button type="submit" disabled={pending || locked}>
                    {locked
                      ? `Locked — retry in ${formatCountdown(lockRemaining)}`
                      : pending
                        ? copy.pending
                        : copy.submit}
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-muted-foreground">
                  {copy.altText}{" "}
                  <Link
                    href={copy.altHref}
                    className="text-brand hover:underline"
                  >
                    {copy.altLabel}
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
