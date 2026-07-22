# NEXT_PROMPT.md

**Purpose:** A ready-to-paste prompt for starting a fresh Claude session on this branch after a context clear, so it resumes from `docs/PLANS.md` instead of re-deriving history from scratch. This file always holds only the *current* prompt — each time a new one is prepared, the block below is overwritten, not appended to.

---

## Prompt to paste after `/clear`

```
Before doing anything else, read docs/COMPLETION.md (what's already been built on this
branch, with file:line references) and docs/PLANS.md (the next task) in this repo.

docs/PLANS.md currently has a "Next task" entry for a filter feature on the agents
dashboard (frontend/dashboard/app/page.tsx). This is documented context only — it was
explicitly NOT started yet and I have NOT given a go-ahead to start it. Do not write any
code for it yet. Instead:
- Summarize back to me what PLANS.md says the next task is (including its open
  questions) so I know you're caught up.
- Wait for my explicit instruction before starting implementation. If I say to start,
  ask me the open questions listed in PLANS.md's "Next task" section first — don't
  assume answers.

Once a feature is actually done and verified, update docs/COMPLETION.md (same format:
problem, what changed, file:line references, how it was verified, date) and reset
docs/PLANS.md's "Next task" section back to "none assigned" or the next thing in line.
```

## Notes
- This file holds only the current resume prompt. Every time you (Claude) prep for a new context clear, overwrite the prompt block above entirely — do not keep or stack prompts from earlier clears.
- The wrapper instructions (read COMPLETION.md + PLANS.md first, don't re-derive context) stay consistent across versions; only the task-specific detail in the middle changes to match whatever PLANS.md currently says.
