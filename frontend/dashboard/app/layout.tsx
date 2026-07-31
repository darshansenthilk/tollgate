import type { Metadata } from "next";
import "./globals.css";
import { Geist, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/ui/toast";
import { Toaster } from "@/components/toaster";
import { MainNav } from "@/components/main-nav";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// Space Grotesk → headings/display (--font-heading); JetBrains Mono → mono
// labels (--font-mono). Both are variable-weight, so no `weight` is needed.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Tollgate",
  description: "Spend-control plane for AI agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      // suppressHydrationWarning: the inline script below mutates this
      // element's class (adding/removing "dark") before React hydrates, so
      // the server-rendered className below and the live DOM legitimately
      // disagree by the time hydration runs. That's expected here — it's
      // the standard no-flash-of-wrong-theme technique — not a real
      // hydration bug, so the warning is suppressed rather than fixed.
      suppressHydrationWarning
      className={cn(
        // No "dark" here — the script sets it (or doesn't) before first
        // paint, per the theme the user actually chose. Server-rendered
        // without it so a browser with JS disabled still gets a real
        // (dark, DEFAULT_THEME) page rather than an unstyled one.
        "dark font-sans",
        geist.variable,
        spaceGrotesk.variable,
        jetbrainsMono.variable,
      )}
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- must run
            synchronously, before first paint, to avoid a flash of the wrong
            theme; deferring it defeats the point. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <ToastProvider>
          <MainNav />
          {children}
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
