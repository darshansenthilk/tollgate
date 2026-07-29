import type { Metadata } from "next";
import { StickyNav } from "@/components/marketing/sticky-nav";
import { HeroSection } from "@/components/marketing/hero-section";
import { PillarEnforcement } from "@/components/marketing/pillar-enforcement";
import { PillarControl } from "@/components/marketing/pillar-control";
import { PillarVisibility } from "@/components/marketing/pillar-visibility";
import { TechnicalReadoutSection } from "@/components/marketing/technical-readout-section";
import { LiveDemoSection } from "@/components/marketing/live-demo-section";
import { AccessCtaSection } from "@/components/marketing/access-cta-section";

/**
 * Overrides the root layout's bare `title: "Tollgate"` for the one page that
 * actually gets shared as a link. No `images` yet — the only asset in
 * public/ is logo.svg, and SVG isn't rendered as an OG card by any major
 * platform; a 1200x630 PNG is still needed.
 */
export const metadata: Metadata = {
  title: "Tollgate — Kill your agents before they kill your budget",
  description:
    "Give every AI agent its own token and a hard budget. Tollgate checks each request before it forwards to OpenAI or Anthropic, and freezes any agent instantly — without taking down the rest.",
  openGraph: {
    type: "website",
    siteName: "Tollgate",
    title: "Kill your agents before they kill your budget",
    description:
      "Per-agent tokens and hard budgets, enforced before the request forwards. Freeze one agent without touching the fleet.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kill your agents before they kill your budget",
    description:
      "Per-agent tokens and hard budgets, enforced before the request forwards. Freeze one agent without touching the fleet.",
  },
};

export default function MarketingPage() {
  return (
    <>
      {/* Five content bands + footer, on the reference's own architecture:
          hero → three identical pillar blocks → spec grid → demo → centred
          closing CTA. The former Problem / Mechanism / Capability / Why-now
          split folded into the hero's three supporting lines and the pillars. */}
      <StickyNav />
      <HeroSection />
      <PillarEnforcement />
      <PillarControl />
      <PillarVisibility />
      <TechnicalReadoutSection />
      <LiveDemoSection />
      <AccessCtaSection />
    </>
  );
}
