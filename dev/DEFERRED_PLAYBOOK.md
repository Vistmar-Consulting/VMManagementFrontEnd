# Deferred Work Playbook

How to close out the remaining code-review follow-ups (from the 2026-05-27 review). Source of truth for the items themselves: `dev/DEFERRED.md` "Code review follow-ups" section.

This doc is the *strategy* for attacking them — bias, ordering, when to attend yourself vs. delegate to an autonomous session.

## TL;DR

- **One item is URGENT** (do before V2 builds on top): #8 TaskBoard.jsx extraction.
- **Everything else is nice-to-have polish** and can be done any time, in any order.
- **Three items need YOU in the room** (decisions, not code): #17, #25, #27.
- A vitest test for the counter runTransaction is the one piece of test coverage worth writing.

## What landed already (don't re-do)

These are DONE and pushed to `origin/dev`:

| # | Item | Commit |
|---|------|--------|
| Critical 1 | Seed counter clobber | `7e3c2fc` |
| Critical 2 | SI-N per-parent counter | `7e3c2fc` |
| Critical 6 | ID sort by itemNumber | `7e3c2fc` |
| Important 10/14 | writeBatch cascade deletes | `7e3c2fc` |
| Important 13 | dnd lib swap | `7e3c2fc` |
| Important 16 | handleAddItem throws | `7e3c2fc` |
| Important 7 | useCollection dev-warn | `6121aeb` |
| Important 11 | AuthContext Retry button | `199e02e` |
| Important 12 | SignIn timeout cleanup | `91abf33` |
| Minor 15 | categoryId sort by name | `7e3c2fc` (bundled with Critical 6) |
| Minor 18 | tsToDate extraction | `e7e23bd` |
| Minor 19 | STATUS_OPTIONS extraction | `f6a7901` |

## What's still open

### URGENT — before V2 grafts on top

**#8 TaskBoard.jsx extraction.** ~1000 lines of one component. Extract in this order (per reviewer):

1. `useTaskBoardFilters(allItems, subitemsByParent)` custom hook — owns titleSearch / scorecardFilter / columnFilters / orgFilter / hasAnyFilter / visibleSubitemsByParent / filterForceExpandedIds.
2. `<TaskBoardCategoryDialogs />` + `<TaskBoardTagDialogs />` — bundles add/edit + delete-confirm. ~150 lines of JSX.
3. `<TaskBoardScorecards />` + `<TaskBoardOrgFilterChips />` — pure presentational.
4. `useItemMutations()` hook — owns `runTransaction` add-item / add-subitem / handleUpdate / cascading delete. **V2 will call this from the agenda view.**

**Why urgent:** V2 wants to create items from inside meeting agendas. If `useItemMutations()` exists, the agenda view calls it directly. If not, V2 duplicates the create logic, and you end up fixing the duplication later.

**How to attack:** NOT autonomous. Hook shape is a judgment call — you want to be in the room. Open a focused session, work through extractions one at a time, checkpoint after each. Use `superpowers:brainstorming` first to nail the hook signatures before refactoring.

**Launch prompt for that session:**
```
Focused session to extract TaskBoard.jsx (~1000 lines) into composable
pieces before V2 grafts on top.

Working dir: /Users/andrewdeemer/Vistamar_Consulting/VMManagementFrontEnd
Push: origin/dev. Read CLAUDE.md (project + global) first.

See dev/DEFERRED_PLAYBOOK.md "#8 TaskBoard.jsx extraction" section for
the extraction order and rationale. Source file: src/pages/TaskBoard.jsx.

Use superpowers:brainstorming to settle hook signatures BEFORE writing
code. Checkpoint with me after each of the 4 extractions. Atomic commits
per extraction.
```

### Nice-to-have polish (batchable, autonomous-safe)

These are all small, mechanical, and independent. Group them into one autonomous session when you're ready:

- **Recommendation: vitest counter test** — boot Firestore emulator, fire 100 parallel `handleAddItem` calls, assert all `itemNumber`s unique. Guards against silent regressions in the per-org counter. ~30 lines once emulator's up.
- **#20** — `useCallback` wrap `getCommentCount` / `getFileCount` in TaskBoard.jsx so future `React.memo(TaskBoardRow)` works.
- **#21** — note only: consider `React.memo(TaskBoardRow)` when item count grows past ~200. Not actionable today.
- **#22** — expand the `eslint-disable react-hooks/exhaustive-deps` comment in `TaskBoardRow.jsx:104` with what would break.
- **#23** — document the `isDueThisWeek` US-West timezone assumption in a comment, OR convert to `date-fns-tz` with fixed `America/Los_Angeles`. Pick one when you onboard a non-PST team member.
- **#24** — note only: `useItems` returns ALL items; switch to server-side pagination past ~500 items.
- **BG session observation 1+2**: fold raw `statusId === 1` / `=== 2` etc. in `TaskBoard.jsx`'s `SCORECARDS` matchers + sort helpers into `STATUS.*` exports from `constants/itemStatuses.js`. Single coherent pass.
- **BG session observation 3**: dedupe the duplicate React import in `TaskBoardModal.jsx:12-13` (`useEffect, useRef, useState` on one line, `useMemo` on another).

**How to attack:** Autonomous BG session in `--dangerously-skip-permissions` mode or Auto Mode. Same prompt shape as the first BG session — explicit scope list, build-must-pass-before-push gate, HANDOFF doc at the end.

### Items that need YOU in the room (decisions, not code)

These are NOT for autonomous sessions because they require your call on a tradeoff:

- **#17 Mui- prefix convention** — CLAUDE.md says to wrap MUI imports with `Mui`-prefix. Currently only 2 files follow it. Decide: retire the rule from CLAUDE.md (and remove the existing wraps) OR apply consistently across every MUI import in the codebase. Either is fine, but it should be one or the other.
- **#25 KanbanBoard dead route** — `/board/kanban` still routes to `KanbanBoard.jsx`. Decide: kept-for-later alt view (keep with a comment), or dead code (delete file + route entry).
- **#27 Members.jsx + Settings.jsx stubs** — empty pages, no sidebar links. Decide: leave as scaffolding for V1.5 (Members admin per spec §6), or delete now and re-add when needed.

**How to attack:** Tell me your call in a session. Each is a 5-min change after the decision.

## How to know you're "done"

`dev/DEFERRED.md` "Code review follow-ups" section is the checklist. When every item there is either struck through (✓ done) or moved to a higher-level deferral (V2 graft, V3 AI), the review's findings are closed out.

Don't aim for 100% — aim for "nothing structural is left." The Minor items can sit in DEFERRED indefinitely; they're tracking, not blocking.

## Operational reminders

- All work pushes to `origin/dev` (not main). Local stays on `main`.
- Pre-push: `superpowers:requesting-code-review` for non-trivial batches.
- Every push triggers Vercel auto-deploy to https://vm-management-front-end.vercel.app — broken push = broken prod for 5 users.
- `firebase-tools` token expires every ~12 hours; reauth via `! npx firebase login --reauth`.
- The parallel-session conflict pattern from 2026-05-27 worked: scoped launch prompts + explicit "DO NOT TOUCH" file lists + rebase-before-push. Reuse if you ever run two BG sessions at once.
