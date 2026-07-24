import type { Metadata } from "next";
import "./globals.css";
import { Geist, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/ui/toast";
import { Toaster } from "@/components/toaster";

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
      className={cn(
        "dark font-sans",
        geist.variable,
        spaceGrotesk.variable,
        jetbrainsMono.variable,
      )}
    >
      <body className="min-h-screen antialiased">
        <ToastProvider>
          <nav
            className="flex items-center gap-5 border-b px-6 py-3 text-sm"
            style={{ borderColor: "var(--line)" }}
          >
            <span className="flex items-center gap-2">
              {/* Brand mark — sharp coral square, straight from the template. */}
              <span aria-hidden className="size-2.5 bg-brand" />
              <span
                className="font-mono text-xs uppercase tracking-[0.25em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Tollgate
              </span>
            </span>
            <Link
              href="/"
              className="text-foreground transition-colors hover:text-brand"
            >
              Agent Dashboard
            </Link>
            <Link
              href="/status"
              className="text-muted-foreground transition-colors hover:text-brand"
            >
              System status
            </Link>
          </nav>
          {children}
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
