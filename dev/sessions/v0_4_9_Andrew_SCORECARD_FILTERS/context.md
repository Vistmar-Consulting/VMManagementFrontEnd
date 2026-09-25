# Session: v0.4.9 — Task Board scorecards follow filters

**Developer:** Andrew
**Date opened:** 2026-09-24
**Date closed:** 2026-09-25
**Status:** complete
**Commit start:** `25c6e96`
**Shipped commit:** `e9f9dd1` — `fix(taskboard): scorecards follow filters and count tasks`
**Branch:** worktree `.claude/worktrees/scorecard-filters` on `scorecard-filters` (fast-forwarded into `main`, pushed to `origin/dev`, worktree and branch removed)

---

## What this is

The Task Board scorecards (Assigned, In Progress, Blocked, Review, On Hold, Done,
Overdue, Due This Wk) ignored the column-header filters and title search. Filtering
Assigned to one person left the cards showing board-wide totals.

**Root cause:** `scorecardCounts` in `src/pages/TaskBoard.jsx` was computed from
top-level items narrowed only by the org filter.

## Changes (`src/pages/TaskBoard.jsx`)

| Change | Detail |
|---|---|
| Split the filter predicate | `matchesSearchAndColumns` (title search + column filters) is extracted; `matchesNonOrgFilters` = selected scorecard AND `matchesSearchAndColumns`. Board filtering behaviour is unchanged. |
| Counts respect filters | Cards are counted over items passing the org filter and `matchesSearchAndColumns`. The selected scorecard itself is **not** applied, so selecting one card does not zero the others. |
| Counts are over tasks | `scorecardTasks`: a top-level item with subitems contributes its subitems, not itself; a top-level item with no subitems counts as one task. (Andy, 2026-09-24: "when an item has subitems, only its subitems are supposed to be counted; those are the actual tasks.") |
| Archive excluded | Archived items (statusId 7) are not counted, and neither is anything under an Archived parent. |

## Verification

- `npm run build` passed on the first version of the change (filters only). The
  task-counting version was built by Vercel on deploy (Ready).
- Browser verification by Claude was **not** completed: headless agent-browser
  could not sign in (see Gotchas). Andy tested live on production and confirmed
  the behaviour on 2026-09-25 (unfiltered Assigned 122 / In Progress 92 → Andy-only
  32 / 12).
- No unit test covers the scorecard counting (logic is inline in the component).

## Deploy

- `e9f9dd1` pushed to `origin/dev`, then `vercel deploy --prod`.
- Two Production deployments appeared ~2 minutes apart (`mg3fti7ti`, then
  `ibail7s1y`). The earlier one appears to be a git-triggered deploy from the
  `origin/dev` push (not verified). `management.vistamarconsulting.com` points
  at `ibail7s1y`.

## Gotchas

- A fresh worktree has no `.env.local`; the app renders blank with
  `Firebase: Error (auth/invalid-api-key)` in the module import. Andy symlinks it
  from the main checkout.
- Headless agent-browser with `--profile "Profile 10"` did **not** carry the
  Google or Firebase login on 2026-09-24: the app went to `/signin` and Google
  showed the email-entry page. Firebase auth state is also per-origin
  (`localhost:5180` ≠ `localhost:5173`).

## Deferred

- **Archived-parent exclusion is an assumption.** Subitems under an Archived
  parent are not counted. Pick up if Andy reports open subitems of archived
  parents missing from the cards.
- **No unit test for scorecard counting.** Pick up the next time the scorecards
  change: extract the counting into `src/lib/` and test it.

## Close summary

Shipped and confirmed live by Andy. No work in flight.
