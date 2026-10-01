# Session v0.4.14 — Retire On Hold + Pending; Blocked is the single "stuck" status

**Date:** 2026-09-30 → 2026-10-01 · **Developer:** Andrew · **Status:** complete
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
- Pre-push review: ready to merge, no Critical/Important; stale On Hold text fixed in `AgendaDetail.jsx` comment + `docs/AGENDA_DETAIL_PAGE_REFERENCE.md`.
- Shipped `31ae49f` + docs fix as `4dcd61f` to `origin/dev`; Vercel Production deployment 6771036266 = success.
- Local `main` not yet fast-forwarded (blocked from the worktree session; Andy to run `git merge --ff-only feat/scorecards-statuses` in the main checkout).
- Browser click-through: Andy, after deploy (Claude asked not to drive the browser).

## Data migration (2026-09-30)

- Pending → Blocked: 24 items (id-care 11, golden-vision 6, bryn-mawr 5, vistamar 2) PATCHed `statusId: 9` + `updatedAt` via Firestore REST (gcloud token). Re-query: 0 items left on statusId 6.

- On Hold → Blocked (Andy, 2026-10-01: "On-Hold is dead"): 14 items carry `onHold: true` (13 vistamar, 1 id-care; 11 Assigned, 1 In Progress, 2 Archive). Done 2026-10-01 via Firestore REST: 12 non-archived → `statusId: 9`; the 2 archived keep Archive (moving them would put them back on the board); the `onHold` field deleted from all 382 items. Re-query: 0 items carry `onHold`, 36 Blocked (24 ex-Pending + 12 ex-On Hold).

## AI Gen scorecard (2026-10-01)

AI Gen (statusId 8) added as the first Task Board scorecard, colour `#00bcd4` matching `STATUS_OPTIONS`. Page tests: the expand-all test timed out in the batch run and passes alone (4/4). Build passes.

## Close summary (2026-10-01)

Blocked (9) is the only "stuck" status. On Hold flag and Pending (6) retired in code and data; Sync Meeting proposes Blocked; AI Gen is the first Task Board scorecard. Shipped `31ae49f`, `4dcd61f`, `eb4baf0`, `a025c5c`, `091a22b` to `origin/dev` (Production deploys succeeded); local `main` fast-forwarded. Andy clicks through on the live site. Worktree `scorecards-statuses` removed at close.

## Deferred

- Scorecards: cards are hardcoded instead of derived from `STATUS_OPTIONS`; Overdue / Due This Wk overlap the status cards.
- `api/meetings/_lib/agenda-email.js` `STATUS_COLORS` still has an "On Hold" key, keyed on Hugo-era `Status_Name`; likely dead.
