"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { TollgateLogo } from "@/components/marketing/tollgate-logo";
import { ContactForm } from "@/components/marketing/contact-form";

/** Multi-column footer with 14px/500 sans column headings — the reference's
 *  own footer shape (Build / Learn / Explore / Company / …). */
const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "#how", label: "How it works" },
      { href: "#demo", label: "Live demo" },
      { href: "#contact", label: "Talk to us" },
    ],
  },
  {
    heading: "Supports",
    links: [
      { href: "https://platform.openai.com/docs/api-reference", label: "OpenAI" },
      { href: "https://docs.anthropic.com", label: "Anthropic" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/sign-up", label: "Get started" },
      { href: "/sign-in", label: "Sign in" },
    ],
  },
];

export function AccessCtaSection() {
  return (
    <>
      {/* Closing CTA — the one centred heading on the page, matching the
          reference, which left-aligns every section heading except this one. */}
      <ScrollReveal>
        <section id="contact" className="border-b" style={{ borderColor: "var(--mk-line)" }}>
          <div className="mx-auto max-w-[1400px] px-6 mk-section text-center sm:px-8 lg:px-12">
            <h2 className="mk-display-sm mx-auto mb-6">Put a meter on your agents.</h2>
            <p
              className="mx-auto mb-10 max-w-[54ch] text-[16px] leading-[24px]"
              style={{ color: "var(--muted-ink)" }}
            >
              Signup is open — start on your own with Get started. For larger fleets, custom limits,
              or self-hosting, send us a note.
            </p>
            <div className="mb-10 flex flex-wrap justify-center gap-3">
              <a href="/sign-up" className="mk-btn mk-btn-primary">
                Get started
              </a>
              <a href="#demo" className="mk-btn mk-btn-secondary">
                See it live
              </a>
            </div>
            <div className="flex justify-center">
              <ContactForm />
            </div>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <footer className="mk-centered mx-auto max-w-[1400px] px-6 py-16 sm:px-8 lg:px-12">
          {/* Four equal columns (was 4 + 2/2/2, which left two empty tracks
              and pulled the whole footer left of centre). */}
          <div className="mx-auto grid max-w-[1080px] grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-3 flex items-center justify-center gap-2.5">
                <TollgateLogo className="size-[19px]" />
                <span className="text-[15px] font-medium" style={{ color: "var(--mk-ink)" }}>
                  Tollgate
                </span>
              </div>
              <p className="mx-auto max-w-[34ch] text-[14px] leading-[20px]" style={{ color: "var(--dim)" }}>
                Kill your agents before they kill your budget.
              </p>
            </div>
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.heading}>
                <h3 className="mb-4 text-[14px] font-medium" style={{ color: "var(--mk-ink)" }}>
                  {col.heading}
                </h3>
                <ul className="flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="text-[14px] transition-colors hover:text-[color:var(--mk-ink)]"
                        style={{ color: "var(--muted-ink)" }}
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div
            className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t pt-6"
            style={{ borderColor: "var(--mk-line)" }}
          >
            <span className="text-[14px]" style={{ color: "var(--faint)" }}>
              Control plane for agent spend
            </span>
            <span className="text-[14px]" style={{ color: "var(--faint)" }}>
              © 2026 Tollgate
            </span>
          </div>
        </footer>
      </ScrollReveal>
    </>
  );
}
