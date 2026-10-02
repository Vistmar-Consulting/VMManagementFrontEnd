# Session v0.4.15 — Scorecard cleanup (derived status cards, date-card overlap, email Blocked colour)

**Date:** 2026-10-01 → 2026-10-02 · **Developer:** Andrew · **Status:** complete
**Branch:** worktree `.claude/worktrees/scorecard-cleanup` on `feat/scorecard-cleanup`, cut from local `main` at `7ed2b79`

Picks up the three items deferred by v0.4.14 (Retire On Hold + Pending).

## Decisions (Andy, 2026-10-01)

- Overdue / Due This Wk: separate group behind a divider; Due This Wk no longer counts overdue items (option "a").
- Meeting prep email: keep the "Your Tasks" code (the email system will be revisited soon); replace the "On Hold" colour key with "Blocked".

## Changes

| File | Change |
|---|---|
| `src/pages/TaskBoard.jsx` | Status scorecards are derived from `STATUS_OPTIONS` (dropdown order, Archive excluded), keys `status-{id}`. Date cards flagged `dateCard`; a vertical divider renders before the first one. `hasOpenDueDate()` shared. Both date cards compare against `startOfToday()`: Overdue = due before today; Due This Wk = due today or later this business week. Due dates are stored at local midnight (row DatePicker), so the old `< new Date()` made an item due today Overdue from 00:00 — found in pre-push review. |
| `api/meetings/_lib/agenda-email.js` | `STATUS_COLORS`: "On Hold" → "Blocked" (`#fff3e0` / `#e65100`). The tasks section only renders when `tasks` is non-empty; `AgendaDetail.jsx` currently always sends `tasks: []`. |

## Verification

- `vite build` passes (13 min under load).
- `TaskBoard.expandAll.test.jsx` with `--testTimeout=60000`: this branch 4/4 pass. Baseline (`main`'s `TaskBoard.jsx`, same load) 3/4 — the scorecard test times out. Earlier failures on this branch were the same load timeouts (load average 17–25 during a Teams call).

## Close summary (2026-10-02)

Shipped `fd25117` + `835b28a` to `origin/dev`; Vercel Production deployment 6796316568 = success; local `main` fast-forwarded. Rebase onto `dev` conflicted in `SESSION_INDEX.json` with the parallel topic-collapse session (also numbered v0.4.15); both entries kept. Worktree `scorecard-cleanup` removed at close.

## Deferred

- Agenda page KPI strip / Meeting Focus still use their own 7-day "Due This Wk" window and overlap with Overdue (`src/pages/AgendaDetail.jsx`). Not touched — Task Board only.
