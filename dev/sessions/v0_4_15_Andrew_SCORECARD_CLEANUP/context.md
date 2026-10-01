# Session v0.4.15 — Scorecard cleanup (derived status cards, date-card overlap, email Blocked colour)

**Date:** 2026-10-01 · **Developer:** Andrew · **Status:** in progress
**Branch:** worktree `.claude/worktrees/scorecard-cleanup` on `feat/scorecard-cleanup`, cut from local `main` at `7ed2b79`

Picks up the three items deferred by v0.4.14 (Retire On Hold + Pending).

## Decisions (Andy, 2026-10-01)

- Overdue / Due This Wk: separate group behind a divider; Due This Wk no longer counts overdue items (option "a").
- Meeting prep email: keep the "Your Tasks" code (the email system will be revisited soon); replace the "On Hold" colour key with "Blocked".

## Changes

| File | Change |
|---|---|
| `src/pages/TaskBoard.jsx` | Status scorecards are derived from `STATUS_OPTIONS` (dropdown order, Archive excluded), keys `status-{id}`. Date cards flagged `dateCard`; a vertical divider renders before the first one. `hasOpenDueDate()` shared; Due This Wk requires `dueDate >= now`. |
| `api/meetings/_lib/agenda-email.js` | `STATUS_COLORS`: "On Hold" → "Blocked" (`#fff3e0` / `#e65100`). The tasks section only renders when `tasks` is non-empty; `AgendaDetail.jsx` currently always sends `tasks: []`. |

## Verification

- Page tests (`src/pages/__tests__`): the expand-all test timed out under heavy machine load (load average 25 during a Teams call); one run with only the derived-cards change passed 3/4, the 4th a 20s timeout. Not yet re-run cleanly.

## Deferred

- Agenda page KPI strip / Meeting Focus still use their own 7-day "Due This Wk" window and overlap with Overdue (`src/pages/AgendaDetail.jsx`). Not touched — Task Board only.
