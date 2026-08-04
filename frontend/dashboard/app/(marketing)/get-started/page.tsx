"use client";

import { useCallback, useEffect, useState } from "react";
import { StickyNav } from "@/components/marketing/sticky-nav";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { AccessCtaSection } from "@/components/marketing/access-cta-section";
import { ApiError, askInstallWizard, isInstallWizardAvailable } from "@/lib/api";

/**
 * The self-serve download path — a step-by-step guide to running Tollgate on
 * your own infrastructure, plus a live Q&A box for whatever the steps don't
 * cover. "use client" (unlike /security, a plain server component) because
 * the Ask box needs interactive state.
 *
 * WORTH KNOWING: the sticky-nav.tsx doc comment states, deliberately, that
 * this site has "no Get started anywhere... self-serve signup isn't
 * otherwise called out" — an earlier decision to route self-hosting interest
 * through the contact form instead. This page is a real reversal of that for
 * self-hosting specifically (not the hosted product), so it's linked from the
 * footer rather than forced into the primary nav bar, leaving that earlier
 * call intact unless you decide otherwise.
 *
 * The Ask box is DELIBERATELY NOT the same assistant as the in-app /setup
 * page's — see backend/api/src/lib/install-wizard-assistant.ts's doc comment
 * for why a public, pre-install page structurally can't use the local Ollama
 * pattern (browsers can't reach a visitor's local Ollama across origins, and
 * pre-install there's no Tollgate backend of theirs running anyway). This one
 * is hosted, and says so.
 */

interface Step {
  n: number;
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Install Docker",
    body: (
      <>
        Tollgate ships as containers — Postgres, Redis, the proxy, the api,
        the dashboard. Docker Desktop runs all of it with one command.{" "}
        <a
          href="https://www.docker.com/products/docker-desktop/"
          className="text-brand hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Get Docker Desktop
        </a>
        .
      </>
    ),
  },
  {
    n: 2,
    title: "Install Ollama (optional)",
    body: (
      <>
        Powers the agent-draft wizard and the token-savings detector — both
        run entirely on your own machine, never sending agent data anywhere.
        Skip this and Tollgate still works; those two features just stay
        hidden until it's there.{" "}
        <a
          href="https://ollama.com/download"
          className="text-brand hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Get Ollama
        </a>
        , then pull a model:
        <pre className="mt-2 overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs" style={{ borderColor: "var(--mk-line)" }}>
          ollama pull llama3.2
        </pre>
      </>
    ),
  },
  {
    n: 3,
    title: "Get the source",
    body: (
      <>
        Clone the repository and copy <code className="font-mono">.env.example</code> to{" "}
        <code className="font-mono">.env</code> — or run{" "}
        <code className="font-mono">scripts/setup-selfhost.sh</code>, a guided script that
        asks a few questions and writes it for you.
      </>
    ),
  },
  {
    n: 4,
    title: "Start it",
    body: (
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs" style={{ borderColor: "var(--mk-line)" }}>
        docker compose up -d{"\n"}docker compose --profile local-llm up -d{"  # only if you did step 2"}
      </pre>
    ),
  },
  {
    n: 5,
    title: "Open it",
    body: (
      <>
        Visit{" "}
        <code className="font-mono">http://localhost:3000</code> and create your account —
        that&apos;s a local account on your own instance, not on Tollgate&apos;s.
      </>
    ),
  },
];

function AskInstallWizard() {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void isInstallWizardAvailable()
      .then((res) => setAvailable(res.available))
      .catch(() => setAvailable(false));
  }, []);

  const ask = useCallback(async () => {
    if (question.trim() === "") return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await askInstallWizard(question.trim());
      setAnswer(res.answer);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the assistant");
    } finally {
      setAsking(false);
    }
  }, [question]);

  if (available !== true) return null;

  return (
    <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
      <h2 className="mk-display-sm mb-3">Stuck on a step?</h2>
      <p className="mb-6 max-w-[58ch] text-[16px] leading-[24px]" style={{ color: "var(--muted-ink)" }}>
        Ask the install wizard. Unlike the local assistant that appears once
        Tollgate is running, this one is a hosted model — nothing is installed
        on your machine yet for it to run against, so it can only ever be
        asked questions like this, never anything about your agents.
      </p>
      <div className="mx-auto flex max-w-[58ch] flex-col gap-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What port does the dashboard use? Do I need Ollama?"
          className="min-h-20 w-full rounded-lg border bg-transparent p-3 text-sm outline-none"
          style={{ borderColor: "var(--mk-line)" }}
        />
        <div>
          <button
            type="button"
            disabled={asking}
            onClick={() => void ask()}
            className="mk-btn mk-btn-secondary mk-btn-compact whitespace-nowrap"
          >
            {asking ? "Asking…" : "Ask"}
          </button>
        </div>
        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}
        {answer !== null && (
          <div className="flex flex-col gap-1.5">
            <p className="rounded-lg border bg-muted/50 p-3 text-sm" style={{ borderColor: "var(--mk-line)" }}>
              {answer}
            </p>
            <p className="text-xs" style={{ color: "var(--muted-ink)" }}>
              A hosted model — verify anything specific against the docs in the repo
              before acting on it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GetStartedPage() {
  return (
    <>
      <StickyNav />

      <ScrollReveal>
        <header className="mk-rule border-b">
          <div className="mk-centered mx-auto max-w-[1400px] px-6 pt-[clamp(88px,11vw,144px)] pb-[clamp(56px,8vw,96px)] sm:px-8 lg:px-12">
            <h1 className="mk-display mb-6">Run it on your own infrastructure.</h1>
            <p className="mx-auto max-w-[56ch] text-[16px] leading-[24px]" style={{ color: "var(--muted-ink)" }}>
              Five steps, one machine you already control. No account with us
              required — self-hosted means your keys, your database, your data.
            </p>
          </div>
        </header>
      </ScrollReveal>

      {STEPS.map((step) => (
        <ScrollReveal key={step.n}>
          <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
            <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
              <h2 className="mk-display-sm mb-6">
                <span style={{ color: "var(--muted-ink)" }}>{step.n}.</span> {step.title}
              </h2>
              <div className="mx-auto max-w-[58ch] text-[16px] leading-[24px]" style={{ color: "var(--muted-ink)" }}>
                {step.body}
              </div>
            </div>
          </section>
        </ScrollReveal>
      ))}

      <ScrollReveal>
        <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
          <AskInstallWizard />
        </section>
      </ScrollReveal>

      <AccessCtaSection />
    </>
  );
}
