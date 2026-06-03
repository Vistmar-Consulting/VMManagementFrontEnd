# Session: SES-20260602-Andrew-v0.3.1-backlog

- **Session ID:** SES-20260602-Andrew-v0.3.1-backlog
- **Developer:** Andrew
- **Date:** 2026-06-02 (kickoff)
- **Version Start:** v0.3.1
- **Version End:** (pending)
- **Commit Start:** 434d2b8
- **Branch:** main (push target: `origin/dev` via `git push origin main:dev`)
- **Folder:** dev/sessions/v0_3_1_Andrew_BACKLOG/
- **Status:** active

## Mode

Backlog continuation from v0.3.0 backlog-triage. Andy picks ONE item; then full rigor scaled
to the work (brainstorm → spec → writing-plans → subagent-driven build, with spec/plan review
loops). Verify on **Vercel prod** (UI hard gate). For anything collaborative, verify with TWO
isolated browser profiles — never same-browser tabs (y-indexeddb false-positive). Keep this
backlog live (added / in-progress / done). **Stop at a deploy gate before any push to origin/dev.**

## Source-of-Truth Docs (read order)

1. `CLAUDE.md` (project) + `~/.claude/CLAUDE.md` (global) — non-negotiable conventions
2. **Spec (V1 scope):** `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`
3. **Prior session archive:** `dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/context.md` — sticky titles
   + live collab editing history, the collab incident + the two collab memories.

## Deploy reminder

`git push origin main:dev` does NOT auto-promote the prod alias. After each deploy:
`vercel alias set <new-deploy>.vercel.app vm-management-front-end.vercel.app`.
**Current prod alias points at `o8v2v9mu7`** (sticky titles + live collab editing, collab ON +
data-safe). Team must **hard-refresh** to pick up a new build.

## Collab guardrails (heed when touching collab/verifying)

- `[[reference_yjs_vite_dedupe]]` — collab editing needs `resolve.dedupe['yjs']`; dual-Yjs bug =
  presence syncs but doc silently doesn't, with zero console errors.
- `[[feedback_verify_collab_isolated_profiles]]` — same-browser tabs false-positive via y-indexeddb;
  use TWO isolated profiles; agent-browser is headless by default (`--headed` for human login);
  hard-refresh all browsers after deploy.

---

## Backlog (carried from v0.3.0 backlog-triage close — #1 agenda-collab DONE)

- **Rest of #1 + collab hardening** — Board / mini-board presence (presence-only, reuses Liveblocks
  client + auth endpoint, no Yjs). Collab hardening: Yjs-doc single-writer seed marker (replace
  content-based reseed's tiny duplicate-on-simultaneous-first-open window with a Y.Map "seeded" set
  in the same txn as setContent); remove unused `seedDocPath`/`seedFlagField` props on CollabBodyEditor.
- **#2** New Item from any org pill / "All" → small "Create a new Item for which Organization?" modal
  (dropdown) so you can create cross-org items from any view.
- **#3** Fix broken MS Teams "Join Meeting" buttons (all broken).
- **#4 [🔨 IN PROGRESS — spec + plan reviewer-APPROVED, building]** Deprecate Pre-Brief entirely
  (delete all vestiges) → clickable HTML Table of Contents of the Topic Cards; build in Overview view
  first, defer Working view. See ## Tasks.
- **#5 (P2)** Sync Meeting: remove the gate that blocks creating a new Task when it fits no existing
  category — allow no-category (still statusId 8 / AI Gen on the board) instead of blocking.
- **#6** Sync Meeting review modal: make the Project Board confirmation section look/work exactly like
  the Mini Project Boards (work the board directly in the approval stage) — keep the Notes display.
- **#7** Hard gate: NO discussing client invoicing in a meeting agenda; invoicing topics go on the
  (private) Vistamar Project Boards only. (Observed: GV – Biweekly already has a "Reporting & Invoicing"
  topic on a CLIENT agenda — exactly what this targets.)
- **#8** Verify seo@vistamarconsulting.com's Fireflies auto-joins every meeting where meetings@ is organizer.
- **#9 (P3)** Client Settings: populate monthly deliverables + special notes → every meeting gets a
  staple "Content" topic the Sync Meeting AI always focuses on. NEEDS heavy brainstorm.
- **#10** Add Andy's work email as a Sync Meeting data source — pull emails over the window, match
  correspondence per client, cross-reference Content deliverables ↔ agendas ↔ Fireflies ↔ emails.
- **#11** Create a distinct, eye-catching favicon — brainstorm with the open browser.

### Carried-forward deferred (from v0.2.4 → v0.3.0)
1. Agenda rich-text Phase 1: verify status of docx→HTML population of the 5 real agendas (was BLOCKED on
   agenda-doc matching — Andy decision).
2. Sync Meeting MASTER: `buildSystem` boardScope prompt wrong for master (creates should route
   per-client-org); master Working-view per-topic-org scoping not fixed.
3. Org Settings polish: nameless members show email twice; directory captured non-person resource
   calendars (e.g. "Master Calendar - C-Suite"); full org-identity CRUD (rename/color/type/archive).
4. Pre-Brief structured redesign + interactive checkboxes (per-topic checklist: title + hard due date +
   this-week reminder + checkbox → fade unchecked). [Overlaps #4 — Pre-Brief is being deprecated.]
5. Overview first-name attendee pills (clickable, highlight every agenda line mentioning that name).
6. Slice D — master prompt editor in Settings → AI Integration (add "Master" scope chip editing
   `aiPrompts/master`).
7. Fireflies: finish mapping ambiguous/duplicate titles; dedupe base+`_R` agenda docs; preview env var
   for `VITE_FIREFLIES_KEY`; re-auth `personal-gmail` MCP.
8. Postmark relay delivery bug: returns `sent:1` but mail never arrives at VM Gmail; `relay-mail.js` only
   checks `res.ok`, ignores Postmark `ErrorCode`. Affects send-prep + send-schedule.
9. V1 finish audit: enumerate remaining V1 spec items + close what's in scope.
10. Blaze-gated items: Firebase Storage init; auth onCreate trigger; task file uploads.
11. Editable task-suggestion prompt (was hardcoded; superseded by Sync Meeting — verify relevance).
12. AIGenDialog/summary: Vistamar-target gen mislabels "X client, 0 Vistamar internal" (wording only).
13. Soft-delete / "confirm before delete topic" guard — topic deletes are HARD deletes, no trash.
14. Job-title display (don't display Member_Role until sec.Users + pm.Members gain Job_Title).
15. Migration cleanup: delete migrated legacy `talkingPoints`/`notes`/`openFloor` subcollections.

---

## Tasks (this session)

### #4 — Pre-Brief deprecation → live Agenda TOC (Overview) — SPEC + PLAN APPROVED, building
Full deprecation (client + the 3 `api/ai/*.js` serverless fns; leave `preBriefHtml` data dormant)
+ a fully-live clickable Table of Contents of the Topic Cards in Overview. TOC = pure projection of
the reactive `topics` array (no state) → auto-reflects create/delete/reorder/rename incl. remote
collaborators (rides Firestore onSnapshot, not Yjs). Master-org-aware grouping + Open Floor entry;
native `scrollIntoView` with `scroll-margin-top` to clear the sticky toolbar; hides on empty agenda.
- **Decisions:** leave Pre-Brief data dormant; in-app only (no exported-HTML TOC); topics + master-org
  headers + Open Floor; static top block in Pre-Brief's old spot; Overview only (Working deferred);
  numbered entries; clickable org headers. **Scope expansion (Andy-approved):** include server-side
  deprecation — the `api/ai/{prepare,refine,generate}.js` fns required+generated `preBriefHtml`
  (the Explore pass + spec reviewer wrongly reported "no refs outside src/"; corrected).
- **Spec:** `docs/superpowers/specs/2026-06-03-prebrief-deprecation-agenda-toc-design.md` (reviewer-APPROVED iter 1).
- **Plan:** `docs/superpowers/plans/2026-06-03-prebrief-deprecation-agenda-toc.md` (reviewer-APPROVED iter 1; 8 tasks).
- **STOP at deploy gate** (Task 8) before any `git push origin main:dev`.

## Files Modified

- `dev/sessions/v0_3_1_Andrew_BACKLOG/context.md` — created (this file)
- `dev/SESSION_INDEX.json` — new active entry added
