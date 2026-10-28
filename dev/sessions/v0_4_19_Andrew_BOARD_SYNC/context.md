# Session v0.4.19 — Board Sync

**Date:** 2026-10-26 · **Developer:** Andrew · **Status:** complete (closed 2026-10-27)
**Branch:** worktree `.claude/worktrees/board-sync` on `worktree-board-sync`, cut from `main` at `c923daf`

## Ask

A Sync feature on the Task Board that updates every client's and Vistamar's tasks in one run, using the same sources as Sync Meeting, without touching any agenda. Used before and after the Monday Touch Base. Only adeemer@vistamarconsulting.com may use it.

## Decisions

- "New" is defined by a per-org transcript ledger (`syncedTranscripts`), stamped by both Sync Meeting and Board Sync; 30-day lookback; backfill from each org's last Sync Meeting.
- One model call per org in parallel; one review grouped by org; one atomic apply.
- Orgs with nothing new are skipped by default (checkbox to include).
- Touch Base (master-mapped) transcripts feed every org; other Vistamar meetings are context only for clients.
- Shared extra-context box. Access gate: Andy's email, client and server.

## Docs

- Spec: `docs/superpowers/specs/2026-10-26-board-sync-design.md`
- Plan: `docs/plans/2026-10-26-board-sync.md`

## State

- Spec written, reviewed, committed. Plan written and reviewed (fixes: backfill bounded by `LEDGER_EPOCH_MS`; cross-org backfill uses the master agenda's sync only; no ESLint steps — repo has no config; handler 403 test; coined tags removable in review).
- Andy approved: Vistamar-internal meetings are context only for clients; Board Sync has its own apply function.
- Execution: subagent-driven, overnight, unattended, Tasks 1–10 only. No rules deploy, paid AI call, or push until Andy reviews in the morning (Task 11).
- **2026-10-27 overnight: Tasks 1–10 code complete on `worktree-board-sync` (not pushed, rules not deployed, no paid calls made).** Each task: fresh implementer subagent → spec + quality review → fix commits → re-review until approved, then a whole-branch review.

## Shipped per task (commits, local branch only)

| Task | Commits | What |
|---|---|---|
| 1 | `4d510e1` | `validateProposal({ requireTopic })`; `inferAssigneeIds` moved to `syncMeeting.js` |
| 2 | `a569f55`, `ea91955`, `7b7a6c1` | `src/lib/boardSyncCore.js` pure core + tests; fixes: title→org mapping, already-synced kept first under the context cap, pagination dedupe, undated rows counted, coined-tag slug dedupe, invalid doc-id guard |
| 3 | `65eca58` | Board rules extracted to `api/ai/_lib/boardRules.js`; Sync Meeting prompt snapshot-locked (byte-identity independently proven on 1152 arg combos) |
| 4 | `2273a99`, `84d76cf` | `/api/ai/sync-board` handler (Andy-only 403 before any model call), routed in `dispatch.js`; fix: synced Touch Base keeps its cross-org flag |
| 5 | `f04306d` | `firestore.rules`: `syncedTranscripts` (any active user, no delete), `boardSyncLog` (Andy only, append-only) |
| 6 | `9fcd15b` | Sync Meeting apply stamps the ledger inside its transaction |
| 7 | `40b261c`, `dae3b1a` | `src/lib/boardSync.js` gather / per-org run / atomic apply + ledger + log |
| 8 | `fc96b27`, `e46c020`, `acdedbb` | `SyncBoardDialog.jsx` + 7 render tests |
| 9 | `7e4fb10` | Task Board "Sync Board" button (Andy only) + AI Integration rows |
| 10 | `0a2047c`, `20e476b` | test timeout budget; Task 11 order fix in plan; AI Integration wording |

## Test + build results (2026-10-27)

- **Full suite (`vitest run --maxWorkers=3`): 280 passed, 5 failed of 285 (34 files).** All 5 failures are timeouts in pre-existing heavy UI tests: `TableMenu` (2), `AgendaDetail.overviewTopic` (1), `TaskBoard.expandAll` (2). Each of those files passes alone (4/4, 2/2, 4/4). Machine load was 9–21 on 10 cores during runs. Same load-dependent timeout pattern as recorded in v0.4.7. **Not proven:** I did not run a baseline suite on `main`, so I can't rule out that `TaskBoard.expandAll` got slower from importing the dialog (it renders TaskBoard).
- An earlier default-worker run crashed 4 workers (`Timeout waiting for worker to respond`): 252/267 passed. Superseded by the run above.
- New-code test files, run alone: `boardSyncCore` 37/37, `syncBoard` 11/11, `prepare.snapshot` 3/3, `syncMeeting` 30/30, `SyncBoardDialog` 7/7, `ProposedBoardRow` 15/15.
- `npx vite build`: passes (`✓ built in 1m 17s`, usual chunk-size warning only).

## Verified vs. not

- **Verified:** unit/render tests above; build; Sync Meeting system prompt byte-identical across the refactor; handler 403s a non-Andy account before any model call (test).
- **Not verified:**
  - **Browser:** no pre-flight check. Andy said the browser needs his sign-in, so it was skipped.
  - **Rules:** untested until deploy. The repo has no rules emulator.
  - **`applyUnified` ledger write and `applyBoardSync`:** Firestore-bound and not exercised against a database.
  - **Live model output:** not checked, and the cost is unmeasured.

## Deviations from the plan (all recorded in the plan/spec in the same commits)

- Classification: an explicit title→agenda mapping wins over attendees for client orgs too (spec §3.2 said so; the plan only mapped Vistamar titles). Titles mapped to more than one org are excluded from mapping and listed in pre-flight.
- Context cap keeps `already-synced` rows ahead of `vistamar-internal` (they are the do-not-duplicate signal).
- Already-synced Touch Base transcripts keep a `crossOrg` flag so each org still takes only its own parts.
- Items have `title`, not `name`; `boardContextForOrg` fixed.
- Apply: 500-write pre-check fails loudly; moves/notes/parents in another org or with invalid ids are dropped and listed; several notes on one item all land; coined tags re-checked inside the transaction; parent-that-is-a-subitem dropped.
- Dialog: Apply works for finished orgs while others still run (spec §7; plan had blocked it); Discard after a paid run takes two clicks (inline, no browser dialog).
- Task 11 order changed (see Morning checklist): the live run needs the `sync-board` route deployed, because the dev server proxies `/api/*` to the deployed backend. So the push comes before the live run, and `LEDGER_EPOCH_MS` is set at deploy time, never before.

## Morning checklist (Task 11 — each needs Andy's yes)

1. **Deploy rules — DONE 2026-10-27T15:32Z** (`--account adeemer@vistamarconsulting.com`; the CLI default account `deemerwsp@gmail.com` gets a 403). Compiled and released. This must come before the push, or Sync Meeting apply fails for everyone.
2. **Pre-flight browser check — DONE 2026-10-27.** Dialog loaded against live data with the deployed rules (ledger read raised no permission error). Unio 4 new · 9 context, Bryn Mawr 5 · 6, Golden Vision 4 · 6, ID Care 4 · 8, Vistamar 10 · 0; "No Board Sync yet"; 3 unclassified; no ambiguous titles. Run not clicked. Not exercised: zero-new org unticked (none had zero). First load rendered blank from a stale Vite dep cache; `npm run dev -- --force` fixed it.
3. **Rebase + epoch — DONE.** Rebased onto `origin/dev` (28 commits ahead, then 1 more). Conflicts were all keep-both: `prepare.js` (dev moved the model call to Opus 5.5 fast via `claude.js`; prompt text unchanged, snapshot 3/3), `dispatch.js` (routes `chat` + `sync-board`), `aiAgenda.js` (dev's `planTopicWrites` apply; ledger write still in the writes phase), `TaskBoard.jsx` (Board Chat + Sync Board buttons), `SyncMeetingDialog.jsx`, `syncMeeting.js` + test, `SESSION_INDEX.json`. After rebase: syncMeeting 38/38, boardSyncCore 37/37, prepare.snapshot 3/3, syncBoard 11/11, SyncBoardDialog 7/7, BoardChatPanel 7/7, TaskBoard.expandAll 4/4 alone (1 load timeout on an earlier run); build passes. Full suite not re-run. `LEDGER_EPOCH_MS` = `2026-10-27T17:05:00Z`. Board Sync stays on Sonnet 4.6 (Andy, 2026-10-27).
4. **Push — DONE** to `origin/dev`.
5. **Priced live run — DONE 2026-10-27 17:10–17:38Z** (headless agent-browser, local dev → deployed `/api`). All 5 orgs returned; applied all. Created / moved / noted: Unio 4/3/4, Bryn Mawr 7/0/4, Golden Vision 0/0/2, ID Care 2/0/1, Vistamar 11/3/6. One Vistamar move dropped by the apply guard (model cited an unknown itemId). **Not checked:** `syncedTranscripts` stamps and the `boardSyncLog` entry (real token cost) were not read.
6. **Ledger round-trip — verified 2026-10-27 ~17:05 PT (pre-flight only, Run not clicked).** `syncedTranscripts` holds 11 docs / 27 org stamps from the 17:39Z apply, matching `boardSyncLog` transcript counts per org (Unio 4, Bryn Mawr 5, Golden Vision 4, ID Care 4, Vistamar 10). Pre-flight: Vistamar nothing new · 10 context; Unio 6·7, Bryn Mawr 6·5, Golden Vision 6·4, ID Care 7·6. Every client's 6 new are the internal meetings now treated as sources (step 7); ID Care's 7th is a meeting held after the run. Cost of the live run (`boardSyncLog` usage, claude-sonnet-4-6 at $3/$15 per M): 155,896 input + 24,982 output tokens ≈ $0.84. Dev server note: the first start rendered blank (`@mui/material` optimized dep threw "styled_default is not a function"); a second `--force` start rendered normally.
7. **Rule change (Andy, after the live run) — pushed as `ef30474` (`c1bab0e..5765b57`). Build passed (2m 44s) before the rebase.** Internal Vistamar meetings (Platform Dev, Business Dev) now create client tasks; each client takes only the work assigned to it, checked against existing tasks. Tests at that commit: boardSyncCore 39/39, syncBoard 12/12, SyncBoardDialog 7/7 (one 21s load timeout on the first run, passed on rerun). The next run will treat the last 30 days of internal meetings as new for every client, so per-client cost rises.
8. **Review fix (pre-push review of `ef30474`).** The master Touch Base Sync Meeting already uses internal meetings as sources for client tasks, but stamped them for vistamar only, so Board Sync could re-propose the same client task. Master apply now stamps internal meetings for every org, and pre-epoch internal meetings backfill against the master threshold (same as cross-org). A synced internal meeting is now labelled "Vistamar internal" instead of "cross-org" (`crossOrg` flag replaced by `sharedFrom`). Spec 3.3/3.4 and the AI Integration row corrected. Tests: boardSyncCore 43/43, syncBoard 12/12.

## Deferred

- **Concurrent-apply duplicate guard (minor):** if a Sync Meeting for org X applies between Board Sync's gather and its Apply, both can create tasks from the same transcript. Fix: inside `applyBoardSync`'s transaction, read the ledger docs for each org's `transcriptIds` and drop or flag an org already stamped since gather.
- **Sync Meeting sends blank board names:** `assembleGenInputs` (`src/lib/aiAgenda.js`) reads `it.name`, but items only have `title`, so its "recent board activity" lines have always gone out blank. Separate fix; not touched here.
- **`applyUnified` order keys (Board Sync mirrors it):** order keys start from null, so AI-created items can sort ahead of existing ones. AI-created subitems are numbered from the org counter, not the parent's `nextSubitemNumber`.
- **Classification mismatch (rare):** a transcript whose title maps to org Y but whose attendees resolve to X. Sync Meeting stamps it for X, while Board Sync files it under Y, so the same work can land on both boards.
- **`syncedTranscripts` rule** allows any active user to update with no field checks, as spec §8 states.

## Close summary (2026-10-27)

Board Sync is live on `origin/dev` and local `main`: Firestore rules deployed, one priced live run applied for all 5 orgs (≈ $0.84), ledger round-trip verified. After the run, internal Vistamar meetings became task sources for clients (Andy's decision), and a pre-push review fix made the master Sync Meeting stamp internal meetings for every org (`e7362bb`). No paid call is pending.

Open items are the Deferred list above. Next real signal: the next Board Sync run is the first with internal meetings as client sources — watch the review screen for duplicates of existing tasks, especially sub-items (the model only sees top-level tasks).
