# /to-do log

Durable memory for the `/to-do` skill. The skill reads this at the start of every run and updates it at the end. It is **not** a source of truth for deferred items — `dev/sessions/*/context.md` owns those. This file only tracks the skill's own output: ideas it has proposed, run-over-run movement, and the developer's priority calls.

Do not hand-delete ledger rows — change their status instead.

## Suggestion ledger

| ID | Suggestion | Status | First proposed | Notes |
|----|------------|--------|----------------|-------|
| S1 | Verify #5 category-gate fully removed, then close | shipped | 2026-06-10 | Verified during run: commit cbc2583 removed the guard in src/lib/syncMeeting.js, on origin/dev, no remaining gate. #5 DONE. |
| S2 | Verify-and-close obsolete carried deferrals (#4 Pre-Brief redesign, #11 task-suggestion prompt, #12 AIGenDialog mislabel) | shipped | 2026-06-10 | Verified 2026-06-10: all three OBSOLETE. Pre-Brief gone (8e306c0→949d2e2, replaced by AgendaTOC); suggest-tasks.js deleted (0edac10/a51f18e); AIGenDialog removed. All closed. |
| S3 | Commit the untracked design docs (3) | proposed | 2026-06-10 | docs/superpowers/{specs,plans}/2026-06-10-agenda-bullet-format* (2) + specs/2026-06-10-sync-meeting-board-section-redesign.md (#6 design). Feature/design history orphaned. |
| S4 | Add topic soft-delete / confirm-before-delete guard (#13) | proposed | 2026-06-10 | Hard deletes, single agenda doc per series, no recovery. Cheap confirm-dialog de-risks. |
| S5 | Fix or confirm-dead the Postmark relay delivery bug (#8) | shipped | 2026-06-10 | FIXED 2026-06-10: relay-mail.js now parses the Postmark body and throws on non-zero ErrorCode (406 inactive recipient etc.) even on HTTP 200. 5 tests in api/meetings/_lib/__tests__/relay-mail.test.js. Not yet pushed. |
| S6 | V3 AI companion (Internal/Public boundary, Post-Brief, per-org overrides) | proposed | 2026-06-10 | BLUE-SKY. Large; needs dedicated design session. Per project_v3_ai_feature_intent. |

## Run history

| Date | Open count | Shipped since last run | Note |
|------|-----------|------------------------|------|
| 2026-06-10 | ~26 | first run (baseline) | First /to-do run. Reconciled backlog #1–#11: 8 shipped (#1 core, #2, #3, #4, #7, #11 + collab hardening + sticky titles), #5 confirmed DONE this run (cbc2583), leaving #6/#8/#9/#10 + board-presence open. ~20 carried/master items open. Master Touch Base cluster flagged HIGH. |
| 2026-06-10 | ~13 | 6 closed + 2 shrunk | Full re-verify pass (3 agents vs code/git). NEWLY CLOSED: Master agenda format DONE (prepare.js:150 !master gate); topic-delete confirm DONE (AgendaDetail.jsx:431/1331; soft-delete still open); org nameless-member email-once DONE (OrgMembersCard.jsx:178); Pre-Brief #4 + suggest-prompt #11 + AIGenDialog #12 all OBSOLETE. SHRUNK to fast-follows: Master Working-view (topic coloring DONE, mini-board per-org OPEN); topic delete (confirm DONE, recovery OPEN). STILL OPEN: master boardScope bug, master prompt editor, SM #6 (now has design doc), SM #10, board presence, Postmark, ActionBar OpenFloor, org resource-filter, org CRUD, biweekly doc-id, Overview pills. CAN'T-VERIFY: migration cleanup #15 (needs Firestore), V1 audit (no artifact). |

## Priority calls

- **2026-06-10** — Andy accepted Recommendation #1 (the two latent client-facing bugs). Both FIXED + verified (91 tests pass, build clean), not yet pushed:
  - Postmark relay silent-success (S5 / #8) — `relay-mail.js` now throws on non-zero `ErrorCode`.
  - ActionBar Send Meeting Prep stale Open Floor (#8 carried) — now sources `agenda.openFloorHtml` via new `htmlToLines()` helper in `agendaHtml.js`; dormant `openFloor` subcollection subscription + prop threading removed. 6 tests.
