# Session: SES-20260602-Andrew-v0.3.0-backlog-triage

- **Session ID:** SES-20260602-Andrew-v0.3.0-backlog-triage
- **Developer:** Andrew
- **Date:** 2026-06-02 (kickoff)
- **Version Start:** v0.3.0
- **Version End:** (pending)
- **Commit Start:** 3a33213
- **Branch:** main (push target: `origin/dev` via `git push origin main:dev`)
- **Folder:** dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/
- **Status:** active

## Mode

Brain-dump triage: Andy is rattling off to-dos rapid-fire. Capture each as a one-liner in `## Backlog` — no analysis/scoping/planning until he picks ONE item. Then full rigor (brainstorm → spec → plan → build, scaled) on that one. Keep the backlog live (added / in-progress / done) and flag overlaps when active work touches a backlog item.

## Source-of-Truth Docs (read order)

1. `CLAUDE.md` (project) + `~/.claude/CLAUDE.md` (global) — non-negotiable conventions
2. **Spec (V1 scope):** `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`
3. **Prior session archive:** `dev/sessions/v0_2_4_Andrew_AGENDA_RICHTEXT/context.md` — full v0.2.4 history (AI engine, data foundation, Sync Meeting, Master Touch Base, Organizations Settings)

## Deploy reminder

`git push origin main:dev` does NOT auto-promote the prod alias. After each deploy: `vercel alias set <new-deploy>.vercel.app vm-management-front-end.vercel.app`. Current prod alias points at `heen8sogj`.

---

## Backlog

### Andy's brain-dump (this session)
- **[P1 — DESIGNED, QUEUED behind the title fix below]** Live collaborative editing (Google-Docs-style) for Meeting Agendas AND Project Boards + Mini Project Boards — edits show on others' instantly. Bonus: presence avatars + live cursors. **Design agreed (Liveblocks + Yjs + TipTap):** transport = **Liveblocks** (hosted CRDT; Andy approved); this slice = **agenda only** (boards already live via onSnapshot → board presence is a fast-follow slice); fields = **each topic body + Open Floor** (Pre-Brief SKIPPED — it's being deprecated, backlog #4). Room per agenda `agenda:{id}`; one Y.Doc, one fragment per field keyed by topic doc id; Firestore `bodyHtml` stays canonical mirror (debounced getHTML→Firestore so AI/Overview/export unchanged); `RichBodyEditor` gains `collab` mode (disable StarterKit history, seed-once guarded). Presence avatars (useOthers) + cursors (CollaborationCursor, per-uid color). Auth via `/api/liveblocks-auth` (reuse @vistamar requireAuth). Sync Meeting: flush edits on dialog open + presence-aware warn-before-apply (admin-only). **Andy to provide Liveblocks account → public key (VITE_) + secret key (Vercel env).** Write the full spec when we return to this.
- **[✅ DONE 2026-06-02 — shipped + prod-verified, see Tasks]** Sync Meeting AI must NEVER rename existing topics — **hard rule**. Existing topic titles are canonical (user-editable only). Today there's NO topic identity: model emits `name` freely + applyUnified destroys/recreates wholesale → AI renames/merges/splits every run. Fix: structural title-lock (see Tasks).
- New Item allowed when ANY org pill OR "All" is selected → small modal "Create a new Item for which Organization?" (dropdown) so you can create cross-org items from any view.
- Microsoft Teams "Join Meeting" buttons are all broken — fix them.
- Deprecate Pre-Brief entirely (delete all vestiges) → replace with a real clickable HTML Table of Contents of the Topic Cards; build in Overview view first (most important), defer/maybe-skip Working view.
- **[P2]** Sync Meeting AI: remove the gate that blocks creating a new Task when it fits no existing category — allow no-category (still Status='AI Gen' on the board) instead of blocking.
- Sync Meeting review modal: make the Project Board confirmation section look/work exactly like the Mini Project Boards (familiar UI; work the board directly in the approval stage) — keep the Notes display.
- Hard gate: NO discussing client invoicing in a meeting agenda; invoicing topics go on the (private) Vistamar Project Boards only.
- Verify seo@vistamarconsulting.com's Fireflies auto-joins every meeting where meetings@ is organizer.
- **[P3]** Client Settings: populate monthly deliverables + special notes (Andy to source from contracts/bosses) → every meeting gets a staple "Content" topic the Sync Meeting AI always focuses on (where deliverables stand, plan needed?). NEEDS heavy brainstorm.
- Add Andy's work email as a Sync Meeting data source — pull emails over the window, intelligently match correspondence per client, cross-reference Content deliverables ↔ agendas ↔ Fireflies ↔ emails. Needs backend prompting design.
- Create a distinct, eye-catching favicon for the site — brainstorm with the open browser.

### Carried-forward deferred (from v0.2.4 close)
1. Agenda rich-text Phase 1: verify status of docx→HTML population of the 5 real agendas (was BLOCKED on agenda-doc matching — Andy decision).
2. Sync Meeting MASTER: `buildSystem` boardScope prompt wrong for master (creates should route per-client-org); master Working-view per-topic-org scoping not fixed.
3. Org Settings polish: nameless members show email twice; directory captured non-person resource calendars (e.g. "Master Calendar - C-Suite"); full org-identity CRUD (rename/color/type/archive).
4. Pre-Brief structured redesign + interactive checkboxes (per-topic checklist: title + hard due date + this-week reminder + checkbox → fade unchecked).
5. Overview first-name attendee pills (clickable, highlight every agenda line mentioning that name).
6. Slice D — master prompt editor in Settings → AI Integration (add "Master" scope chip editing `aiPrompts/master`).
7. Fireflies: finish mapping ambiguous/duplicate titles; dedupe base+`_R` agenda docs; preview env var for `VITE_FIREFLIES_KEY`; re-auth `personal-gmail` MCP.
8. Postmark relay delivery bug: returns `sent:1` but mail never arrives at VM Gmail; `relay-mail.js` only checks `res.ok`, ignores Postmark `ErrorCode`. Affects send-prep + send-schedule. (Custom-note email feature was dropped.)
9. V1 finish audit: enumerate remaining V1 spec items + close what's in scope.
10. Blaze-gated items: Firebase Storage init; auth onCreate trigger; task file uploads.
11. Editable task-suggestion prompt (was hardcoded; superseded by Sync Meeting — verify relevance).
12. AIGenDialog/summary: Vistamar-target gen mislabels "X client, 0 Vistamar internal" (wording only).
13. Soft-delete / "confirm before delete topic" guard — topic deletes are HARD deletes, no trash, one agenda doc per series (no recovery source).
14. Job-title display (sec.Users + pm.Members lacked Job_Title — don't display Member_Role until it lands).
15. Migration cleanup: delete migrated legacy `talkingPoints`/`notes`/`openFloor` subcollections.

---

## Tasks (this session)

### Sticky Topic Titles (Sync Meeting) — SPEC + PLAN DONE, ready to build
Hard rule: AI Sync Meeting must never rename existing topics; titles canonical (user-editable only). Approach: topic identity via `ref` (Firestore doc id) round-tripped through the model; at apply, a `ref`'d topic keeps its Firestore `name` (model name discarded — structural lock); review modal shows Retained/New/Dropped diff. AI may still reorder/drop (human-reviewed). Destroy-recreate kept (keeps collab slice's clean reset).
- **Spec:** `docs/superpowers/specs/2026-06-02-sync-meeting-sticky-topic-titles-design.md` (reviewer-APPROVED iter 2, commit 9017682).
- **Plan:** `docs/superpowers/plans/2026-06-02-sync-meeting-sticky-topic-titles.md` (reviewer-APPROVED iter 2).
- **✅ SHIPPED + PROD-VERIFIED 2026-06-02.** Commits `9885202`→`eb44dd8` (7), pushed `origin/dev`, deploy `7zz0mzxc9` Ready, prod alias repointed. Built via subagent-driven-development (3 units, each spec+quality reviewed; final holistic review APPROVED, all 6 ref-traces clean). 41/41 vitest. Implementation: `ref` (existing topic Firestore doc id) round-trips dialog→prepare/refine→reshape→normalizeTopicRefs→applyUnified; apply discards model name for ref'd topics (structural lock); SyncMeetingDialog shows Retained/New/Dropped chips.
- **Prod verification (GV – Biweekly, authed Profile 10):** Generate → all 6 existing topics chip "· Retained" with EXACT titles, ref round-trip confirmed. **Adversarial:** Refine "rename Blog Production → Content & Blog Pipeline" → proposal STILL showed "Blog Production" in both the diff chip AND the agenda heading — model obeyed the no-rename rule even under explicit pressure; apply-side lock is the backstop (verified by code review, not observed firing since the prompt held). Discarded — zero data mutation.
- **Minor (known, deferred unless Andy wants it):** the review PREVIEW renders the model's proposed `name`; if the model ever DID ignore the rule and rename, the preview would briefly show the wrong name while apply still keeps the original (data always protected). Could override the preview to show the canonical/locked title for retained topics. Not built (scope).
- **Observation for backlog #7:** GV – Biweekly already has a "Reporting & Invoicing" topic on a CLIENT agenda — exactly what the invoicing-gate backlog item targets.

## Files Modified

- `dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/context.md` — created (this file)
- `dev/SESSION_INDEX.json` — new active entry added
