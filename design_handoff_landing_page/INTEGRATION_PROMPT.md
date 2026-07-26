# Integration Prompt — paste this into Claude Code

Copy everything below the line into Claude Code from the root of the `tollgate` repo, with this handoff folder placed at the repo root.

---

I need you to build the Tollgate marketing landing page in this repo.

## What you have

`design_handoff_landing_page/` at the repo root contains:

- `README.md` — the full design spec: tokens, type scale, layout, section-by-section breakdown, interaction rules, and copy. **Read this first and in full.**
- `design/Tollgate.dc.html` — the working HTML prototype. Open it in a browser and interact with it (especially the live demo section) before writing any code. It is the source of truth for look and behavior.
- `design/support.js` — runtime the prototype needs; keep it next to the HTML.
- `design/Tollgate Style Template.dc.html` — condensed style reference.
- `design/logo.svg` — the gate logo mark.

## Ground rules

1. **The HTML is a reference, not code to copy.** Rebuild it as idiomatic Next.js + Tailwind v4 in this repo. Do not paste inline styles — the prototype uses them only because the design tool required it.

2. **Reuse what already exists.** Nearly every color is already a token in `frontend/dashboard/app/globals.css` (`--bg`, `--ink`, `--brand`, `--ok`, `--err`, `--amber`, `--panel`). Use the tokens. Only three new values are needed (muted/dim/faint) — the README lists them. Fonts (Space Grotesk, Geist, JetBrains Mono) are already wired via `next/font`. Icons come from `lucide-react`. UI primitives come from `components/ui/*`.

3. **Do not duplicate the dashboard.** The demo section shows the real Agent Dashboard. Extract the presentational part of `frontend/dashboard/app/page.tsx` into a reusable `<AgentDashboard agents={…} on…={…} />`, then render it two ways:
   - the real page, polling `listAgents()` as it does today (behavior must not change);
   - the marketing demo, driven by a client-side simulator.
   
   The simulator must mirror `backend/proxy/src/routes/proxy.ts` exactly: freeze gate **before** budget gate, real routes (`/openai/v1/chat/completions`, `/claude/v1/messages`), and real cost metering from the price tables in `adapters/openai.ts` and `adapters/claude.ts`. If those tables change later, the demo should change with them — import them rather than hardcoding.

4. **Copy is approved.** Do not rewrite, shorten, or "improve" any user-facing text. Take it verbatim from the prototype.

5. **Preserve two deliberate deviations** documented in the README: the demo's toast viewport is scoped to the dashboard panel (not `fixed` to the viewport), and the ambient background has a second cool-blue blob the dashboard doesn't have.

## Where it goes

Propose a placement before you build. The two sensible options:
- a `(marketing)` route group in the existing app, moving the dashboard to `/agents`; or
- a separate `frontend/site` app sharing the token layer.

Pick whichever fits this repo's conventions better and tell me why.

## Scroll reveal — get these four rules exactly right

Sections fade up (`opacity 0 → 1`, `translateY(26px) → 0`, 800ms `cubic-bezier(.22,.61,.36,1)`):

1. Reveal only when scrolling **down** into view.
2. An element scrolled past **above** stays revealed — scrolling up never hides it or replays it.
3. An element that leaves **below** the viewport re-arms, so scrolling down to it again replays the fade.
4. `prefers-reduced-motion: reduce` → everything visible, no transition.

Use IntersectionObserver. (The prototype uses scroll + `getBoundingClientRect` only because IO didn't fire in its sandbox.)

## The one unbuilt piece

The waitlist form is client-side only — it shows a confirmation but persists nothing. Wire it to a real endpoint (a route handler writing to the existing DB, or Formspree/Tally if you'd rather not own it). Ask me which I want before picking.

## Also missing

Favicon and OG/Twitter preview image. Flag these; don't invent artwork.

## How to work

Start by reading the README and opening the prototype. Then give me a short plan: placement, file structure, which existing components you'll reuse, and how you'll split the dashboard for reuse. Wait for my go-ahead before implementing.

Match the design precisely — this page is aimed at YC reviewers, and the spacing, type scale, and restraint are the point.
