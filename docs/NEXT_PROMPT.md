# NEXT_PROMPT.md

**Purpose:** A ready-to-paste prompt for starting a fresh Claude session on this branch after a context clear, so it resumes from `docs/PLANS.md` instead of re-deriving history from scratch. This file always holds only the *current* prompt — each time a new one is prepared, the block below is overwritten, not appended to.

---

## Prompt to paste after `/clear`

```
Before doing anything else, read docs/COMPLETION.md (what's already been built on this
branch, with file:line references) and docs/PLANS.md (current status + next task) in this
repo. Don't re-derive the history from git or by reading the whole codebase.

Context: branch Eshaan-2, in sync with origin/main at 77432c6. A long UI session on
2026-07-24 shipped in four commits (selection toolbar, System status overhaul, bracket
animation + table-header hover, and a full dashboard restyle to a reference mock). One
small change is still uncommitted: the "Sort by" select trigger hover highlight in
frontend/dashboard/components/ui/select.tsx, plus its COMPLETION.md entry.

PLANS.md's "Next task" says the next area is Auth, and that it must NOT be started or
planned yet — I'll bring you the requirements myself. So:
- Summarize back to me what PLANS.md says the current status and next task are, so I know
  you're caught up.
- Do NOT research, design, plan, or write any code for Auth. Do not self-assign anything
  from the candidate list in PLANS.md either.
- Then wait for my instructions.

Two working rules that matter here (both learned the hard way, both in PLANS.md/memory):
never edit source files with PowerShell Get-Content | Set-Content (it corrupts non-ASCII
and silently mangled user-visible strings), and the browser tab used for verification is
backgrounded, so :hover and CSS animations can't be observed — verify those structurally
and ask me to eyeball the result.

Once a feature is actually done and verified, update docs/COMPLETION.md (same format:
problem, what changed, file:line references, how it was verified, date) and reset
docs/PLANS.md's "Next task" section.
```

## Notes
- This file holds only the current resume prompt. Every time you (Claude) prep for a new context clear, overwrite the prompt block above entirely — do not keep or stack prompts from earlier clears.
- The wrapper instructions (read COMPLETION.md + PLANS.md first, don't re-derive context) stay consistent across versions; only the task-specific detail in the middle changes to match whatever PLANS.md currently says.
