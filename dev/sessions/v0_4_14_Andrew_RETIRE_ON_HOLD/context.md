# Session v0.4.14 — Retire On Hold + Pending; Blocked is the single "stuck" status

**Date:** 2026-09-30 · **Developer:** Andrew · **Status:** in progress
**Branch:** worktree `.claude/worktrees/scorecards-statuses` on `feat/scorecards-statuses`, cut from local `main` at `d27292c`

## Decision (Andy, 2026-09-30)

Too many overlapping "stuck" states. Blocked (9) stays — the Horizon Bridge writes it.
The On Hold flag and the Pending status (6) are retired; their items move to Blocked.

## Findings

- On Hold was an `onHold: boolean` flag. Nothing in the app set it; only `src/seed/portSeed.js` did, from legacy status 3 during the Console port. New items always wrote `onHold: false`.
- Pending (6) was still live: Sync Meeting's AI moved "blocked/waiting" tasks to Pending (`api/ai/_handlers/prepare.js`, `src/lib/itemStatusMap.js`).
- The Task Board scorecards applied `!onHold` to Assigned/In Progress/Blocked but not Review/Done, so an on-hold Review item counted twice. Moot once the flag is gone.

## Changes

| File | Change |
|---|---|
| `src/constants/itemStatuses.js` | Pending removed from `STATUS_OPTIONS`; header comment records the retirement. |
| `src/lib/itemStatusMap.js` | AI move vocabulary: `Pending: 6` → `Blocked: 9`. |
| `api/ai/_handlers/prepare.js`, `refine.js` | Moves target Blocked for blocked/waiting work; stale "In Review/Blocked vs Review/Pending" note rewritten. |
| `src/pages/AIIntegration.jsx` | `HOW_IT_WORKS`: dropped "on-hold" from Project Board input; new "Status moves" row. |
| `src/pages/TaskBoard.jsx` | On Hold scorecard removed; status cards no longer exclude on-hold. |
| `src/pages/AgendaDetail.jsx` | On Hold KPI / Meeting Focus cell and filter → Blocked (status 9). |
| `src/lib/aiAgenda.js` | No "(on hold)" suffix in AI input; no `onHold` on created items. |
| `src/components/MiniProjectBoard.jsx`, `KanbanCard.jsx` | `onHold` writes and badge removed. |

Seed files (`src/seed/`) left untouched — one-shot, not run by the app.

## Verification

- `vite build` passes.
- Full `vitest run`: 180/184; the 4 failures were 5s/20s timeouts under machine load. Re-run alone, those 3 files pass 22/22.
- Browser click-through: Andy, after deploy (Claude asked not to drive the browser).

## Deferred

- **Data migration:** live items with `statusId: 6` (render a blank pill now) and `onHold: true` → Blocked. Counts not yet taken.
- Scorecards: AI Gen (8) has no card; cards are hardcoded instead of derived from `STATUS_OPTIONS`; Overdue / Due This Wk overlap the status cards.
- `api/meetings/_lib/agenda-email.js` `STATUS_COLORS` still has an "On Hold" key, keyed on Hugo-era `Status_Name`; likely dead.
