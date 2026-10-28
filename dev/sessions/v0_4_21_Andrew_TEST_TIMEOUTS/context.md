# Session v0.4.21 — Test timeouts (expand all + slow imports)

**Date:** 2026-10-28
**Branch:** worktree `.claude/worktrees/expand-all-timeout` on `worktree-expand-all-timeout`, cut from `main` at `c03529a`

## Task

Several sessions recorded `TaskBoard.expandAll` (and other heavy MUI test files) timing out, and raised test limits to 60s (`b74d172`, `7be26bd`). Find the root cause.

## Root causes

1. **Role queries call jsdom `getComputedStyle` on every element they visit.** One call costs ~88ms with MUI's ~528 Emotion `<style>` tags at 30 ancestors (122ms at 60, 15ms at 5); jsdom drops its style cache on every DOM change. `getAllByRole("button")` on the board took 52s (1.3s with `hidden: true`); `getByRole("button", { name })` took 19s. Machine load multiplies this, so the timeouts came and went.
2. **`@mui/icons-material` barrel imports.** Importing the index cost 14.6s per test file (one icon: 0.4s); vitest pays it again in every file. 19 source files imported from the barrel.

Board render itself is not the problem: 4.7s cold, 1.1s warm, 2–3 `getComputedStyle` calls.

## Shipped

| Commit | Change |
|---|---|
| `ee4e53a` | `TaskBoard.expandAll.test.jsx`: `toggleAll` uses `getByLabelText`; ghost-row button lookups pass `hidden: true`. File test time 96s → 28.6s; assertions unchanged. |
| `219aa70` | 19 files import each icon by path (`@mui/icons-material/X`). Import time for two dialog files ~19s → ~6.5s each. |

## Verification

- `npm run build` passes.
- 7 slowest files (expandAll + 6 dialog files): 57/59; the 2 failures took 23–31s at load avg 12–14 and passed 17/17 on a serial rerun.
- Full suite not run.

## Tried and rejected

- `configure({ defaultHidden: true })` in `src/setupTests.js`: barely sped up expandAll (name computation still calls `getComputedStyle`) and broke `TableMenu.test.jsx:74` (a closing menu became queryable). Reverted.

## Deferred

- The 6 dialog test files run 0.1–4s per test at low load; no query rewrite needed. `BoardChatPanel` "shows the model-call cap notice" is 6.2s, over vitest's 5s default.
- expandAll tests still take 4–9s each; the 60s limits are kept.
- `AgendaTOC.collapse` and `AgendaDetail.overviewTopic` not measured.
- Test practice for this repo: prefer `getByLabelText` / `getByText`, or pass `hidden: true`, over `getByRole` with `name` in large MUI trees.
