# Session v0.4.10 — Subitem category display

**Date:** 2026-09-24 → 2026-09-25 · **Developer:** Andrew · **Status:** complete

## What happened

Reported: Category not editable on many Task Board rows. Root cause: the rows were
subitems (and ghost parents), which are read-only for Category by design —
subitems inherit the parent's category. The empty subitem cell read as a missing,
editable value.

Decision (Andy, 2026-09-25): only parent items carry an editable category;
subitems show the parent's category, muted and read-only.

| Commit | What |
|---|---|
| `b14830e` | Subitem rows show the parent's category at 50% opacity, non-interactive (`TaskBoardRow` `parentCategoryId` prop) + `TaskBoardRow.category.test.jsx` |

- Pushed to `origin/dev`; production deployed `b14830e` 2026-09-25 16:48 UTC (GitHub deployments API).
- Verified: new test passes in isolation. NOT run after the change: full suite, build, browser check (Andy asked for no browser/local server).

## Deferred

| What | Why deferred | Trigger |
|---|---|---|
| Confirm the inherited category renders on the live site | Andy reported not seeing it before a hard refresh; not re-checked | Next time the Task Board is open with an expanded subitem whose parent has a category |
| Full-suite timeouts: MUI-heavy row tests exceed 5s under full-suite load (`PresentationModeToggle`, new category test pre-fix) | Pass in isolation; not investigated | Next full `npm test` run that flakes |
