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
| 8 AI Integration rows | done, self-reviewed | 9625354 | plan row + notes on the Refine lock, discard confirm and required new title |
| 9 verify + push | in progress | | Final whole-branch review (requesting-code-review): ready to push, 0 Critical/Important. Full suite run 1 (default workers): 37 failed / 503 passed — every failure a timeout across 9 heavy MUI component files (incl. unrelated TableMenu, BoardChat, NewMeetingDialog, TaskBoard), load avg 16–18 with a Chrome renderer at ~120% CPU; re-running with --maxWorkers=3 |

## Decisions made unattended

- Plan Task 9 Step 3 (ask before the paid call) is satisfied by Andy's pre-approval: one `/api/ai/prepare` (~$0.54) + at most one Refine, $1.50 cap, Vistamar internal agenda only.

## Risks (accepted, display-only)

- Adjacent separate lists of the same tag at the same depth render as one list in the redline.
- Indent-only or list-type-only changes on unchanged text show no marks (blocks match on kind + text, by design — like formatting-only changes).
- Changed blocks render as plain text plus marks; paragraph/line breaks inside a changed bullet or cell flatten to spaces.

## Notes for later (pre-existing, not changed)

- Final review Minor: Apply decides "Open Floor changed" (and topic bodies) against Firestore at Apply time, not the pre-sync text the AI saw. A colleague's in-room edit during review is overwritten if the AI's text differs from it; editor-vs-AI HTML serialisation also differs, so an AI-unchanged body is usually rewritten anyway. The presence confirm warns. A later pass could compare against the pre-sync snapshot for topics and Open Floor together.

- `applyUnified` reads topic bodies (`curBodyById`) outside the transaction, so a topic save landing mid-apply does not force a retry; Open Floor is now read inside it. Outcome differs only if the proposal equals a concurrent edit. Low impact; left as is.

## Browser check (2026-10-27, ~23:30 PT, local dev :5173, headed agent-browser)

Agenda: Vistamar internal "Vistamar Platform Development updates" (`agendas/m4b1tbph59cpv51hk1t4p2bh0g`). One Generate (prepare) call.
- Review opened on **Changes**: 36 `<del>` / 27 `<ins>`; new topic "Console V1 Release & Location Map Replacement" inserted with "New topic" caption; 4 suggested removals struck with the "kept unless you check Delete above" caption. Retained topics word/line diffed against the pre-sync bodies.
- **Edit**: retained titles render as locked headings; the new topic's title is a field. Clearing it disabled Apply and showed "A new topic needs a title (Edit tab)"; retyping re-enabled it.
- Typed `ZEBRA-TOPIC-1027` into the Content Studio topic body; Cmd+Z removed it; retyped it, and typed `ZEBRA-OPENFLOOR-1027` into Open Floor. Back on Changes, both phrases were inside `<ins>`.
- All 11 board suggestions (5 new, 1 status move, 5 notes) unticked; no Delete boxes ticked.
- **Apply was refused**: "Live editor not connected — reload the agenda and retry." `/api/liveblocks-auth` returns 426 for every local build by design (`fd45669`: build id "dev" is refused so a local branch can't write to shared rooms), and `apply` refuses before any write when the Yjs provider is not synced. **Nothing was written to Firestore** — no version snapshot, no agenda/topic/board writes.
- Automation note: a click on the Changes tab while it was scrolled out of the dialog's view did not register; scrolling it into view first worked. Not an app bug.

## Spend log

| Call | Cost |
|---|---|
| `/api/ai/prepare`, Vistamar Platform Development agenda, 2026-10-27 23:32 PT | ≈ $0.54 (plan estimate; actual token cost not read) |

## Deferred

- Claude comments on the proposed agenda (separate API call, not in `/api/ai/prepare`).
- Per-change accept/reject.
