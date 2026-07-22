# PLANS.md

**Purpose:** Tracks the next task to work on for this branch. A fresh Claude session (after a context clear) should treat the "Next task" section below as its starting instruction, after reading `docs/COMPLETION.md` for history.

---

## Status as of 2026-07-15

Previous feature (Assistant category rename + real Claude adapter + assistant-enforcement gate — see `docs/COMPLETION.md`) is closed and shipped.

A new task has been identified — **a filter feature for agents** — but is documented only, not started. **Do not begin implementation until the user explicitly says to start.** This entry exists purely so the next session has context ready; it is not a green light.

## Next task

**Add a filter feature to the agents list** (the dashboard table at `frontend/dashboard/app/page.tsx`).

What's known:
- The dashboard currently fetches the full agent list via `GET /v1/agents` (`frontend/dashboard/lib/api.ts` → `listAgents()`) and polls it every 3s (`POLL_INTERVAL_MS`, `page.tsx`). No filtering exists today — the table renders every returned agent.
- The table's current columns are Name, Assistant, Status, Spend/budget, Actions — the natural filter dimensions are Assistant (chatgpt/claude) and Status (active/pending/soft_frozen/hard_frozen/archived), possibly a name search too.

Open questions to resolve with the user before writing any code:
1. Which fields should be filterable — Assistant, Status, a name/text search, a spend/budget threshold, some combination?
2. Client-side filtering on the already-fetched array (simplest, matches the current polling model) vs. server-side query params on `GET /v1/agents` (needed only if the agent list is expected to grow large)?
3. UI placement/shape — a toolbar above the table, inline column-header filters, something else?
4. Single-select or multi-select per filter dimension?

**Do not assume answers to the above — ask the user when this task is actually started.**

## Candidate next steps (secondary, not committed, still open from the prior session)

1. **Rename the OpenAI adapter's slug from `openai` to `chatgpt`.** The dashboard's assistant labels/values are `chatgpt`/`claude`, but the proxy's real adapter slugs are `openai`/`claude` — bridged only by the `assistantAdapterSlugs` map (`backend/proxy/src/adapters/registry.ts`). Renaming would make the two vocabularies identical. Bigger/riskier change: touches the live `/openai/*` route path, `backend/proxy/src/adapters/openai.ts`'s `slug` field, the `.env`/`.env.example` var name (`OPENAI_UPSTREAM_KEY` → `CHATGPT_UPSTREAM_KEY`), the `openai-route.test.ts` suite, and `demo/hammer.sh`/`demo/README.md`'s hardcoded `/openai/...` calls.
2. **`DELETE /v1/agents/:id`** is still a `501` stub (`backend/api/src/routes/stubs.ts`) — noted while working in this area, not something introduced by recent work.

## How to use this file

When the user gives a new task, replace the "Next task" section with a concise, concrete description before starting work, then update `docs/COMPLETION.md` once it ships (same format: problem, what changed, file:line references, verification, date).
