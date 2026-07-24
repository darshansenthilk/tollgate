# PLAN — System status tab UI overhaul + navbar hover fix

> **Status: IMPLEMENTED 2026-07-24** with the recommended defaults (server-rendered,
> `max-w-5xl`, nav link muted-at-rest). Uncommitted on `Eshaan-2`. Full write-up in
> `docs/COMPLETION.md`; the section below is the original plan, kept for reference.

**Status:** Plan only. No code written yet. Scope is frontend-only (the dashboard
workspace); no backend, no `/health` contract changes. Target branch `Eshaan-2`
(uncommitted work already present — see `docs/PLANS.md`). The user merges to `main`
manually; don't push.

**Goal:** Rebuild the `/status` ("System status") page so it reads as the same product
as the Agent Dashboard — same bracketed title idiom, `Card` surfaces, `Badge` status
chips, Space Grotesk / JetBrains Mono type, and warm "industrial glass" tokens — and fix
the navbar so hovering "System status" highlights coral exactly like "Agent Dashboard".

---

## Part 1 — Navbar hover fix (small, do first)

**File:** `frontend/dashboard/app/layout.tsx:57-63`.

**Root cause (confirmed by reading the code):** the "System status" `<Link>` already has
`hover:text-brand`, but it also sets its colour with an **inline `style` attribute**
(`style={{ color: "var(--muted-foreground)" }}`). Inline styles win the CSS cascade over
Tailwind's class-based rules — including the `:hover` variant — so the coral hover never
takes effect. "Agent Dashboard" works because its colour is a *class* (`text-foreground`),
which `hover:text-brand` can override.

**The change:** drop the inline `style` and express the resting colour as a utility class
so the hover class can win:

```tsx
// before
<Link
  href="/status"
  className="transition-colors hover:text-brand"
  style={{ color: "var(--muted-foreground)" }}
>
  System status
</Link>

// after
<Link
  href="/status"
  className="text-muted-foreground transition-colors hover:text-brand"
>
  System status
</Link>
```

`text-muted-foreground` resolves — `--color-muted-foreground` is registered in
`globals.css` `@theme inline` (`:95`) and is already used across `card.tsx`/`dialog.tsx`.

**Notes / options:**
- This keeps "System status" dimmer than "Agent Dashboard" at rest (muted vs foreground),
  matching today's intent; only the *hover* changes. If you'd rather the two links look
  equal at rest, switch it to `text-foreground` like the dashboard link — easy tweak, call
  your preference.
- Optional (out of scope, noted): true active-route awareness (`usePathname()` to mark the
  current tab coral) would require making the nav a client component. Not needed for this
  request.

---

## Part 2 — `/status` page overhaul

**File:** `frontend/dashboard/app/status/page.tsx` (full restyle; keep it a **server
component** — see the open decision on live polling below).

### What's wrong with it today (vs. dashboard conventions)
- Raw `<section>`/`<div>` panels with `--panel`/`--line` inline styles instead of the
  shared `Card` (`components/ui/card.tsx`) the dashboard's "All agents" panel uses.
- Plain `<h1 className="text-3xl font-semibold tracking-tight">` (`:71`) — none of the
  dashboard's bracketed `[ … ]` coral-mono + white→brand gradient + `font-heading` title.
- A duplicate "Tollgate" eyebrow (`:65-70`) — the nav already carries the brand mark.
- `UP / DEGRADED / DOWN` rendered as bare mono text (`:94-99`) rather than a `Badge`.
- Heavy inline `style={{ color: "var(--muted-foreground)" }}` where the dashboard uses
  `text-muted-foreground` / `font-mono` utilities.
- Container `max-w-3xl px-6 py-16` (`:63`) vs dashboard `max-w-5xl px-6 py-12`.

### Target structure

**1. Container** — match the dashboard: `<main className="mx-auto max-w-5xl px-6 py-12">`.

**2. Header — adopt the bracketed title idiom** (copy the pattern from `page.tsx:296-312`):
- Remove the "Tollgate" eyebrow `<p>`.
- Render `[ System status ]`: coral mono brackets (`font-mono text-3xl text-brand`, left one
  `-ml-[6px]`) flanking an `<h1 className="inline-block bg-linear-to-r from-white to-brand
  bg-clip-text font-heading text-[2.34rem] font-semibold tracking-tight text-transparent">
  System status</h1>`.
- Subtitle: keep the overall summary line as a **plain muted line with a small status dot**
  — `<p className="text-sm text-muted-foreground">` with the existing `Dot` + the
  "All services reporting…" / "Degraded — …" copy.
- **Deliberately no big status Badge next to the title.** Coral (brand) and `--err` red are
  close in hue and `globals.css:18-22` mandates they never share a component context; the
  functional UP/DEGRADED/DOWN chips live on the service Cards below, away from the coral
  title. (This mirrors the dashboard, whose coral title also stands alone.)

**3. Service panels → `Card`s.** Replace each `<section>` with a `Card`; the two cards stay
in `grid gap-4 sm:grid-cols-2`:
- `CardHeader` → `CardTitle` = `svc.label` ("Proxy"/"API"); a `HealthBadge` (see below) for
  UP/DEGRADED/DOWN sits in a `CardAction` (top-right, per `card.tsx:59-70`). `CardDescription`
  = `{svc.role} · <span className="font-mono">{svc.url}</span>`.
- `CardContent` → the dependency rows (Redis, Postgres, Uptime). Restyle `DepRow` to use
  `text-muted-foreground`/`font-mono` utility classes instead of inline styles; keep the
  `Dot` (`--ok`/`--err`) and mono latency/detail value. Divider via `divide-y` on
  `border-border`.
- Unreachable branch (`!p.reachable`): show `p.error` in `font-mono text-xs` tinted
  `--err` inside the card.

**4. `HealthBadge` component (new): `frontend/dashboard/components/health-badge.tsx`.**
Mirror `AgentStatusBadge` exactly (its convention: `Badge variant="outline"` + `color-mix`
border/background from a status colour token — `agent-status-badge.tsx:19-33`). Map:

| Probe result                     | Label       | Colour token |
|----------------------------------|-------------|--------------|
| `reachable && report.ok`         | UP          | `--ok`       |
| `reachable && !report.ok`        | DEGRADED    | `--amber`    |
| `!reachable`                     | DOWN        | `--err`      |

Extracting it (rather than inlining) matches the one-badge-per-status-domain precedent set
by `AgentStatusBadge` and keeps coral out of functional status.

**5. Footer / "last checked".** Keep a restrained caption. Since it's server-rendered,
replace "Refresh to re-probe." with a muted line that also surfaces the report `timestamp`
(the newest of the two probes) as a "Last checked …" — reads more finished and uses data we
already fetch. Optional nicety: a `formatUptime()` helper turning `uptimeSec` into
"1h 04m" instead of raw seconds.

### Design constraints to honour (from the design-system memory + `globals.css`)
- **Coral `--brand` stays brand-only** — title/brackets only. UP/DEGRADED/DOWN and the dep
  dots use the functional `--ok` / `--amber` / `--err` trio, never coral.
- Titles use `font-heading` (Space Grotesk); URLs, latencies, uptime use `font-mono`
  (JetBrains Mono); body stays Geist.
- Prefer utility classes (`text-muted-foreground`, `font-mono`, `border-border`) over inline
  `style`. Keep `style={{ color: … }}` **only** for the dynamic status colour (same pattern
  `AgentStatusBadge` uses — acceptable and idiomatic here).

### Files touched (Part 2)
1. `frontend/dashboard/app/status/page.tsx` — restyled (header, Cards, DepRow, footer).
2. `frontend/dashboard/components/health-badge.tsx` — **new**.

---

## Open decisions (my recommendation first)

1. **Server-rendered vs. live polling.** The dashboard's signature is a 3s client poll
   (`page.tsx:177-181`). Matching that here would mean converting `/status` to a client
   component that fetches `/health` from the browser every 3s — which needs **CORS enabled
   on the proxy (:8080) and api (:4000) `/health` endpoints** (today's probes run
   server-side, so CORS is untested from the browser). **Recommendation: keep it
   server-rendered for this overhaul** (pure visual parity, zero backend risk) and treat
   live polling as a separate follow-up with the CORS check as its prerequisite.
2. **Container width.** Recommend `max-w-5xl` to match the dashboard. (Alternative: keep
   `max-w-3xl` if you want the two service cards to feel tighter.)
3. **Resting colour of the two nav links.** Recommend leaving "System status" muted (only
   fix the hover). Alternative: promote it to `text-foreground` so both links match at rest.

None of these block starting; they only fine-tune. I'll go with the recommendations unless
you say otherwise.

## Out of scope / optional follow-ups
- Live 3s polling + a manual "Re-probe" button (needs the CORS work above).
- Active-route coral highlighting in the nav (needs a client-component nav).
- Humanised uptime / high-latency amber threshold on dep rows (nice-to-have polish).

## Verification plan
- `pnpm --filter @tollgate/dashboard typecheck` — clean.
- `pnpm -r test` — unaffected (18/18); no backend touched.
- Browser check on `http://localhost:3000/status` via computed styles (valid in a
  backgrounded tab — no animation involved): cards use `bg-card` + `ring-1 ring-foreground/10`;
  the title is a white→`rgb(255,74,61)` gradient in Space Grotesk between coral `[` `]`;
  UP/DEGRADED/DOWN badges carry the `color-mix` outline in `--ok`/`--amber`/`--err`; URLs and
  latencies render in JetBrains Mono (`document.fonts`).
- **Navbar hover:** verify the inline `style` is gone and the resting class is
  `text-muted-foreground` with `hover:text-brand`. The actual coral-on-hover paint can't be
  reliably triggered/measured in a backgrounded tab (per the `browser-verification-gotchas`
  memory: hidden tab + `:hover`), so this one needs a quick **eyeball** by the user.

## Docs to update once shipped (not now)
- `docs/COMPLETION.md` — new entry (problem / change / file:line / verification / date).
- `docs/PLANS.md` — reflect the shipped work + the uncommitted-files list.
