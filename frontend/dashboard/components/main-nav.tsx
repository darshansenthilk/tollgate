"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { LINKS } from "@/components/nav-links";

/**
 * Top navigation. A client component because the active-route underline needs
 * usePathname() and the right-hand cluster reads the session — layout.tsx stays
 * a server component and just renders this.
 *
 * Colour is set with utility classes, never an inline `style`: an inline style
 * outranks Tailwind's hover variant and silently kills `hover:text-brand`
 * (the bug fixed on 2026-07-24 — see docs/COMPLETION.md).
 */

// Routes that render their own nav (or none at all): sign-in/sign-up
// (unauthenticated), the post-sign-up 2FA opt-in prompt (PLAN.md §5, one-time
// onboarding, not a dashboard page), and the marketing landing page, which has
// its own merged nav (components/marketing/sticky-nav.tsx) instead of this one.
const NO_NAV_ROUTES = new Set(["/sign-in", "/sign-up", "/enroll-2fa", "/"]);

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: sessionData } = authClient.useSession();

  if (NO_NAV_ROUTES.has(pathname)) return null;

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <nav
      className="flex items-center gap-5 border-b px-6 py-3 text-sm"
      style={{ borderColor: "var(--line)" }}
    >
      <Link href="/" className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size
            decorative mark; next/image's overhead isn't worth it here. */}
        <img
          src="/logo.svg"
          alt=""
          aria-hidden
          className="size-5 shrink-0 rounded-sm"
        />
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-foreground/90">
          Tollgate
        </span>
      </Link>
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // -bottom-3 matches the nav's py-3, so the bar lands exactly on
              // the nav's bottom border rather than floating above it.
              "relative transition-colors after:absolute after:inset-x-0 after:-bottom-3 after:h-0.5 after:bg-brand",
              active
                ? "text-foreground"
                : "text-muted-foreground after:hidden hover:text-brand",
            )}
          >
            {link.label}
          </Link>
        );
      })}

      {/* Right cluster: signed-in email + sign out. Colour via classes only, so
          hover:text-brand isn't clobbered by an inline style (see the note
          above). Rendered only once the session has resolved. */}
      {sessionData?.user ? (
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {sessionData.user.email}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-muted-foreground transition-colors hover:text-brand"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </nav>
  );
}
