# PLAN — Dashboard UI to match the reference mock

> **Status: IMPLEMENTED 2026-07-24** with the recommended defaults (neutral "Done", shared
> `TableHead` change, pulsing live dot; `/status` card treatment deferred as a follow-up).
> Uncommitted on `Eshaan-2`. Full write-up in `docs/COMPLETION.md`; the plan below is kept
> for reference.

**Status:** Plan only. No code written yet. Scope: frontend (dashboard workspace) only —
no backend, no data/API changes. Branch `Eshaan-2` (uncommitted work already present).
The user merges to `main` manually.

**Source of truth:** the reference image at
`c:\Users\Eshaan\Downloads\1b80d822-7491-49a1-86ef-07983382020c.png`.

> **Hard constraint from the user: keep the CURRENT size scale.** The mock is rendered at a
> much larger zoom. Adopt its *visual design* (colour, shape, iconography, structure) but
> **not** its absolute dimensions. Every existing size token stays: title `text-[2.34rem]`,
> container `max-w-5xl px-6 py-12`, nav `py-3 text-sm`, buttons `h-8` (`size-7` icon),
> table `text-sm`, badges `h-5`. Where the mock implies a new element (icon tiles, avatars),
> size it to the current scale — small — not to the mock's pixel size.
>
> The previous PLAN.md (System status overhaul + navbar hover) was **implemented**; its
> record lives in `docs/COMPLETION.md`. This file now tracks the new work.

---

## Delta summary (mock vs. what's on screen today)

| # | Area | Today | Mock |
|---|---|---|---|
| 1 | Nav active tab | no indicator | coral **underline** under the active link; label white |
| 2 | Nav wordmark | muted grey | brighter, still mono/letter-spaced |
| 3 | Create agent | solid coral button | **outlined** coral pill, tinted fill, **`+` icon** |
| 4 | Select agents | solid amber button | **outlined** amber pill, tinted fill, **users icon** |
| 5 | Card top edge | plain border | **coral gradient hairline** fading at both ends |
| 6 | Card header | text only | **icon tile** (coral-tinted rounded square + users icon) |
| 7 | Card description | "Polling every 3s" | + small **green live dot** |
| 8 | Table headers | `Name`, `Assistant` … | **UPPERCASE**, letter-spaced, muted |
| 9 | Name cell | bare text | **robot avatar tile** + bold name |
| 10 | Status badge | coloured pill | pill **with a leading dot** |
| 11 | Spend / budget | amount + % on one line, bar below | amount on top; **bar and % side by side** below |
| 12 | Edit action | bare ghost pen | pen in a **bordered square** (outline) |
| 13 | Table | bare inside card | wrapped in a **rounded bordered container** |

Everything else (palette, fonts, ambient coral glow, bracketed title, layout rhythm) already
matches — those came from Feature 8 and this session's work.

---

## Part 1 — Navbar active-tab indicator

**Problem:** the mock shows the current route underlined in coral with a white label. Today
neither link knows which route is active. `app/layout.tsx` is a **server component**, and
`usePathname()` requires a client component.

**Approach:** extract the nav into `frontend/dashboard/components/main-nav.tsx` (new,
`"use client"`), and have `layout.tsx` render `<MainNav />`. Keeps the layout itself a server
component — only the nav becomes client, which is the minimal boundary.

- Links defined as a small array (`{ href, label }`) so the active test is one comparison:
  `pathname === href`.
- Active link: `text-foreground` + a coral underline via a pseudo-element —
  `relative after:absolute after:inset-x-0 after:-bottom-3 after:h-0.5 after:bg-brand`.
  `-bottom-3` equals the nav's `py-3`, so the bar lands exactly on the nav's bottom border.
- Inactive link: keeps today's `text-muted-foreground … hover:text-brand` (the hover fix from
  the last change — **do not reintroduce an inline `style`**, it breaks the hover; see
  `docs/COMPLETION.md`).
- Wordmark: bump "TOLLGATE" from `text-muted-foreground` to a brighter tone (mock reads
  near-white); keep `font-mono text-xs uppercase tracking-[0.25em]` and the coral square.
- Accessibility: add `aria-current="page"` to the active link.

**Files:** `components/main-nav.tsx` (new), `app/layout.tsx` (render it, drop the inline nav).

## Part 2 — Header action buttons

The mock's two buttons are **outlined, tinted pills with icons**, not solid fills.

- `components/ui/button.tsx` — add two variants beside the existing `amber`, following the
  same construction (token-driven, works in both themes):
  - `brandOutline` — coral text, `border-[var(--brand)]/45`, background
    `color-mix(in oklch, var(--brand) 12%, transparent)`, hover raises the mix.
  - `amberOutline` — the same shape on `--amber`.
  Reusing `color-mix` matches the precedent already set by `AgentStatusBadge` / `HealthBadge`.
- `components/create-agent-dialog.tsx:134` — trigger becomes
  `<DialogTrigger render={<Button variant="brandOutline" />}><Plus />Create agent</DialogTrigger>`.
  The base button already sizes bare `svg` children (`[&_svg:not([class*='size-'])]:size-4`)
  and has `gap-1.5`, so no extra layout work.
- `app/page.tsx` — "Select agents" becomes `variant="amberOutline"` with a `<Users />` icon.
- **Decision needed (see Open questions):** what the toggled **"Done"** state looks like.
  Recommendation: keep `variant="outline"` (neutral) so "armed" vs "done" stays legible.

**Note on the brand rule:** coral here is *brand chrome* (a primary CTA), which
`globals.css` explicitly allows — it is not being used for functional status. Amber on
"Select agents" is likewise a mode affordance, not a budget signal. No conflict with the
palette rule.

## Part 3 — Card treatment

**`app/page.tsx`, the "All agents" `<Card>`:**

- **Coral top-edge hairline.** Add `className="relative"` to the `Card` (it already has
  `overflow-hidden`) and render a first child:
  `<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-brand to-transparent" />`.
  Note Tailwind v4 uses `bg-linear-*` (not `bg-gradient-*`) — same gotcha already recorded for
  the title gradient.
- **Header icon tile.** Wrap `CardHeader`'s content so a tile sits left of the title:
  a `size-9` (current scale — *not* the mock's ~48px) `rounded-lg` box, coral-tinted
  background + border via `color-mix`, holding a `<Users className="size-4" />` in coral.
  `CardHeader` is a grid with `gap-1`, so the cleanest structure is a `flex items-center gap-3`
  wrapper containing the tile and a `div` with `CardTitle` + `CardDescription`.
- **Live dot.** `CardDescription` becomes `Polling every 3s` + a `size-1.5 rounded-full`
  dot on `--ok`. Optional `animate-pulse` (built-in) with `motion-reduce:animate-none`.

## Part 4 — Table

All in `app/page.tsx` unless noted.

- **Bordered container.** Wrap `<Table>` in
  `<div className="overflow-hidden rounded-lg border">` so it reads as a panel like the mock.
- **Uppercase headers.** Apply `uppercase tracking-wider text-xs text-muted-foreground` to the
  header cells — **via CSS, keeping the source strings sentence-case** ("Name", "Assistant"),
  so the markup stays readable. Cleanest single point: add those classes to `TableHead` in
  `components/ui/table.tsx` (it already sets `text-foreground`; swap to muted), which also
  keeps future tables consistent. *Alternative if we don't want to touch the shared primitive:
  pass the classes on each `TableHead` in `page.tsx`.* Recommend the shared change.
- **Row avatar.** In the Name cell, prepend a `size-7` `rounded-md` coral-tinted tile holding
  `<Bot className="size-3.5" />`, then the existing name span (keep the over-budget `Flag`).
  The cell already has `onClick` → sidebar; the tile inherits that, which is fine.
- **Status badge dot.** `components/agent-status-badge.tsx` — prepend a
  `size-1.5 rounded-full` span using the same `color` the badge already computes, so all five
  statuses get a matching dot for free. No new props.
- **Spend / budget restructure.** Today: amount + `%` share the top line, bar spans below.
  Mock: amount on top; below it a **row** of `[bar (flex-1)] [%]`. Rework that cell to
  `flex flex-col gap-1` → amount line, then `flex items-center gap-2` → `<Progress className="flex-1">`
  + the `%` span (keep the existing green/amber/red colour logic and `tabular-nums`).
- **Edit button.** Change from `variant="ghost"` (with the transparent-hover override) to
  `variant="outline"` at `size="icon-sm"`, so it reads as the mock's bordered square. Keep the
  `Pencil` at `size-3.5` `strokeWidth={1.75}` and the `group-hover/button:animate-pen-shake`.

**Untouched:** the checkbox/selection column, its width animation, the selection toolbar, the
sort control, polling, and every data path. The mock shows the default (non-selection) state,
so nothing there conflicts.

---

## Files touched

| File | Change |
|---|---|
| `components/main-nav.tsx` | **new** — client nav with active-route underline |
| `app/layout.tsx` | render `<MainNav />`; remove inline nav |
| `components/ui/button.tsx` | add `brandOutline` + `amberOutline` variants |
| `components/create-agent-dialog.tsx` | trigger → new variant + `Plus` icon |
| `components/agent-status-badge.tsx` | leading status dot |
| `components/ui/table.tsx` | `TableHead` → uppercase/tracked/muted |
| `app/page.tsx` | buttons, card glow + icon tile + live dot, table container, row avatars, spend cell, edit button |

Icons confirmed present in the installed `lucide-react@1.23`: `Bot`, `Plus`, `Users`,
`UsersRound`, `Pencil`, `Flag`, `ChevronDown`. No new dependency.

## Open questions (recommendation first)

1. **"Done" button (selection mode).** Recommend neutral `variant="outline"`, so the amber
   tinted pill clearly means "not yet in selection mode". Alternative: keep it amber-tinted.
2. **`TableHead` uppercase — shared primitive or call site?** Recommend the shared
   `components/ui/table.tsx` change (one place, consistent for future tables). Say so if you'd
   rather leave the vendored primitive untouched.
3. **System status page.** The nav change lands there automatically. Should `/status` also get
   the card top-glow + icon-tile treatment for consistency? Recommend **yes, as a small
   follow-up after this lands**, so this change stays reviewable.
4. **Live dot animation.** Recommend a subtle `animate-pulse` on the green dot
   (`motion-reduce:animate-none`). Say if you want it static.

None of these block starting; I'll take the recommendations unless told otherwise.

## Verification plan

- `pnpm --filter @tollgate/dashboard typecheck` clean; `pnpm -r test` unaffected (18/18).
- Computed-style checks on `:3000` (valid in a backgrounded tab): button borders/fills resolve
  to the coral/amber `color-mix` values; the card's top hairline element exists and is a
  gradient; header cells compute `text-transform: uppercase`; the spend cell's bar and `%` share
  a row (same `top`, `%` to the right); the edit button has a visible border; the active nav
  link carries `aria-current="page"` and its `::after` is coral.
- **Needs an eyeball** (a backgrounded tab can't be trusted for these, per the
  `browser-verification-gotchas` memory): overall fidelity to the mock, `:hover` states, and the
  pulse/pen animations.
- Compare against the reference image side by side before calling it done.

## Docs to update once shipped
- `docs/COMPLETION.md` — new entry (problem / change / file:line / verification / date).
- `docs/PLANS.md` — status + uncommitted-file list.
