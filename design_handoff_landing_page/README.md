# Handoff: Tollgate Landing Page

## Overview

A single-page marketing site for Tollgate — the spend-control and credentialing proxy for AI agents. It is optimized to land the whole pitch on a YC reviewer within the first ten seconds: hero → problem → mechanism → capability → technical readout → interactive product demo → why now → waitlist CTA.

The page carries an **interactive replica of the real Agent Dashboard** (a "this is the actual product" demo section) driven by a simulated proxy, so a reviewer can drive the product without an account.

## About the Design Files

The files in `design/` are **design references created in HTML** — a prototype showing intended look and behavior. They are **not production code to copy directly**.

The task is to **recreate this design inside the existing Tollgate codebase** using its established patterns:

- **Framework**: Next.js App Router (as in `frontend/dashboard`)
- **Styling**: Tailwind v4 + the shadcn setup already in `frontend/dashboard/app/globals.css`
- **Components**: reuse `components/ui/*` (Button, Card, Table, Badge, Progress, Checkbox, Select, Dialog, Toast) rather than re-implementing them

Two reasonable placements — pick per your routing preference:
1. A new route group in the existing app, e.g. `frontend/dashboard/app/(marketing)/page.tsx`, moving the dashboard to `/agents`.
2. A separate `frontend/site` Next.js app sharing the token layer.

**Important**: the prototype uses inline styles exclusively (a constraint of the design tool, not a recommendation). In the codebase these should become Tailwind utilities and the existing CSS variables. Nearly every color below already exists as a token in `globals.css` — use the token, not the hex.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, motion, and copy. Recreate pixel-perfectly. Copy is approved — do not rewrite it.

## Design Tokens

### Colors — all but three already exist in `frontend/dashboard/app/globals.css`

| Role | Value | Existing token |
|---|---|---|
| Page background | `#08080a` | `--bg` ✅ |
| Primary text | `#ecebe6` | `--ink` ✅ |
| Brand coral | `#ff4a3d` | `--brand` ✅ |
| Success / allowed | `#46c47f` | `--ok` ✅ |
| Error / blocked | `#ff5c5c` | `--err` ✅ |
| Warning ≥80% budget | `#f0b03a` | `--amber` ✅ |
| Panel (dashboard replica) | `#121011` | `--panel` ✅ |
| Body copy, muted | `#9c9c95` | new — add `--muted-ink` |
| Labels, dim | `#8f8f88` | new — add `--dim` |
| Eyebrow meta, faint | `#5a5a56` | new — add `--faint` |
| Destructive button fill | `#f4645f` | `--destructive` ✅ |

**Do not conflate `--brand` and `--err`.** Per the comment in `globals.css`, coral is brand chrome only; budget/danger state stays on `--ok`/`--amber`/`--err`. The landing page follows this: red-orange for brand and "blocked", green for "forwarded".

### Ambient background (on `body`, `background-attachment: fixed`)

```css
background-color: #08080a;
background-image:
  radial-gradient(46% 38% at 84% 6%, rgba(255,74,61,.16), transparent 62%),
  radial-gradient(44% 40% at 10% 96%, rgba(64,110,190,.13), transparent 62%);
```

The cool blue blob is **new** vs. the dashboard's warm-only glow — it exists so the glass panels have two hues to refract. Keep both.

### The glass panel recipe (used by every card on the page)

```css
background: rgba(255,255,255,.055);
backdrop-filter: blur(18px) saturate(160%);   /* + -webkit- prefix */
border: 1px solid rgba(255,255,255,.11);
border-radius: 16px;
box-shadow: inset 0 1px 0 rgba(255,255,255,.09), 0 12px 36px rgba(0,0,0,.4);
```

Variants: the Mechanism card uses `border-radius: 22px`, `border-color: rgba(255,74,61,.25)`, `box-shadow: inset 0 1px 0 rgba(255,255,255,.09), 0 20px 60px rgba(0,0,0,.45)`. The dashboard card uses `border-radius: 20px`, `blur(20px)`, `border-color: rgba(255,255,255,.13)`.

Worth extracting as a `.glass` utility or a `Card` variant.

### Typography — all three families are already wired in the dashboard's layout

| Role | Family | Size / weight |
|---|---|---|
| Hero H1 | Space Grotesk 600 | `clamp(42px,6.4vw,86px)` / line-height .98 / tracking -.03em |
| Mechanism H2 | Space Grotesk 600 | `clamp(38px,5.6vw,68px)` / lh 1 / -.025em |
| Section H2 | Space Grotesk 600 | `clamp(26px,3.4vw,40px)` / lh 1.05 / -.02em |
| Why-now H2 | Space Grotesk 600 | `clamp(30px,4.6vw,58px)` / lh 1.03 / -.025em |
| Step title | Space Grotesk 600 | `clamp(22px,4vw,28px)` / lh 1.15 |
| Hero subhead | Geist 400 | `clamp(16px,1.9vw,20px)` / lh 1.55 |
| Body | Geist 400 | 15–19px / lh 1.6–1.65 |
| Eyebrow label | JetBrains Mono | 12–13px / letter-spacing .2em / uppercase, wrapped in `[ ]` |
| Technical detail | JetBrains Mono | 10.5–12.5px |

### Layout & spacing

- Content max-width **1200px**; the dashboard replica is capped at **920px** and centered.
- Section padding: `clamp(48px,12vw,80px) clamp(20px,5vw,32px)`.
- Mechanism section (deliberately the largest): `clamp(64px,16vw,132px) … clamp(56px,14vw,128px)`.
- Hairline dividers between sections: `1px solid rgba(255,255,255,.07)`.
- Radii: 8–12px controls, 16–22px panels, 100px pills.

## Screens / Views

One page, nine bands top to bottom.

### 1. Nav (sticky)
`position: sticky; top: 0; z-index: 20`, `background: rgba(18,18,24,.5)`, `backdrop-filter: blur(22px) saturate(160%)`, bottom hairline. Left: gate logo mark + `TOLLGATE` (Space Grotesk 600, 16px, tracking .02em). Right: "Request access" pill → `#access`, mono 12px uppercase, `white-space: nowrap`, glass fill, 12px radius.

### 2. Hero
Two columns (`flex-wrap`, left `flex: 1 1 460px`, right `flex: 1 1 340px; max-width: 420px`), dot-grid background (`radial-gradient(circle at 1px 1px, rgba(255,255,255,.045) 1px, transparent 0)`, `background-size: 26px 26px`).

- Eyebrow: `[ AGENT SPEND CONTROL ]`
- H1: **Budget guardrails and a kill switch for AI agents.**
- Subhead: "AI agents are being handed real spending power — their own API access to OpenAI and Anthropic, acting autonomously, unattended. Nobody's watching the meter."
- Two CTAs: "See it live ↓" (solid `--brand`, dark text) → `#demo`; "Request access" (glass outline) → `#access`
- Right: **telemetry readout** — a glass card framed by four 20px corner brackets in `--brand` (absolutely positioned, 2px borders). Shows `POST /openai/v1/chat/completions`, token/model rows, a budget bar at 60% in `--ok`, and a `FORWARD` verdict (Space Grotesk 20px, `--ok`) with "checked before forward · 3ms". A pulsing `--ok` dot marks LIVE (`@keyframes tg-blink`, 1.6s).
- Below the fold edge: `[ FOR OPENAI & ANTHROPIC API TRAFFIC ]` / `SCROLL ↓` in faint mono.

### 3. Problem
Two columns. Left: eyebrow `[ THE PROBLEM ]`, body paragraph, then H2 "Spend runs away at machine speed. Fixes run at human speed." Right: a mono terminal card showing three `200` responses, `… retry loop ×3,000`, then `spent $3,912` in `--err`, `budget none`, `alert none`.

### 4. Mechanism — **the primary section; keep it visually dominant**
Pill eyebrow `[ THE MECHANISM ]` (coral border + 10% fill, `white-space: nowrap`), 68px H2 "One proxy. The whole spend kill chain.", lead paragraph, then a large coral-tinted glass card containing four rows:

| # | Title | Body |
|---|---|---|
| 01 | Per-agent token & budget | Every agent gets its own token and a hard budget. No shared keys — freezing one never takes down the rest. |
| 02 | Checked before forward | Every request is checked against that budget before it's forwarded. Overspend is prevented, not reported after the fact. |
| 03 | Instant freeze | Freeze any agent from a live dashboard via a Redis fast-path flag. No restart, no propagation delay — the next request is denied. |
| 04 | Metered & logged | Real cost is metered from the upstream usage and written to an audit log. Spend is live from Redis, the same counter enforcement reads. |

Row layout: `flex-wrap` with number `flex: 0 0 auto` (mono 17px coral), title `flex: 1 1 220px`, body `flex: 2 1 260px`; 32px vertical padding; hairline between rows.

### 5. Capability
Two blocks separated by a hairline, each a text column + a visual.

- **`[ TOLLGATE · ENFORCEMENT ]` — "Checked before forward."** with a `+`-prefixed list (per-agent token; hard monthly budget; budget checked before forward; assistant gate — a ChatGPT token can't call Claude). Visual: the **agent → Tollgate → provider** diagram — three glass boxes with `→` separators; the middle box has a coral border, a `check budget → decide` chip, and two outcomes: `● within → 200 forward` (green), `● over → 403 blocked` (coral).
- **`[ TOLLGATE · CONTROL ]` — "Freeze at the speed of a bad loop."** with its own `+` list. Visual: a freeze-event log — `operator: freeze agent-scraper`, `redis flag set ok · 0ms`, `next request 403 agent_frozen`, `no restart · no propagation delay`. This block uses `flex-wrap: wrap-reverse` so the visual leads on desktop but the text leads on mobile.

### 6. Technical readout
`[ TECHNICAL READOUT ]`, H2 "Enforced at the request boundary. Not after the bill.", then a bordered grid (`repeat(auto-fit, minmax(200px,1fr))`) of six label/value cells: Enforcement point → **Pre-forward**; Freeze propagation → **Next request**; Overspend bound → **≤ 1 call**; Budget scope → **Per agent / mo**; Providers → **OpenAI · Anthropic**; Control plane → **Redis fast-path**.

### 7. Live demo — replica of the real Agent Dashboard
See "The demo section" below. This is the largest implementation task.

### 8. Why now
`[ WHY NOW ]`, H2 "Agents evolve fast. Spend control has to be faster.", one paragraph closing on "inevitability, not novelty." (last clause in `--ink`, rest in muted).

### 9. Access CTA + footer
Dot-grid band with `[ REQUEST ACCESS ]`, H2 "Put a meter on your agents.", and an email form (glass input + solid coral submit). Footer: logo + one-liner "Budget guardrails and a kill switch for AI agents.", two link columns (PRODUCT: Mechanism / Live demo / Request access; SUPPORTS: OpenAI / Anthropic), and a bottom hairline row with `CONTROL PLANE FOR AGENT SPEND` / `© 2026 TOLLGATE`.

## The demo section (dashboard replica)

The prototype hand-rolls the dashboard because it had no access to your components. **In the codebase, do the opposite**: render the real `<AgentsPage>` UI against a mock data source rather than duplicating it. Ideal shape — extract the presentational part of `app/page.tsx` into an `<AgentDashboard agents={…} on…={…} />` that both the real page (polling `listAgents()`) and the marketing demo (a client-side simulator) render.

The simulator mirrors `backend/proxy/src/routes/proxy.ts` step for step and should keep doing so:

1. **Freeze gate before budget gate** — a frozen agent returns `403 agent_frozen`; an over-budget agent returns `403 budget_exceeded`; both stop the run.
2. **Cost metering** uses the real price tables from `adapters/openai.ts` (cents per 1M tokens: `gpt-4o` 250/1000, `gpt-4o-mini` 15/60) and `adapters/claude.ts`.
3. **Routes** are the real ones: `/openai/v1/chat/completions`, `/claude/v1/messages`.
4. Each forwarded request writes a **current prompt** (the sidebar's transient Redis value).
5. Crossing under→over budget fires the **"Over budget"** toast, exactly as `page.tsx` does on poll diff.

Seed agents: `checkout-bot` (chatgpt/gpt-4o, 30¢), `research-agent` (claude/sonnet, 200¢, 41¢ spent), `data-scraper` (chatgpt/gpt-4o-mini, 50¢, 46¢ spent → amber), `nightly-backfill` (chatgpt/gpt-4o, 100¢, stopped).

Above the replica sits a dashed **`[ demo feed ]`** strip — agent picker, Start/Stop traffic, and a status readout (`1 req / 0.65s → checkout-bot`). It is explicitly *not* part of the product UI; keep it visually distinct.

**One deliberate deviation from upstream**: the toast viewport is `absolute` within the demo container instead of `fixed` to the viewport, so notifications appear over the dashboard panel rather than floating over the marketing page. Preserve this.

## Interactions & Behavior

### Scroll reveal
Every top-level band has `data-reveal`: starts `opacity: 0; transform: translateY(26px)`, transitions `.8s cubic-bezier(.22,.61,.36,1)` to visible.

Required semantics (the user was specific, and it took several passes):
- Reveals **only when scrolling down** into view.
- An element scrolled **past above stays revealed** — scrolling back up never hides it or replays the animation.
- An element that leaves **below** the viewport re-arms, so scrolling down to it again replays the fade.
- Honors `prefers-reduced-motion: reduce` (everything visible, no transition).

The prototype computes this from `getBoundingClientRect()` on a throttled scroll listener because IntersectionObserver callbacks didn't fire in the preview sandbox. **In the real app, use IntersectionObserver** — just preserve the four rules above (track scroll direction; only add on down-entry; only remove when `rect.top > 0`).

### Waitlist form
Currently client-side only: submitting a non-empty email swaps the form for `✓ On the list. We'll be in touch.` **Needs a real endpoint** — this is the one genuinely unimplemented piece.

### Dashboard demo interactions
Create agent (with one-time token reveal + copy), Select agents → select-all/indeterminate + Stop/Resume/Delete, Edit agent dialog (dirty-gated save), click a row name → prompt sidebar, sort control. All mirror upstream components — reuse them.

## State Management

Marketing page: `email`, `submitted`. Everything else is the demo simulator: `agents[]`, `runningId`, `trafficValue`, `log[]`, `sortKey`, `selectionMode`, `selectedIds[]`, `showCreate`, `newToken`, `copied`, `createForm`, `sidebarAgentId`, `editingAgentId`, `editForm`, `toasts[]`. Interval-driven at 650ms per simulated request; clear it on unmount.

No data fetching on the marketing page — only the (to-be-built) waitlist POST.

## Responsive Behavior

Mobile-friendly without media queries: multi-column bands are `flex-wrap` with `flex: 1 1 <basis>` and `min-width`, the spec grid is `repeat(auto-fit, minmax(200px,1fr))`, padding and type use `clamp()`, and the dashboard table scrolls horizontally (`overflow-x: auto`, `min-width: 640px`) rather than compressing. In Tailwind you'll likely prefer real breakpoints — either is fine as long as nothing overflows at 375px.

## Assets

- **Logo**: the gate mark, from the user's `uploads/logo.svg` — an arched gate silhouette with five vertical bars, clipped to the arch, 18px stroke, recolored to `--brand`. Inlined as SVG in nav and footer (unique `clipPath` ids per instance). The original is at `design/logo.svg`.
- **Fonts**: Space Grotesk, Geist, JetBrains Mono — already loaded by the dashboard app; use `next/font` there rather than the prototype's Google Fonts `<link>`.
- **Icons**: Lucide (`Plus`, `Users`, `Bot`, `Flag`, `Pencil`, `X`) — the prototype hand-inlines these paths; use `lucide-react` in the codebase.
- No photography or illustration. Nothing else to source.

## Still To Do (not designed)

1. Waitlist endpoint + storage.
2. Favicon and OG/Twitter preview image — a reviewer often sees the link before the page.
3. Analytics, if wanted.

## Files

| File | What it is |
|---|---|
| `design/Tollgate.dc.html` | The full landing page prototype — the reference implementation |
| `design/support.js` | Runtime the prototype needs to render; keep beside the HTML to open it locally |
| `design/Tollgate Style Template.dc.html` | Standalone style reference: tokens, type scale, glass recipe, components |
| `design/logo.svg` | Original logo source |

Open `design/Tollgate.dc.html` in a browser to interact with the real thing — including the live demo — before implementing.
