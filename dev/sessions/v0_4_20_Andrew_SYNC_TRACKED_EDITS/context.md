# Session v0.4.20 — Sync Meeting: tracked changes + editable proposal

## Morning

**Shipped:** Sync Meeting redline + editable proposal (plan Tasks 1–9) pushed to `origin/dev` at **`90e2065`** (rebased onto `f7b1a54`). Whole-branch code review: "ready to push". Before the rebase: `npx vitest run --testTimeout=15000 --maxWorkers=3` **540/540**, `npm run build` OK. After the rebase (incoming commits touched only `TaskBoard.jsx` + its test): `src/pages/__tests__` TaskBoard files 15/15 serially and `npm run build` OK; the full suite was not re-run after the rebase.

**Not verified — needs you:** the live Apply. On local dev, `/api/liveblocks-auth` refuses every local build (426, by design since `fd45669`), so the live editor never connects and Apply refuses before writing anything. Verifying on the deployed site needs a second `/api/ai/prepare` (~$0.54), beyond the one call approved. Next step: on vm-management-front-end.vercel.app, Vistamar Platform Development agenda → Sync Meeting → Generate → untick all board rows → Edit tab: type a phrase into one topic body and into Open Floor → Apply → reload twice → both phrases should be in the live editors (topic body **and** Open Floor; the Open Floor live write is the new `applyUnified` code, covered only by unit tests of its helpers).

**Verified in the browser (local, one prepare call):** Changes tab redline (del/ins, new-topic and suggested-removal captions), Edit tab (locked retained titles, editable new title, blank title disables Apply with caption), typing + Cmd+Z undo in TipTap, edits show as insertions back on Changes, Apply refused with "Live editor not connected". **Nothing was written to Firestore.**

**Spend:** one `/api/ai/prepare` ≈ $0.54 (plan estimate; actual tokens not read). No Refine. Total ≈ $0.54 of the $1.50 cap.

**Bugs found and fixed (each with a test):**
- Redline (`agendaDiff.js`): ul→ol at the same depth rendered inside one list; words glued across paragraphs, `<br>` and cells; nested-table rows read twice; similarity measured in mixed units; top-level inline content split one paragraph per node; empty parent bullet rendered `ul > ul`.
- `sanitizeHtml` dropped `<thead>` header rows (pre-existing; now keeps thead/tfoot).
- Edits typed while Refine ran were silently replaced → review is locked (`readOnly`) while refining/applying; `RichBodyEditor` gained `editable` and `ariaLabel` (toolbar and Cmd+K locked too).
- New-topic titles were saved untrimmed, and the blank-title rule lived only in the UI → `planTopicWrites` trims and throws on blank.
- Discard dropped hand edits without asking → confirm when edited (not after the edits are already saved).
- Crash on a non-string AI topic title in the Edit tab; tabs/editors lacked accessible names.
- Presence confirm now names Open Floor (wording only, no test — no harness for that prompt).

**Test-limit change to check:** `TaskBoard.expandAll.test.jsx` — the last two tests' limits raised 20s → 60s (`7be26bd`), same remedy as `b74d172` for their siblings. Each timed out in full-suite runs under load (load avg 9–19; 21–48s), passes alone in 11–15s; file untouched by this feature otherwise, assertions unchanged.

**Housekeeping:** this worktree has its own `node_modules` (`npm ci`, not the symlink). The main checkout needs `npm install` after merge to get `diff@9.0.0`. Dev server stopped, browser closed.


**Date:** 2026-10-27 · **Developer:** Andrew · **Status:** active
**Branch:** worktree `.claude/worktrees/sync-meeting-tracked-edits` on `worktree-sync-meeting-tracked-edits`, cut from `main` at `3773d77`

## Ask

In the Sync Meeting review: (A) full text editing of the proposed agenda; (B) a tracked-changes redline from the pre-sync agenda to the proposed agenda. Comments (Claude asking "is this done?") come later, as a separate API call. Keep the first version small.

## State

- Design approved 2026-10-27 → `docs/superpowers/specs/2026-10-27-sync-meeting-tracked-edits-design.md` (commits 1cf5420, 5370062).
- Plan approved 2026-10-27 → `docs/plans/2026-10-27-sync-meeting-tracked-edits.md` (commit 99cf881).
- Implementation complete 2026-10-28 (unattended, subagent-driven: implementer + spec review + quality review per task). Pushed `90e2065` to origin/dev. Live Apply unverified — see Morning.

## Task log

SHAs below are the rebased ones on origin/dev.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 diff dep | done, reviewed | e4c4267 | worktree now has its own node_modules (npm ci); lockfile nests old diff@4.0.4 under ts-node; npm re-sorted @tiptap/y-tiptap alphabetically in package.json |
| 2 redline sanitizer | done, reviewed | 2bd072a | options identical to sanitizeHtml + del/ins; 25/25 pass |
| 3 diffAgendaHtml | done, reviewed | be48628, 4119e04, 74fac27 | 21 tests. Bugs fixed (each with a test): ul→ol at same depth nested wrongly; words glued across p/br/cells; nested-table rows collected twice; similarity mixed units; top-level inline split per node; empty parent bullet → `ul>ul`; sanitizeHtml dropped `<thead>` rows (pre-existing, now allows thead/tfoot) |
| 4 buildAgendaRedline | done, reviewed | e201cd1, 903ae3d | 30 tests; review: no bugs, added Open Floor-changed, both-empty and duplicate-ref tests |
| 5 Open Floor live write | done, reviewed | 69ee00f, f8fa74c | 48 tests. applyUnified wiring has no unit test (no Firestore tx harness) → covered by the Task 9 browser check. Review fix: presence confirm now names Open Floor (wording only; SyncMeetingDialog has no test harness, so no test added) |
| 6 ProposalReview | done, reviewed | 09115e3, b8efbcc, af1dc6e | 13 + 4 tests. Bugs fixed: edits typed during Refine silently lost (new `readOnly` lock; RichBodyEditor gained `editable` + `ariaLabel` props, toolbar/cmd+K locked too); tabs/panels and body editors lacked accessible names; crash on a non-string AI topic title |
| 7 dialog wiring | done, reviewed | 24026a9, 1eef52a, c0ef29e | New SyncMeetingDialog.review.test.jsx (9 tests). ProposalReview locked while refining/applying. Bugs fixed: new-topic titles saved untrimmed; blank-title rule was UI-only (planTopicWrites now trims + throws); Discard dropped hand edits without asking; Discard prompted after edits were already saved. Note: c0ef29e was committed while one test had timed out under machine load (load avg 16; 25s vs 5.5s normal); re-run alone 9/9 pass |
| 8 AI Integration rows | done, self-reviewed | 41edd32 | plan row + notes on the Refine lock, discard confirm and required new title |
| 9 verify + push | done except live Apply | 7be26bd, 90e2065 | Final whole-branch review (requesting-code-review): ready to push, 0 Critical/Important. Full suite run 1 (default workers): 37 failed / 503 passed — every failure a timeout across 9 heavy MUI component files (incl. unrelated TableMenu, BoardChat, NewMeetingDialog, TaskBoard), load avg 16–18 with a Chrome renderer at ~120% CPU; re-run with --maxWorkers=3: 539/540 twice (TaskBoard.expandAll timeout), then 540/540 after `7be26bd`. After rebase onto f7b1a54: TaskBoard tests 15/15 serially (parallel run timed out at load avg 18), build OK. Pushed. |

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
