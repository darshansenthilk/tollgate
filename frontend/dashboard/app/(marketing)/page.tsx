import { StickyNav } from "@/components/marketing/sticky-nav";
import { HeroSection } from "@/components/marketing/hero-section";
import { ProblemSection } from "@/components/marketing/problem-section";
import { MechanismSection } from "@/components/marketing/mechanism-section";
import { CapabilitySection } from "@/components/marketing/capability-section";
import { TechnicalReadoutSection } from "@/components/marketing/technical-readout-section";
import { LiveDemoSection } from "@/components/marketing/live-demo-section";
import { WhyNowSection } from "@/components/marketing/why-now-section";
import { AccessCtaSection } from "@/components/marketing/access-cta-section";

export default function MarketingPage() {
  return (
    <>
      <StickyNav />
      <HeroSection />
      <ProblemSection />
      <MechanismSection />
      <CapabilitySection />
      <TechnicalReadoutSection />
      <LiveDemoSection />
      <WhyNowSection />
      <AccessCtaSection />
    </>
  );
}
