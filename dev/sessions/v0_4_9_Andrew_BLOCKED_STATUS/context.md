# Session: v0.4.9 — Blocked status (9) on the Task Board

**Developer:** Andrew
**Date opened:** 2026-09-18
**Status:** in progress
**Commit start:** `404aac1`
**Branch:** worktree `.claude/worktrees/blocked-status` on `feat/blocked-status`, cut from local `main`

---

## What this is

The Horizon Bridge writes tickets with `statusId: 9` ("Blocked"). The Management
app had no definition for 9, so those items rendered as a grey "—" pill, never
appeared on the Kanban, were absent from the scorecards and the status filter,
and could not be set back to 9 once someone changed the pill. This adds 9 as a
first-class status across the board surface.

Source of the decision: `BRIDGE-TICKETS-DESIGN-2026-09-18.md` (Claude_DB_Roadmap,
branch `horizon-tickets`) — "**Blocked status:** new `statusId: 9`, 'Blocked'. AD
adds it to the Management front end's `STATUS_OPTIONS`."

## Changes

| File | Change |
|---|---|
| `src/constants/itemStatuses.js` | `BLOCKED: 9` added to `STATUS`; entries added to `BOARD_COLUMNS`, `STATUS_LABEL` and `STATUS_OPTIONS`. Header comment rewritten. |
| `src/pages/KanbanBoard.jsx` | `gridTemplateColumns` was hardcoded `repeat(4, …)`; now derives from `BOARD_COLUMNS.length`. |
| `src/pages/TaskBoard.jsx` | `SCORECARDS` gained a Blocked card. This array is hardcoded and does not read the constants. |

**Placement:** Blocked sits after In Progress everywhere, and after Pending in
the dropdown (the only surface where Pending appears). Colour `#e65100`, matching
the existing `blocked` tag in `src/seed/archiveData.js`.

**Free of charge** — these derive from `STATUS_OPTIONS` and needed no edit: the
status filter chips (`TaskBoard.jsx`), `TaskBoardRow`, `ProposedBoardRow`,
`SyncMeetingDialog`, `lib/aiAgenda.js`.

**`lib/boardGroups.js` deliberately untouched.** `groupKeyOf` returns `"active"`
for anything that isn't Done or Archive, so Blocked items land in the Active
group, which is correct — blocked work is still open work.

## Two facts worth carrying forward

- **`pm.Statuses` has only 8 rows. There is no 9.** Blocked exists solely in
  Firestore and in the Bridge design. The old header comment claiming status IDs
  are "ported verbatim" from SQL stopped being true with this change, so it now
  says so explicitly. If that table is ever migrated forward, add 9 to it.
- **Pending (6) is a legacy artefact.** In SQL it carries `Sort_Order 0`, so it
  sorted ahead of Assigned, and every AI-generated item in `src/seed/archiveData.js`
  carries `Status_Id: 6` under the comment "AI-CREATED (Pending status …)". It was
  the intake state for machine-suggested tasks; **AI Gen (8) replaced that role in
  V1.** Pending is now redundant and is kept only so historical items can be moved
  off it. Retiring it is a separate decision, not taken here.

## Verification

| Check | Result |
|---|---|
| `npx vite build` | ✅ Passed. 13,958 modules, built in 1m 2s. `dist/` removed afterwards. |
| `npx vitest run` | ⚠️ 131 tests passed, 14 of 15 files passed. `src/lib/__tests__/orgMembers.test.js` fails on `FirebaseError: auth/invalid-api-key` at `src/firebase.js:16`. **Environmental, not caused by this change** — the worktree has no `.env.local` (the main checkout does), and that test file contains zero references to statuses. |
| `npm run lint` | ❌ Not run. There is **no ESLint config anywhere in the repo**, so the `lint` script fails identically on `main`. Pre-existing, unrelated. |
| Rendered board | ❌ Not verified. The five-column Kanban layout needs a human look. |

## What's NOT done

- ❌ Not committed, not pushed, not merged to `origin/dev`.
- ❌ The five-column Kanban has not been seen rendered. The grid now derives its
  column count, but nothing confirms it reads well at `md` width.
- ❌ No test covers the status constants. Nothing asserts that `BOARD_COLUMNS`,
  `STATUS_LABEL` and `STATUS_OPTIONS` stay in sync, which is what allowed 9 to be
  half-present in the first place.
- ❌ `pm.Statuses` was not given a row for 9. Firestore-only by design, recorded
  here so it is a decision rather than an oversight.
- ❌ Pending (6) not retired.
