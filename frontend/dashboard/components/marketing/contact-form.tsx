"use client";

import { useState, type FormEvent } from "react";

/**
 * FormSubmit.co forwards straight to an inbox with no signup or API key —
 * the pragmatic choice given this codebase has no email-sending
 * infrastructure yet (no Resend/SMTP config anywhere). Its first-ever
 * submission to a new address triggers a one-time confirmation email that
 * must be clicked before forwarding activates.
 */
const FORM_ENDPOINT = "https://formsubmit.co/ajax/darshan.senthilk@gmail.com";

/**
 * The sales/enquiry path. "Get started" (the old self-serve-signup pill)
 * is gone from the page entirely — /sign-up is reachable only via the
 * nav's "Sign in" pill (which itself links onward from the sign-in form)
 * — so this form is now the only on-page call to action besides "See it
 * live".
 */
export function ContactForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed === "") return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: trimmed, _subject: "Tollgate — contact request" }),
      });
      if (!res.ok) throw new Error("Request failed");
      setSubmitted(true);
    } catch {
      setError("Something went wrong — try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        className="flex items-center gap-2.5 font-mono text-[15px]"
        style={{ color: "var(--ok)" }}
      >
        <span aria-hidden>✓</span> Got it. We&apos;ll be in touch.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[480px] flex-wrap justify-center gap-2.5">
      {/* Visible-to-screen-readers label: the placeholder alone is not a label
          — it disappears on first keystroke, leaving the field unnamed. */}
      <label htmlFor="contact-email" className="sr-only">
        Work email
      </label>
      <input
        id="contact-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        aria-describedby={error !== null ? "contact-error" : undefined}
        aria-invalid={error !== null || undefined}
        className="glass h-10 min-w-[240px] flex-1 px-[15px] text-[15px]"
        style={{ color: "var(--mk-ink)" }}
      />
      <button
        type="submit"
        disabled={pending}
        className="mk-btn mk-btn-primary disabled:opacity-50"
      >
        {pending ? "Sending…" : "Talk to us"}
      </button>
      {error !== null && (
        <p id="contact-error" role="alert" className="w-full text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
