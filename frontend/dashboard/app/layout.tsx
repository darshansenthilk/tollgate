import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/ui/toast";
import { Toaster } from "@/components/toaster";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

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
    <html lang="en" className={cn("dark font-sans", geist.variable)}>
      <body className="min-h-screen antialiased">
        <ToastProvider>
          <nav
            className="flex items-center gap-5 border-b px-6 py-3 text-sm"
            style={{ borderColor: "var(--line)" }}
          >
            <span
              className="font-mono text-xs uppercase tracking-[0.25em]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Tollgate
            </span>
            <Link href="/" className="text-foreground hover:opacity-80">
              Agents
            </Link>
            <Link
              href="/status"
              className="hover:opacity-80"
              style={{ color: "var(--muted-foreground)" }}
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
