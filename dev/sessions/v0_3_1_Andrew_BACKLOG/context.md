# Session: SES-20260602-Andrew-v0.3.1-backlog

- **Session ID:** SES-20260602-Andrew-v0.3.1-backlog
- **Developer:** Andrew
- **Date:** 2026-06-02 (kickoff)
- **Version Start:** v0.3.1
- **Version End:** (pending)
- **Commit Start:** 434d2b8
- **Branch:** main (push target: `origin/dev` via `git push origin main:dev`)
- **Folder:** dev/sessions/v0_3_1_Andrew_BACKLOG/
- **Status:** CLOSED 2026-06-04 (see SESSION CLOSE at bottom)

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

`git push origin main:dev` does NOT auto-promote the prod alias. Two deploy paths used this session:
- `git push origin main:dev` → builds a Production deployment, then `vercel alias set <deploy>.vercel.app vm-management-front-end.vercel.app` (the alias step is auto-DENIED for Claude unless an allow rule exists; Andy runs it or it's allowlisted).
- `npx --yes vercel deploy --prod` (allowlisted exact command) → builds from local source with CURRENT env AND auto-promotes the prod alias in one step. **This is what finally worked** for the collab key fix. NOTE: `vercel redeploy <url>` reuses the SOURCE deploy's env snapshot (it did NOT pick up the new key) — use `vercel deploy --prod` for env changes.
**Current prod alias → `mka8mzc3i`** (collab RESTORED: correct `sk_dev_` Liveblocks key + content-based heal + bounded room ids). Team must **hard-refresh** to pick up a build.

## Collab guardrails (heed when touching collab/verifying)

- `[[reference_yjs_vite_dedupe]]` — collab editing needs `resolve.dedupe['yjs']`; dual-Yjs bug =
  presence syncs but doc silently doesn't, with zero console errors.
- `[[feedback_verify_collab_isolated_profiles]]` — same-browser tabs false-positive via y-indexeddb;
  use TWO isolated profiles; agent-browser is headless by default (`--headed` for human login);
  hard-refresh all browsers after deploy.

---

## Backlog (carried from v0.3.0 backlog-triage close — #1 agenda-collab DONE)

- **🔴 HIGH — collab single-writer seed guard (NOW PROVEN-NEEDED, not theoretical).** The
  content-based reseed's duplicate-on-simultaneous-first-open window BIT US 2026-06-03: the Biweekly
  agenda's fresh room was opened in TWO windows at once → both seeded from Firestore → Yjs merged →
  DOUBLED content (and two cards showed "asd" test text). Fix: elect a single writer before seeding
  (e.g. only the lowest `ydoc.clientID` among current `yProvider.awareness` states seeds; re-run on
  awareness change + a short settle delay). MUST be content-based-safe (never a durable "seeded" flag —
  that caused the earlier blank-display incident). Only affects FIRST seed of an empty room. See
  CollabBodyEditor `reconcile`. Also: remove unused `seedDocPath`/`seedFlagField` props.
- **Rest of #1** — Board / mini-board presence (presence-only, reuses Liveblocks client + auth
  endpoint, no Yjs).
- **#2** New Item from any org pill / "All" → small "Create a new Item for which Organization?" modal
  (dropdown) so you can create cross-org items from any view.
- **#3** Fix broken MS Teams "Join Meeting" buttons (all broken).
- **#4 [📋 SPEC + PLAN APPROVED — NOT YET BUILT; build was interrupted by the collab emergency]**
  Deprecate Pre-Brief entirely → clickable HTML Table of Contents of the Topic Cards (Overview first).
  Plan Task 1 (server-AI Pre-Brief removal) was committed `44e7f77` then **REVERTED `2f64228`** during
  the emergency so the collab-fix deploys stayed clean — so **nothing from the plan is on main; start
  fresh from Task 1.** Spec + plan are valid + reviewer-approved. See ## Tasks + the fresh-session prompt
  in SESSION CLOSE.
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

### #4 — Pre-Brief deprecation → live Agenda TOC (Overview) — SPEC + PLAN APPROVED, NOT BUILT
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

---

## ════ COLLAB EMERGENCY — 2026-06-03 (all-day incident, RESOLVED) ════

**What happened:** mid-way through starting #4 (TOC), Andy reported the Unio **Biweekly Marketing
Updates** agenda showed all topic bodies BLANK. It escalated into an all-day collab outage.

**TRUE root cause (after several wrong turns):** the Vercel env var `LIVEBLOCKS_SECRET_KEY` had been
set to an `sk_live_…` (Liveblocks **production**) key ~17h prior, but the Liveblocks app is the
**development** environment (`sk_dev_…`). A live-env token can't reach dev-env rooms → Liveblocks
rejected every room with **`4001 "You have no access to this room"`** → all collab topic bodies
rendered blank. **NOT data loss** (Firestore `bodyHtml` was intact throughout; the pre-collab build
that reads Firestore directly always showed content). **NOT the seed code** (my first wrong guess).
Diagnosis nailed by decoding the minted token (valid `agenda:*` write, project `6a1f8b…`) → proved
our code/token were correct → pointed at the Liveblocks key. Andy's dashboard confirmed: Vercel had
`sk_live_a12…`, dashboard dev secret = `sk_dev_sHMNC_…`.

**THE FIX (what restored collab):** replaced Vercel `LIVEBLOCKS_SECRET_KEY` (Production) with the
dev `sk_dev_…` key (removed the sensitive var + re-added via CLI; Preview add hit a CLI prompt quirk
— **Preview scope still NOT set, deferred**), then `npx vercel deploy --prod` (fresh build picks up
new env + auto-aliases). Collab verified working by Andy: two real users on Review/GMB agenda, live
cursors + sync. Prod = `mka8mzc3i`.

**Secondary bug — over-long room id:** the Biweekly agenda has a 181-char Firestore doc id; its room
`agenda:<id>` (188 chars) still 4001'd even after the key fix (188 < Liveblocks' 256 cap, so length
wasn't the literal cause, but a fresh normal-length room connects fine like every other agenda). Fix
shipped: `src/lib/agendaRoom.js` `agendaRoomId()` — normal ids pass through unchanged; an over-long id
(>100 chars) maps to a stable bounded hashed room id. Wired into AgendaDetail RoomProvider (was the
only `agenda:${agendaId}` site, line ~1761). Unit-tested. Commit `6b8344e`.

**Tertiary bug — the doubling:** giving Biweekly a fresh room made collab connect, but Andy had it
open in TWO windows → the content-based reseed raced → BOTH seeded → Yjs DOUBLED the content; two
cards (CyberKnife, Acquisitions) showed "asd" test text (real content had been overwritten by test
typing earlier today, mirrored to Firestore — NOT recovered, Andy's call). Recovery: deleted the
Liveblocks room via REST API (`DELETE /v2/rooms/<encoded roomId>` with the sk_dev key, 204), Andy
reopened single-window → reseeded; residual Firestore dupes Andy trimmed by hand. **This is the
proof the single-writer seed guard is needed (now 🔴 HIGH in Backlog).**

**Commits this session (on `main`, deployed in `mka8mzc3i`):**
`bf6ee7a` collab content-based heal (fragmentHasRealContent, not fragment.length) + tests;
`2f64228` revert of `44e7f77` (server-AI Pre-Brief removal — kept the deploy collab-only);
`6b8344e` bounded agenda room ids + tests.
Also on main (NOT mine — Andy's parallel work, in the deploy): `121d02c` guests dropdown from org
members, `0b41451` allow VM-domain emails in Vistamar org.

**New collab learnings → memory:** [[reference_liveblocks_dev_key]] (sk_dev vs sk_live env gotcha +
the 4001 signature + the deploy-vs-redeploy-env gotcha + REST-API room reset).

## Files Modified (this session)

- `src/components/editor/collabSync.js` — `isBlankContent`, `fragmentHasRealContent`, `decideSeedAction`
- `src/components/editor/CollabBodyEditor.jsx` — content-based self-healing reseed (valueHtml dep)
- `src/components/editor/__tests__/collabSync.test.js` — seed-logic tests (+ empty-`<paragraph/>` regression)
- `src/lib/agendaRoom.js` (NEW) + `src/lib/__tests__/agendaRoom.test.js` (NEW) — bounded room ids
- `src/pages/AgendaDetail.jsx` — use `agendaRoomId(agendaId)` for the RoomProvider
- `api/ai/{prepare,refine,generate}.js` — Pre-Brief removal applied then REVERTED (back to original)
- `docs/superpowers/specs/2026-06-03-prebrief-deprecation-agenda-toc-design.md` (TOC spec)
- `docs/superpowers/plans/2026-06-03-prebrief-deprecation-agenda-toc.md` (TOC plan)
- `dev/sessions/v0_3_1_Andrew_BACKLOG/context.md`, `dev/SESSION_INDEX.json`

## New deferred items (this session)
- **🔴 collab single-writer seed guard** (see Backlog top — proven-needed).
- **Preview-scope `LIVEBLOCKS_SECRET_KEY`** not set (CLI `vercel env add … preview` prompt quirk). Prod
  is set + correct; Preview deployments won't have working collab auth until added. Add via dashboard
  or fix the CLI invocation.
- **Biweekly Marketing Updates 181-char doc id** is a data anomaly (every other agenda id is ~20–43
  chars). Root-cause it (how was such an id created?) and consider migrating that doc to a normal id;
  `agendaRoomId()` is the band-aid that makes collab work meanwhile.
- CyberKnife + Acquisitions cards on Biweekly: real text lost to test-typing today; NOT recovered (Andy
  OK with it). Version history (`AgendaHistoryDialog`, clock icon) exists if ever needed.

## ════ SESSION CLOSE — 2026-06-04 ════

**Net outcome:** Started #4 (Pre-Brief→TOC) — spec + plan written + reviewer-approved, build NOT
started. An all-day **collab outage** (wrong Liveblocks key) interrupted it and consumed the session.
**Collab is RESTORED** (correct `sk_dev_` key + bounded room ids + content-based heal; prod `mka8mzc3i`,
verified by Andy with two real users + live cursors). No data lost (Firestore canonical throughout).

**Where things stand:**
- **Prod:** `vm-management-front-end.vercel.app` → `mka8mzc3i`. Collab works. Team hard-refresh to get it.
- **#4 TOC:** ready to build from the approved plan — `docs/superpowers/plans/2026-06-03-prebrief-deprecation-agenda-toc.md` (spec alongside it). Start fresh from Task 1 (the one committed Task-1 was reverted).
- **🔴 Top follow-up:** collab single-writer seed guard (doubling prevention) — do this BEFORE more collab use with concurrent first-opens.
- **Backlog:** the `## Backlog` section above (#2–#11 + carried deferred + this session's new deferred) is the master to-do list.

**Status:** CLOSED.
