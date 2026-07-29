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

export function WaitlistForm() {
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
        body: JSON.stringify({ email: trimmed, _subject: "Tollgate waitlist signup" }),
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
        className="flex items-center gap-2.5 font-mono text-[15px]"
        style={{ color: "var(--ok)" }}
      >
        <span>✓</span> On the list. We&apos;ll be in touch.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[480px] flex-wrap gap-2.5">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="glass min-w-[240px] flex-1 px-[15px] py-3.5 text-[15px] outline-none"
        style={{ borderColor: "rgba(255,255,255,.18)", color: "var(--ink)" }}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-brand px-6 py-3.5 font-mono text-[13px] font-medium tracking-[0.1em] whitespace-nowrap text-[#0b0b0d] uppercase transition-[background-color,box-shadow] hover:bg-[#ff5f53] hover:shadow-[0_8px_26px_rgba(255,74,61,0.175)] disabled:opacity-50"
      >
        {pending ? "Sending…" : "Request access"}
      </button>
      {error !== null && (
        <p className="w-full text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
