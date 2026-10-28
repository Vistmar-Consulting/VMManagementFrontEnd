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
| 4 buildAgendaRedline | done, reviewed | 3b8cfe9, e857de4 | 30 tests; review: no bugs, added Open Floor-changed, both-empty and duplicate-ref tests |
| 5 Open Floor live write | done, reviewed | bafeba3, 6b6912e | 48 tests. applyUnified wiring has no unit test (no Firestore tx harness) → covered by the Task 9 browser check. Review fix: presence confirm now names Open Floor (wording only; SyncMeetingDialog has no test harness, so no test added) |
| 6 ProposalReview | done, reviewed | b9800d2, d2f0c1b, dd870a7 | 13 + 4 tests. Bugs fixed: edits typed during Refine silently lost (new `readOnly` lock; RichBodyEditor gained `editable` + `ariaLabel` props, toolbar/cmd+K locked too); tabs/panels and body editors lacked accessible names; crash on a non-string AI topic title |
| 7 dialog wiring | done, reviewed | 3d4a0f1, c6a10a3, 3adc502 | New SyncMeetingDialog.review.test.jsx (9 tests). ProposalReview locked while refining/applying. Bugs fixed: new-topic titles saved untrimmed; blank-title rule was UI-only (planTopicWrites now trims + throws); Discard dropped hand edits without asking; Discard prompted after edits were already saved. Note: 3adc502 was committed while one test had timed out under machine load (load avg 16; 25s vs 5.5s normal); re-run alone 9/9 pass |
| 8 AI Integration rows | pending | | |
| 9 verify + push | pending | | |

## Decisions made unattended

- Plan Task 9 Step 3 (ask before the paid call) is satisfied by Andy's pre-approval: one `/api/ai/prepare` (~$0.54) + at most one Refine, $1.50 cap, Vistamar internal agenda only.

## Risks (accepted, display-only)

- Adjacent separate lists of the same tag at the same depth render as one list in the redline.
- Indent-only or list-type-only changes on unchanged text show no marks (blocks match on kind + text, by design — like formatting-only changes).
- Changed blocks render as plain text plus marks; paragraph/line breaks inside a changed bullet or cell flatten to spaces.

## Notes for later (pre-existing, not changed)

- `applyUnified` reads topic bodies (`curBodyById`) outside the transaction, so a topic save landing mid-apply does not force a retry; Open Floor is now read inside it. Outcome differs only if the proposal equals a concurrent edit. Low impact; left as is.

## Spend log

| Call | Cost |
|---|---|

## Deferred

- Claude comments on the proposed agenda (separate API call, not in `/api/ai/prepare`).
- Per-change accept/reject.
