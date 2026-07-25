"use client";

import { useState } from "react";
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
import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in",
    description: "Welcome back. Enter your credentials to reach your dashboard.",
    submit: "Sign in",
    pending: "Signing in…",
    altText: "New to Tollgate?",
    altLabel: "Create an account",
    altHref: "/sign-up",
  },
  "sign-up": {
    title: "Create account",
    description: "Sign up with an email and password to get your own dashboard.",
    submit: "Create account",
    pending: "Creating…",
    altText: "Already have an account?",
    altLabel: "Sign in",
    altHref: "/sign-in",
  },
} as const;

/**
 * Shared sign-in / sign-up form. Email + password only (no 2FA, no name field —
 * the account's display name defaults to its email). Talks to Better Auth on
 * the api via authClient; on success the session cookie is set and we navigate
 * to the dashboard. Errors are kept generic on sign-in to avoid account
 * enumeration.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[mode];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name: email })
          : await authClient.signIn.email({ email, password });

      if (result.error) {
        // Sign-in stays generic (no "which field was wrong" enumeration).
        // Sign-up surfaces the real message so password-length / duplicate-email
        // feedback is actionable.
        setError(
          mode === "sign-in"
            ? "Invalid email or password."
            : result.error.message ?? "Could not create your account.",
        );
        return;
      }

      // Session cookie is set — head to the dashboard. refresh() re-runs the
      // middleware so the now-authenticated state is picked up.
      router.push("/");
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
        {/* Brand mark — the dashboard nav's coral-square + uppercase mono wordmark
            (see main-nav.tsx), scaled up to span the card's width as a page header.
            gap-3 keeps the square-to-text spacing in step with the letter tracking
            at this size; sized so the mark fills roughly the full 24rem card width. */}
        <div className="mb-6 flex items-center justify-center gap-3">
          <span aria-hidden className="size-9 bg-brand" />
          <span className="font-mono text-5xl uppercase tracking-[0.25em] text-foreground/90">
            Tollgate
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
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
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  required
                  minLength={8}
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

              <Button type="submit" disabled={pending}>
                {pending ? copy.pending : copy.submit}
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              {copy.altText}{" "}
              <Link href={copy.altHref} className="text-brand hover:underline">
                {copy.altLabel}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
