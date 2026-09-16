# Session: v0.4.7 — Vistamar Task List Cleanup

**Developer:** Andrew
**Date:** 2026-09-16
**Branch:** worktree `task-list-cleanup` → origin/dev (docs only)
**Status:** CLOSED — data-only session; no app code changed

---

## Goal

Nobody used the Vistamar internal Task Board; the team now wants to. Rebuild it from what was
actually discussed in the last two months of meetings, reconcile against Cedric's independent
version, and write the result to Firestore.

## What was done

1. **Read current state** (read-only, Firestore REST via `gcloud auth print-access-token`):
   57 Vistamar items — 22 untriaged AI Gen from May/June, 2 Done, 35 uncategorized, 0 tagged.
2. **Category/tag analysis (all orgs):** categories and tags are global (no org scope), so client
   categories leak onto Vistamar (#34 had `reporting-analytics`). 32% of all items uncategorized.
   `management` category unused. Tags are all client-marketing; 6 unused (corporate-leadership,
   location-provider-marketing, recruiting, sms, strategic-marketing, unioverse); ad-hoc `Links`
   tag (auto-id, no layer); `blocked`/`urgent` duplicate `onHold`/`priorityId`.
3. **Fireflies:** 2 "VM – Weekly Business Dev" (09-04, 09-11) + 8 "Vistamar Platform Development
   updates" (07-16 → 09-10) transcripts. There is no meeting titled "Console Dev" — Platform Dev is it.
   Key via `node --env-file=.env.local` (`VITE_FIREFLIES_KEY`).
4. **Reconciled** 184 raw meeting items + 57 board items into 22 parents; then folded in Cedric's
   `Platform and BD Task List.xlsx` (65 flat rows, Sep 1–16, Fireflies AI action items only).
5. **Applied to prod Firestore** as one atomic REST `documents:commit` (172 writes, 2026-09-16T20:36Z),
   every touched doc guarded by an `updateTime` precondition. Verified by re-read.

## Result (prod)

- Vistamar: 22 active parents (console 7, platform-ops 6, business-dev 6, studio 2, management 1),
  all categorized; 0 AI Gen/Pending left; no orphans; no duplicate item numbers.
- 15 new parents + 91 new subitems; 7 parents + 16 subitems updated; 6 closed Done; 23 archived
  (merges carry a "Merged into …" description note).
- Moved to client boards: ID Care #28 (CRM shortlist, hold), #29 (redesign proposal, Done);
  Unio #50 (Rater8 widget audit). New on Bryn Mawr: #35 form status, #36 PDF request.
- Category `platform-ops` renamed "Platform Ops & Compliance"; `business-dev` description rewritten.
- New tags (layer 2): `hipaa`, `serp-data`, `sales-blocker`.
- Console enhancement parents (AI Exec Summary, AI visibility, GBP status, Rater8, reverse flow) on
  hold per the 09-10 "no console changes unless high priority" decision.

## Decisions (Andy)

- Archive the 11 June AI Gen items nobody mentioned in two months.
- Client-delivery items leave the Vistamar board.
- HIPAA non-technical program owner: Cedric.
- Diagnostic SERP script owner: Hugo.
- Cedric's WordPress page-status proposal is an active subitem under the on-hold reverse-flow parent.
- Add all of Cedric's rows, organized as items/subitems.

## Gotchas learned

- REST writes may not reach an already-open `onSnapshot` tab — hard-refresh the board.
- `gcloud auth login` via `!` failed (`missing_code`); `gcloud auth login --no-launch-browser` in a
  normal terminal works.
- AI Gen's apply path (`src/lib/aiAgenda.js`) numbers new subitems from the ORG counter, not the
  parent's `nextSubitemNumber` — root of the "duplicate item numbers" bug (tracked as a Management subitem).

## Deferred

- **Global tag hygiene pass:** (6 unused tags DELETED 2026-09-16 after confirming no item/topic refs — 27 tags remain) delete `Links`; migrate `blocked` → `onHold`,
  `urgent` → `priorityId`; decide on `approval-needed`/`client-internal` as waiting states.
- **Scope categories/tags by org type** (`scope: internal | client`, picker filtered by
  `organizations/{org}.type`) so client vocab stops leaking into Vistamar and vice versa.
- Fix AI Gen subitem numbering (org counter vs per-parent counter).
- Items marked uncertain in the reconciliation (e.g. whether Acuity one-pager was sent, what
  "db Credentialing" meant) — confirm at the next weekly Task Board review.
- Pre-write backup + scripts lived in the session scratchpad only (not committed; contain internal data).
