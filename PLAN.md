# PLAN.md

Status: **IMPLEMENTED, PENDING YOUR MANUAL SIGNED-IN CHECK.** The plan below for consolidating the
landing page's two navbars into one has been carried out (see "File-by-file changes" — all three
edits applied as written, defaults D1–D4 taken as-is). `tsc --noEmit` passes clean. Verified via
`curl` against the already-running dev server: signed-out `/` renders exactly one `<nav>` (logo+
"Tollgate" linked to `/`, far right only "Sign in", no "Request access" anywhere in the nav); `/sign-in`
and `/sign-up` still render zero nav elements; `/agents` unauthenticated still 307s to `/sign-in`
(middleware untouched). **Not yet verified:** the signed-in branch (Agent Dashboard / System status /
Settings / Sign Out, and the sign-out click) — `StickyNav` is a client component that always
server-renders the signed-out branch first and only swaps in the signed-in view after browser
hydration, so `curl` can't see it; no browser-automation tool is installed in this environment and the
user opted to check this themselves in their own browser at `http://localhost:3000` rather than have
Playwright/Chromium installed. Nothing has been committed.

> **The previous plan here (TOTP Two-Factor Authentication, Layer 2) is fully shipped and merged.**
> Implemented 2026-07-25, revised to opt-in 2026-07-26, merged into `main` the same day (commit
> `f64ca94`, via the `Eshaan-2` branch), verified end-to-end for both a fresh account and the
> pre-existing real account (`eshaan.joshi07@gmail.com`). Full record: `docs/COMPLETION.md` (three
> dated entries) and `docs/AUTH-IMPLEMENTATION.md`. Layer 3 (step-up re-auth) remains an unplanned
> recommendation in `docs/AUTH-PLAN.md` §4.

---

## Active plan: one navbar on the landing page

This is the first concretely-scoped slice of the broader "connect the landing page with the rest of
the web app" effort named previously (see the tail of this file for what's still unscoped in that
larger effort — this plan does **not** cover the signup CTA flow or shared chrome beyond the nav).

### Current state — the two navbars today

**Navbar A — `components/main-nav.tsx`, mounted globally.** `app/layout.tsx` renders `<MainNav />` in
the root layout, above `{children}`, on *every* route except `NO_NAV_ROUTES = {"/sign-in", "/sign-up",
"/enroll-2fa"}` (main-nav.tsx:27). `"/"` is not in that set, so it renders on the landing page today —
visually the topmost element on the page, above everything else including Navbar B. Contents:
- Far left: `<img src="/logo.svg">` (`size-5 shrink-0 rounded-sm`) + "Tollgate" text
  (`font-mono text-xs uppercase tracking-[0.25em]`).
- Middle-left: `LINKS` (`Agent Dashboard` → `/agents`, `System status` → `/status`, `Settings` →
  `/settings`), always rendered regardless of session — harmless on the dashboard routes (middleware
  already gates them, so you can't view them signed out) but visible-but-broken on the public landing
  page.
- Far right: signed-in email + "Sign out" button, rendered only when `sessionData.user` exists; renders
  nothing at all when signed out (no sign-in affordance).

**Navbar B — `components/marketing/sticky-nav.tsx`, rendered inside the page.** `app/(marketing)/page.tsx`
renders `<StickyNav />` as its first child (page.tsx:14) — i.e. inside the page content, sitting just
below Navbar A visually. Contents:
- Far left: `TollgateLogo` (hand-inlined SVG component, `size-5`) + "TOLLGATE" text
  (`font-heading text-base font-semibold tracking-[0.02em]`).
- Far right, signed out: "Sign in" (plain link, `font-mono text-xs uppercase`, `var(--muted-ink)`) +
  "Request access" (`href="#access"`, glass-button style).
- Far right, signed in: single "Agent Dashboard" glass-button CTA linking to `/agents`.

`middleware.ts` confirms `"/"` is in `PUBLIC_ROUTES` — no redirect either direction regardless of
session state — which is exactly why both navbars' signed-in/signed-out branches can both appear
stacked on the landing page today.

`TollgateLogo` (`components/marketing/tollgate-logo.tsx`) is also used by
`components/marketing/access-cta-section.tsx:44` (the page's bottom CTA section) — it stays; only
`sticky-nav.tsx` stops importing it.

### Target state

Keep **Navbar B (`StickyNav`)** as the base — it already sits first in the page content and already
carries the sticky/blur/border container styling that's supposed to survive. Hide **Navbar A
(`MainNav`)** on `"/"` so the landing page never mounts it. The merged nav is Navbar B with:

- **Logo:** swap `TollgateLogo` (SVG component) for Navbar A's `<img src="/logo.svg">` markup — per
  the prompt, only the graphic mark comes from the "higher" navbar; the "Tollgate" text label next to
  it keeps Navbar B's existing text/font (`font-heading text-base font-semibold tracking-[0.02em]`),
  since everything else is inherited from the landing-page navbar's styling.
- **Positioning:** stays the far-left flex child, as both navbars already do this — no structural
  change needed here beyond the swap above.
- **Logo click-through (new behavior, neither navbar does this today):** wrap the logo+"Tollgate"
  lockup in a link to `"/"`, so clicking the word "Tollgate" returns to the landing page.
- **Signed out, far right:** only "Sign in" remains (delete "Request access" entirely). Removing its
  sibling makes it the rightmost element automatically — no other styling change to it.
- **Signed in, far right:** `Agent Dashboard`, `System status`, `Settings` (same hrefs/labels/order as
  Navbar A's `LINKS`) rendered with Navbar B's existing link styling (`font-mono text-xs uppercase
  tracking-[0.12em]`, `var(--muted-ink)`, `hover:text-brand`) — i.e. today's "Sign in" treatment, not
  the old lone glass-button CTA, since these are now three peers rather than one action — followed by
  **"Sign Out"** as the final, rightmost element. Sign-out handler: `authClient.signOut()` then
  `router.refresh()`, staying on `"/"` (no redirect needed — `"/"` is public either way, unlike Navbar
  A's sign-out which must push to `/sign-in` because its host pages require auth).

### File-by-file changes

1. **`components/main-nav.tsx`** — add `"/"` to `NO_NAV_ROUTES`; update the comment above the set to
   note the marketing page now has its own merged nav instead of relying on this one.
2. **`components/marketing/sticky-nav.tsx`**
   - Remove the `TollgateLogo` import; replace the logo element with Navbar A's `<img src="/logo.svg"
     ... />` markup, kept inside the existing left-hand flex div next to the "TOLLGATE" text.
   - Wrap the logo+text lockup in `<a href="/">` (matching this file's existing plain-`<a>` convention
     for its own links, rather than introducing `next/link`'s `<Link>`, which only Navbar A currently
     uses).
   - Import the shared `LINKS` constant (see #3) instead of hand-writing the three links again.
   - Signed-out branch: drop the "Request access" anchor; keep "Sign in" as-is.
   - Signed-in branch: map `LINKS` with this file's existing link classes, then render a "Sign Out"
     button (`authClient.signOut()` + `router.refresh()`) as the last element — needs a `useRouter`
     import from `next/navigation`, not currently imported in this file.
3. **`components/nav-links.ts` (new)** — export the `{href, label}[]` array currently inlined in
   `main-nav.tsx` (`LINKS`), so both `main-nav.tsx` and `sticky-nav.tsx` import the same data instead
   of maintaining two literal copies of an identical 3-item list.
4. **No changes** to `middleware.ts`, `app/layout.tsx`, `app/(marketing)/layout.tsx`,
   `app/(marketing)/page.tsx`, `access-cta-section.tsx`, or `tollgate-logo.tsx`.

### Defaults assumed while planning (flag if you want any of these different)

- **D1:** Keep the existing "System status" label casing (lowercase "s", matching current `LINKS`)
  rather than "System Status" as capitalized in your prompt — a pure casing question, one-line change
  either way if you want it capitalized.
- **D2:** The three dashboard links, when signed in, get the plain uppercase nav-link treatment (like
  today's "Sign in"), not the glass-button CTA look "Agent Dashboard" currently has alone — since
  they're now three peers, not one highlighted action. Say so if you'd rather keep a button look for
  one or all of them.
- **D3:** Sign Out on the landing page nav stays on `"/"` (refresh only, no redirect), since `"/"` is
  public and remains valid post-sign-out — unlike Navbar A's sign-out elsewhere, which must leave
  auth-gated pages.
- **D4:** The logo/"Tollgate" home link uses a plain `<a href="/">`, matching this file's existing
  anchor-based links, rather than `next/link`'s `<Link>` — a style-consistency call scoped to this one
  file, not a statement about which is "correct" generally.

### Verification plan (once implemented — do not skip, per this project's UI-change convention)

- Dev server, load `"/"` signed out: exactly one navbar; far-left logo+"Tollgate" (links to `"/"`);
  far-right shows only "Sign in"; "Request access" gone from the nav (its `#access` section further
  down the page is untouched).
- Sign in, return to `"/"`: nav now shows `Agent Dashboard` / `System status` / `Settings` / `Sign Out`
  (far right); still exactly one navbar.
- Click each of the three links from the landing page while signed in → lands on `/agents`, `/status`,
  `/settings` respectively; those pages still show Navbar A (`MainNav`), unaffected by this change.
- Click "Sign Out" from the landing-page nav → session clears, nav reverts to signed-out state, still
  on `"/"`.
- Confirm `/agents`, `/status`, `/settings`, `/sign-in`, `/sign-up`, `/enroll-2fa` are unaffected —
  `MainNav` still renders correctly on the dashboard routes and stays hidden on the three no-nav
  routes.

### Explicitly not in scope for this plan

- The `#access` section's own content/CTA — only its nav-bar entry point is removed.
- Any change to `MainNav`'s behavior/styling on the authenticated dashboard pages.
- Renaming the `StickyNav` component/file — it stays the landing page's one nav, name unchanged.

---

## Broader landing-page-integration context (still open, not part of the plan above)

- No designed flow yet from "read the pitch" → sign up → land in the dashboard beyond the nav itself;
  the access-CTA section's own conversion path is still unscoped.
- **Gotcha already hit once, worth remembering if this touches auth-adjacent code again:** when `"/"`
  stopped being the dashboard, several client-side `router.push("/")` / `router.replace("/")` calls
  elsewhere weren't updated and silently sent freshly authenticated users to the marketing page instead
  of `/agents` (fixed 2026-07-26, see `docs/COMPLETION.md`). Any code this nav work touches should keep
  targeting `/agents` explicitly where "the app" is meant, never assume `"/"` means that.
- No live-browser verification of the 2FA UI has happened yet (opt-in prompt, QR rendering, enrollment/
  challenge screens, backup-codes modal, Settings) — everything checked so far by reading code plus
  API-level `curl`/DB passes. See `docs/AUTH-IMPLEMENTATION.md`'s verification note. Unrelated to this
  nav plan but still outstanding.
- Nobody has signed in as the real `eshaan.joshi07@gmail.com` account since the merge with a live TOTP
  code — still needs the user to do it themselves.
- Layer 3 (step-up re-auth on sensitive agent-control actions) remains unplanned, per
  `docs/AUTH-PLAN.md` §4.
