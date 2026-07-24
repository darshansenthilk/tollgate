import type { Metadata } from "next";
import "./globals.css";
import { Geist, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/ui/toast";
import { Toaster } from "@/components/toaster";
import { MainNav } from "@/components/main-nav";

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
          <MainNav />
          {children}
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
