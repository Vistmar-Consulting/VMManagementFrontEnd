# Session v0.4.19 — Board Sync

**Date:** 2026-10-26 · **Developer:** Andrew · **Status:** active
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
2. **Pre-flight browser check:** local dev on 5173, signed in as Andy → Task Board → Sync Board. Check the per-org new/context counts, unticked zero-new orgs, the last-sync line, and the unclassified and ambiguous notes. Stop before Run.
3. **Set `LEDGER_EPOCH_MS`** in `src/lib/boardSyncCore.js` (currently `2026-10-27T12:00:00Z`) to the deploy time or slightly after, then commit.
4. **Push:** `git pull --rebase origin dev && git push origin HEAD:dev`. Andy's requested order put the push last, but the live run cannot reach `/api/ai/sync-board` until this is deployed.
5. **Priced live run:** about $0.15–0.30 per ticked org (unmeasured), so roughly $1–3 for all orgs. Run → review → apply. Check the created items, `syncedTranscripts` stamps for applied orgs only, and the real `usage` token counts in `boardSyncLog`.
6. **Ledger round-trip:** reopen Sync Board. The orgs just applied should show 0 new.

## Deferred

- **Concurrent-apply duplicate guard (minor):** if a Sync Meeting for org X applies between Board Sync's gather and its Apply, both can create tasks from the same transcript. Fix: inside `applyBoardSync`'s transaction, read the ledger docs for each org's `transcriptIds` and drop or flag an org already stamped since gather.
- **Sync Meeting sends blank board names:** `assembleGenInputs` (`src/lib/aiAgenda.js`) reads `it.name`, but items only have `title`, so its "recent board activity" lines have always gone out blank. Separate fix; not touched here.
- **`applyUnified` order keys (Board Sync mirrors it):** order keys start from null, so AI-created items can sort ahead of existing ones. AI-created subitems are numbered from the org counter, not the parent's `nextSubitemNumber`.
- **Classification mismatch (rare):** a transcript whose title maps to org Y but whose attendees resolve to X. Sync Meeting stamps it for X, while Board Sync files it under Y, so the same work can land on both boards.
- **`syncedTranscripts` rule** allows any active user to update with no field checks, as spec §8 states.
- **Ledger** is untested against a live database until Task 11.
