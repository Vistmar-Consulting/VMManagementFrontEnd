# Session v0.4.13 — Task Board row fixes (ghost parents, expand all, blank subtasks)

**Date:** 2026-09-29 → 2026-09-30 · **Developer:** Andrew · **Status:** complete
**Branch:** worktree `.claude/worktrees/ghost-parent-editable` on `fix/ghost-parent-editable`, cut from local `main` at `74b5bc7`

## What shipped (all pushed to `origin/dev`, Production deploys confirmed via GitHub deployments API)

| Commit | Change |
|---|---|
| `2412267` | Ghost parents (a parent copy shown in another status group because its subitems landed there) are fully editable and no longer greyed. Dimming is now opacity 0.5 only, applied when a scorecard is selected and the parent does not match it. |
| `cd37a62` | "+ Add subtask" on a ghost row expands the real parent; an untitled parent no longer opens title edit in both copies. |
| `1f4eb75` | Expand all / Collapse all reaches every visible row. Ghost rows and filter-matched parents open by default; an explicit collapse overrides that and resets when the filters change. Ghost copies expand independently of their real row (`rowKey` = `ghost:{group}:{id}`). The toggle acts only on rows with visible subitems in open group sections. |
| `d68f1a9` | Only the item just created (`newItemId`, latched at mount, cleared after its first edit) opens into title edit. A new subtask left empty on blur/Escape is deleted; a window-switch blur keeps it. Double-clicking "+ Add subtask" creates one. Same wiring in `MiniProjectBoard`. |

**Decisions (Andy, 2026-09-29):**
- Greying a parent means "does not match the selected scorecard" only. A greyed row keeps every control working.
- A "+ Add subtask" left empty disappears when the user clicks out. Skipped SI numbers are acceptable.

**Root causes:**
- Ghost rows were built read-only by design in `f1def36` (2026-09-16); Andy never wanted that.
- Expand all could not close ghost rows or filter-forced rows because both were OR'd into `expanded` with no override.
- Page jumps to a "new subtask": any untitled item opened title edit with `autoFocus` on mount. **Only partly confirmed:** on 2026-09-30 Firestore held 0 untitled items (382 total), and all subitems created 2026-09-28 → 30 were Andy's and titled. The likely second cause is slow "+ Add subtask" (the transaction round-trip) prompting a second click; Andy's own item "Clicking 'Add subtask' slow / buggy" supports that. The double-click guard covers it.

**Tests added:**
- `src/components/__tests__/TaskBoardRow.ghost.test.jsx`
- `src/components/__tests__/TaskBoardRow.newSubitem.test.jsx`
- `src/pages/__tests__/TaskBoard.expandAll.test.jsx`, the first full-page TaskBoard test. It mocks the Firestore hooks and stubs `localStorage`, because jsdom's localStorage is broken under this Node version.

Each test failed on the pre-fix code. The related files passed at 19/19. The full suite was not run.

**Not verified in a browser.** Every check was a component test plus `vite build`.

## Gotchas learned

- Local Google sign-in only works on OAuth-registered origins, so a dev server on port 5191 cannot sign in.
- Never drive a browser with Andy's real Chrome profile.
- A worktree's `.env.local` is symlinked by Claude: `ln -s ../../../.env.local .env.local`. Never read it.
- Firestore reads work through the REST API with `gcloud auth print-access-token`. The token needs an interactive `gcloud auth login` when it expires.
- There is no ESLint config in the repo; `npm run lint` fails on `main` too.

## Deferred

| What | Why deferred | Trigger |
|---|---|---|
| Memory note "never automate a browser with Andy's real Chrome profile" is not saved (the secrets hook blocked the write) | Needs Andy's call on how to record it | Next time memory is edited |
| Dimming covers the scorecard only; search/column filters that pull a parent in via its subitems do not dim it | Andy specified scorecards | If Andy expects dimming for every filter |
| New **top-level** items left untitled are kept (only subtasks are discarded) | Request covered subtasks only | If blank top-level items pile up |
| A second "+ Add subtask" click after commit but before the snapshot can still leave one blank subtask | Tiny window | Another report of a stray subtask |
| A collapse sticks if a new subitem starts matching while the filters stay the same | Treated as the user's explicit choice | If Andy reports a hidden match |
| Session `v0_4_9_Andrew_BLOCKED_STATUS` still says `in_progress`, but Blocked shipped in `25c6e96` | Not this session's record | Next session touching statuses (the scorecards/statuses work) |

## Close summary

Four fixes shipped to production and the work is complete. The next session is the scorecards + statuses work in a fresh worktree.
