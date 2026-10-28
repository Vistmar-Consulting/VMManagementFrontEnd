# Session v0.4.19 — + Add subtask under a filter

**Date:** 2026-10-27 · **Developer:** Andrew · **Status:** complete
**Branch:** worktree `.claude/worktrees/fix-add-subtask` on `worktree-fix-add-subtask`, cut from `main` at `c923daf`, rebased onto `origin/dev` at `3773d77` (conflicts with the `itemWrites.js` refactor resolved; the Board Chat AI filter goes through the same matcher and reset). Browser check ran before the rebase; tests re-run after it (7/7 TaskBoard tests)

## Ask

On the Task Board, clicking + Add subtask sometimes did nothing; repeated clicks did nothing; after a refresh there were 4 empty subtasks.

## Root cause

The board filters (scorecard, title search, column filters) were applied to the item just created. A new subtask is untitled, unassigned and Assigned-status, so it matches almost no filter: each click wrote a subtask whose row was filtered out at once. The row never mounted, so the empty-new-subtask discard never ran and the empties stayed. Filters are in-memory state, so a refresh cleared them and the empties appeared. Only happened with a filter on.

## Changes

| File | Change |
|---|---|
| `src/pages/TaskBoard.jsx` | `keptIds`: items created while the current filters are on always match, until the filters change (same rule as the Mini Project Board's `keptIds`). Applied to + Add subtask and + New item. |
| `src/pages/__tests__/TaskBoard.addSubtaskFiltered.test.jsx` | New. Under the In Progress card, + Add subtask shows the new row in title edit; it stays after titling; re-toggling the card re-applies the filter; an untitled one is discarded on blur. |

## Verification

- New test 3/3 (failed before the fix: subtask written, no row). Code review (subagent): no correctness issues. `TaskBoard.expandAll`, `boardGroups`, `boardFilters` pass. One expandAll run timed out at load average ~20; it passed on re-run, and `main` showed the same timing spread (14–57 s).
- Browser (headed agent-browser, dev server on 5173, production data): In Progress card selected, + Add subtask under I-4 Cosmetic Treatment Matcher Tool → SI-9 appeared in title edit; Escape discarded it (row gone).
- ESLint not run: the repo has no ESLint config. `vite build` not run.

## Follow-up: + Add subtask with the Active group collapsed

Root cause: a new subtask is always Active, and `handleAddSubitem` opened the parent's row in the Active group but not the Active group itself. With Active collapsed (e.g. adding from a Done parent in Completed), the new row sat in a hidden section: no title edit, never discarded. Fix: `handleAddSubitem` and `handleAddItem` (+ New item, also Active-status) call `setActiveExpanded(true)`. Two tests added to `TaskBoard.addSubtaskFiltered.test.jsx`; both fail with the fix removed. TaskBoard tests 9/9 (expandAll timed out once under load average ~13–19, passed 4/4 on re-run).

Browser (production data): Active collapsed, Completed open, + Add subtask on a row in Completed → Active opened, Assigned count 143 → 144; Escape discarded it, back to 143.

Leftover from the original bug: SI-5 (untitled) under I-4 Cosmetic Treatment Matcher Tool deleted via the row menu with Andy's approval; no untitled rows remain.

## Deferred

- Mini Project Board also keeps items *edited* under a filter in view (status change out of the selected card); Task Board does not. Not changed — offered to Andy.
