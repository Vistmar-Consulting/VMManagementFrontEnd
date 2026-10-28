# Session v0.4.20 — Sync Meeting: tracked changes + editable proposal

**Date:** 2026-10-27 · **Developer:** Andrew · **Status:** active
**Branch:** worktree `.claude/worktrees/sync-meeting-tracked-edits` on `worktree-sync-meeting-tracked-edits`, cut from `main` at `3773d77`

## Ask

In the Sync Meeting review: (A) full text editing of the proposed agenda; (B) a tracked-changes redline from the pre-sync agenda to the proposed agenda. Comments (Claude asking "is this done?") come later, as a separate API call. Keep the first version small.

## State

- Design approved 2026-10-27 → `docs/superpowers/specs/2026-10-27-sync-meeting-tracked-edits-design.md` (commits 517e644, 312faf0).
- Plan approved 2026-10-27 → `docs/plans/2026-10-27-sync-meeting-tracked-edits.md` (commit d737664).
- Implementation: running unattended via superpowers:subagent-driven-development, Tasks 1–9 in order, implementer + spec review + quality review per task.

## Task log

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 diff dep | done, reviewed | 0221cd2 | worktree now has its own node_modules (npm ci); lockfile nests old diff@4.0.4 under ts-node; npm re-sorted @tiptap/y-tiptap alphabetically in package.json |
| 2 redline sanitizer | done, reviewed | 5740a0a | options identical to sanitizeHtml + del/ins; 25/25 pass |
| 3 diffAgendaHtml | done, reviewed | 41a61e4, 8b5abfa, 613ea51 | 21 tests. Bugs fixed (each with a test): ul→ol at same depth nested wrongly; words glued across p/br/cells; nested-table rows collected twice; similarity mixed units; top-level inline split per node; empty parent bullet → `ul>ul`; sanitizeHtml dropped `<thead>` rows (pre-existing, now allows thead/tfoot) |
| 4 buildAgendaRedline | pending | | |
| 5 Open Floor live write | pending | | |
| 6 ProposalReview | pending | | |
| 7 dialog wiring | pending | | |
| 8 AI Integration rows | pending | | |
| 9 verify + push | pending | | |

## Decisions made unattended

- Plan Task 9 Step 3 (ask before the paid call) is satisfied by Andy's pre-approval: one `/api/ai/prepare` (~$0.54) + at most one Refine, $1.50 cap, Vistamar internal agenda only.

## Risks (accepted, display-only)

- Adjacent separate lists of the same tag at the same depth render as one list in the redline.
- Indent-only or list-type-only changes on unchanged text show no marks (blocks match on kind + text, by design — like formatting-only changes).
- Changed blocks render as plain text plus marks; paragraph/line breaks inside a changed bullet or cell flatten to spaces.

## Spend log

| Call | Cost |
|---|---|

## Deferred

- Claude comments on the proposed agenda (separate API call, not in `/api/ai/prepare`).
- Per-change accept/reject.
