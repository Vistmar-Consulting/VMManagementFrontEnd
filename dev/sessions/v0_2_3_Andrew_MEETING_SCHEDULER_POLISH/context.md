# Session: SES-20260529-Andrew-v0.2.3-meeting-scheduler-polish

- **Session ID:** SES-20260529-Andrew-v0.2.3-meeting-scheduler-polish
- **Developer:** Andrew
- **Date:** 2026-05-29 (kickoff)
- **Version Start:** v0.2.3 (umbrella; slices use v0.2.3.{a,b,c,…})
- **Version End:** (pending)
- **Commit Start:** ff57a42
- **Branch:** main (push target: `origin/dev` via `git push origin main:dev`)
- **Task:** Continuation of Meeting Scheduler / Meeting Agenda work — small refinements and bug fixes, not big features. Carries forward live deferred items from the closed V2 session.
- **Folder:** dev/sessions/v0_2_3_Andrew_MEETING_SCHEDULER_POLISH/
- **Status:** active

## Source-of-Truth Docs (read order)

1. `CLAUDE.md` (project) + `~/.claude/CLAUDE.md` (global) — non-negotiable conventions
2. `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` §4 + §7 — data model + V2 sketch
3. `docs/superpowers/specs/2026-05-20-meetings-v2-design.md` — **OUTDATED** (asserts Google-only; superseded twice). Useful for FE surfaces (§6) + phased build order (§9) as historical reference. Reconcile pending (see Deferred).
4. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/` — Vercel functions ported from here
5. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/Agenda.jsx` (6,475 lines) — Console meetings UI; FE port reference
6. `docs/MEETING_AGENDAS_PAGE_REFERENCE.md` + `docs/AGENDA_DETAIL_PAGE_REFERENCE.md` — canonical design specs Andy authored for the V2 ports (must-match-verbatim)
7. `api/meetings/_lib/google-calendar.js` + the prior session's V2.2.2b.7 section — current source of truth on invite-fanout architecture (Google fans `.ics` via `sendUpdates:"all"`, Graph mirrors silently). Retires the 2026-04-28 m365-primary design doc.

**Prior session archive:** `dev/sessions/v0_2_0_Andrew_MEETING_SCHEDULER/context.md` — full V2 build history + V2.2.2b.7 fan-out verification table + final architecture.

**Memory pointers that matter here:**
- `project-v2-meeting-scheduler-direction` — dual-write architecture (Graph mints event + Teams binding silently, Google fans `.ics`)
- `project-v3-ai-feature-intent` — Fireflies + agenda → AI Gen items (V3)
- `feedback-port-faithfully-check-source` — V2 is a port, not a rebuild; read archive first
- `feedback-keep-management-lean` — never re-add anything in spec's dropped-deps list
- `project-explicit-send-invite-button` — staged Send Meeting Invite, separate from Send menu + Manage Guests Save
- `feedback-no-lazy-deferrals` — fix small UX/a11y/correctness flaws inline

## Final V2 Architecture (carried from prior session — do not re-litigate)

Google Workspace `meetings@` Calendar API is the canonical invite-fan source via `sendUpdates:"all"`. Microsoft Graph still mints the calendar event row + Teams `joinUrl` (needed for `conferenceData` on the Google mirror) but is **silent** on the email side — the M365 `meetings@` mailbox has no email send rights in our tenant. Verified end-to-end against production 2026-05-29 across CREATE / RESCHEDULE / CANCEL; ATTENDEE-ADD confirmed at API + Google-roster level (direct inbox confirmation deferred on `personal-gmail` MCP reauth).

Backend lives in **Vercel API routes** (`api/meetings/*`), NOT Firebase Functions. Secrets via Azure VistamarVault (`AZURE_KV_*` env vars), NOT GCP Secret Manager.

## Deferred (live tracker — carried forward from closed V2 session)

### Open V2 items (active candidates this session)

- ~~**AgendaHero field-name bug**~~ — ✅ FIXED in v0.2.3.a (see Tasks above). Was not a one-line field swap; root-cause fix decoupled the Hero's boundness gate from `m365EventId` and aligned it with the canonical `isBound` used everywhere else. Verified live (15/33 agendas were affected). In working tree, **not yet pushed**.
- **V2.2.2h Past Meetings (Fireflies) card** — last user-visible piece of the Working-view sidebar per `AGENDA_DETAIL_PAGE_REFERENCE.md` §4.6. Surfaces prior occurrences with Fireflies transcript links under Open Floor. Optional; agenda fully usable without it.
- **Reconcile 2026-05-20 V2 design spec** — `docs/superpowers/specs/2026-05-20-meetings-v2-design.md` still asserts Google-only architecture (superseded twice). Needs a SUPERSEDED header + one-line pointer to the current model in `api/meetings/_lib/google-calendar.js` + the prior context.md's V2.2.2b.7 section.
- **Rewrite V2 plan for Vercel + Azure KV direction** — `docs/plans/2026-05-27-meeting-scheduler-port.md` drafted under Firebase Functions + GCP Secret Manager assumptions. Data model + FE surface sections survive; ops sections need a full rewrite. Not blocking, should land before any new V2 contributor onboards.
- **Re-authorize `personal-gmail` MCP** — returned `invalid_grant` throughout V2.2.2b.7 verification, blocked direct confirmation that newly-added attendees receive the initial `.ics` in personal Gmail. Reauth via `/mcp`.

### V2 follow-ups (carried)

- **`agenda-email.js` user-facing string** — has "View full agenda in Console" link. Update when porting send-prep + send-schedule (V2.4 area).
- **Backend auth presence-only on V2.1-live endpoints** — `_lib/auth.js` upgraded to Firebase ID token verify in V2.2.2b; largely closed. Verify `reschedule.js` + `list.js` got the upgrade; if not, propagate.

### V1 polish (mostly closed, residue) — raise only if Andy does

Firebase Storage init (Blaze-gated); auth-onCreate trigger (Blaze); Project Board DnD reorder; `useItems` server-side pagination; `isDueThisWeek` tz-implicit; Members/Settings stub pages; KanbanBoard dead route; MUI-prefix import convention; vitest counter test; `useCallback` wraps in TaskBoard; date-picker keyboard nav.

### V3 / Far-Future

AI-driven Project Board updates (Fireflies + agendas → statusId 8 AI Gen items); Task file uploads (Blaze); SQL migration script.

## Tasks

### v0.2.3.a — AgendaHero reschedule/schedule boundness gate ✅ (shipped to working tree, not yet pushed)

**Root cause (verified, not the note's framing):** `AgendaHero` gated `canReschedule` on `m365EventId = agenda.graphEventId || calendarSeries?.graphEventId` (`AgendaDetail.jsx:153/165`). But `calendar_series` docs reliably carry `graphSeriesEventId` (set in BOTH `reconcileMeetings.js:50` and the create dialogs); the `graphEventId` field is only set on the reconcile path and only when `m365EventId` is present — frequently null under the Google-primary architecture. Every other boundness check in the app uses `agenda?.graphEventId || calendarSeries?.graphSeriesEventId` (ActionBar `:804`, `CancelMeetingDialog:39`, `ManageGuestsDialog:41`). The Hero was the lone divergence. `RescheduleDialog` never reads `m365EventId` (it reschedules via `series_id`/`event_id`), so the field served only as the gate.

**Fix:** Decoupled the gate from `m365EventId`. Added `isBound = !!(agenda?.graphEventId || calendarSeries?.graphSeriesEventId)`; `canReschedule = isBound && date`; `canScheduleCreate = !isBound` (was `!canReschedule` — also hardens against minting a duplicate on a bound-but-dateless agenda). Left line 153 `m365EventId` as-is (honest value, now unused by behavior). `AgendaDetail.jsx:165-180`.

**Verification (live, against production Firestore):**
- Build passes (`npm run build`, only pre-existing 500kB chunk warning).
- Live Firestore query (authed browser): **15 of 33 agendas** exhibited the bug — all signature `agEvt:false, csSeries:true, csEvt:false`. Real recurring meetings: Unio Weekly Marketing, Biweekly Marketing Updates, Vistamar Platform Development, BMD Marketing, Marketing-Integration Updates, etc. The 18 non-bug agendas (`agEvt:true`) are unaffected (old:true→new:true).
- A/B on "Unio Weekly Marketing" (`0u55qjoteslnrjsmftmlinea7i_R20260407T200000`): **production (old)** schedule row = dashed copper `rgb(184,115,51)` + copperFaint bg + copper text (= mint-new state, duplicate risk); **localhost (fixed)** = solid transparent border + ink3 text (= reschedule state), and clicking opens the Reschedule dialog.
- No regression: known-good "VM-Weekly-Business-Dev" (`agEvt:true`) still shows/opens reschedule on both.

**Tangential observation (NOT fixed — flagging only):** `fred@fireflies.ai` renders as an attendee chip on the Unio agenda. Silent-proxy filter only strips `meetings@`/`seo@`; the Fireflies bot under `@fireflies.ai` isn't filtered. May be intentional or a gap — raise separately if it should be hidden.

### v0.2.3.b–g — Fireflies Past Meetings + management page (V2.2) — IN PROGRESS

**Plan:** `docs/plans/2026-05-29-fireflies-past-meetings-port.md` (read end-to-end; all 5 sanity questions verified against archive). **Note:** brief says add to closed `v0_2_0` session — overridden per Andy 2026-05-29 to use this active `v0.2.3` session.

**Decisions (Andy-confirmed 2026-05-29):**
- Lookup model: **Option 1** — `firefliesTitles: string[]` on the agenda doc (the array IS the historical-title→agenda lookup table; titles drifted over time, will be stable going forward).
- Build the **Browse-recent-titles picker** (not skipped) — helps find historical aliases.
- Theme: reuse existing copper/cream `t` palette (was NOT dropped; inline at `AgendaDetail.jsx:73`) — extract to `src/theme/tokens.js`.
- Card placement: **below Open Floor, main column, BOTH Working + Overview views** per `AGENDA_DETAIL_PAGE_REFERENCE.md` §4.6/§5 — overrides brief's "right rail".
- Hide card when zero mappings; same title may repeat across agendas; no org chip on card.
- **Case-INSENSITIVE** title match (deviation from archive's `Set.has()`) — historical titles hand-entered.
- **fred@fireflies.ai** added to the FE silent-proxy render filter (it currently renders as a chip — confirmed on Unio agenda). Rendering-layer only; never strip from data.
- **NEW (Andy):** a Fireflies **management page under the Calendar nav tab** to view all Fireflies meetings + map them to agendas. Overrides brief's "no separate page" rule. DESIGN before building (task #7).

**seo@ bot auto-invite/auto-join:** `withSilentProxies()` (api/meetings/_lib/attendee-helpers.js) already prepends seo@ to every created event. Auto-JOIN-under-seo@-not-Cedric's-ctucksherman@ is **Fireflies-workspace config** (not code) — separate investigation slice, not blocking the port.

**Key validated 2026-05-29:** `VITE_FIREFLIES_KEY` in `.env.local`; curl probe returned real transcripts (Unio Weekly Marketing Meeting, Vistamar Platform Development updates, etc.). Still TODO: Vercel prod+preview envs.

**Tasks:** #2 fireflies lib + tokens · #3 MeetingDetailModal · #4 PastMeetingsCard + wire · #5 mapping editor + fred@ filter · #6 Vite proxy + Vercel env · #7 management page (design first).

### v0.2.3.i — Recurring cards collapsed to one instance (wrong Next date + order) ✅

**Symptom (Andy):** recurring meeting cards not ordered by next-upcoming; weekly/biweekly "Next" dates wrong (VM - Weekly Business Dev → Aug 21).

**Root cause (systematic-debugging, confirmed by code + live data + failing test):** `api/meetings/_lib/google-calendar.js` `listEventsAcrossSubjects` deduped events across the 3 impersonated calendars (meetings@, Tate, Cedric) keyed on `iCalUID || series_id || event_id`. Google gives every expanded instance of a recurring series the **same iCalUID**, so dedup collapsed all instances → 1 per series. The replace-if-organizer branch overwrote in chronological order → organizer-matched series kept their **last** in-window instance (Aug dates); non-organizer series kept their **first** (already-past) instance. Cards sorted by those wrong dates; cadence labels vanished (instanceCount → 1). Live prod cards confirmed: all "RECURRING" with no cadence, dates scattered Apr 29 / May 6 / Aug 6/18/21/24.

**Fix:** dedup key now appends the instance start (`${base}::${ev.date}`) — same instance across calendars still dedupes; distinct occurrences stay separate. Extracted the dedup into pure, unit-tested `api/meetings/_lib/dedupe-events.js` (failing test pre-fix → passes after); dropped dead `fallbackOrder` tracking. Ordering + cadence labels fixed by the same change (groupRecurringMeetings already sorts by nextDate).

**Commit `35c700c`** → origin/dev (API-only). First unit test in the repo (`__tests__/dedupe-events.test.js`, run via `npx vitest run`). **PROD-VERIFIED 2026-05-29:** cards now show cadence labels (WEEKLY/BIWEEKLY) + near-term next dates in chronological order (Jun 1/2/2/3/3…); VM - Weekly Business Dev → Jun 5 (was Aug 21), Vistamar Platform Dev → Jun 4 (was Aug 6).

**Minor observation (not fixed):** detectCadence labeled "ID Care - Biweekly" as WEEKLY — it's a heuristic on instance count over the window; cosmetic, pre-existing, out of scope.

## Files Modified

- `dev/sessions/v0_2_3_Andrew_MEETING_SCHEDULER_POLISH/context.md` — created (this file)
- `dev/SESSION_INDEX.json` — V2 entry confirmed `closed`; this entry added `status: active`
- `src/pages/AgendaDetail.jsx` — v0.2.3.a AgendaHero boundness-gate fix (lines ~165-180)
- **v0.2.3.b–f Fireflies (in progress, NOT committed):**
  - NEW `src/theme/tokens.js` — hoisted shared copper/cream `t` palette
  - NEW `src/lib/fireflies.js` — firefliesQuery + 3 GraphQL queries + timestamp helpers (verbatim)
  - NEW `src/components/firefliesStyled.js` — ShimmerBar + MiniPill (emotion styled)
  - NEW `src/components/MeetingDetailModal.jsx` — ported verbatim (archive 2861-3468)
  - NEW `src/components/PastMeetingsCard.jsx` — ported; case-insensitive title match; section chrome matches Open Floor
  - `src/pages/AgendaDetail.jsx` — import `t` from tokens + PastMeetingsCard; mounted below Open Floor in BOTH views (guarded by firefliesTitles)
  - `src/lib/meetingHelpers.js` — added `fred@fireflies.ai` to silent-proxy render filter
  - `vite.config.js` — `/fireflies-api` dev proxy (always on; Vite auto-restarts)
  - `.env.local` (gitignored) + `.env.example` — VITE_FIREFLIES_KEY
  - **Verified:** build green; Fireflies plumbing works in-app via dev proxy (read-only probe returned real transcripts). **Not yet verified:** card rendering on an agenda (needs firefliesTitles via the real mapping UI — pending management-page design/approval; agent-initiated production Firestore write correctly blocked).
  - **SHIPPED + PROD-VERIFIED (2026-05-29):** commit `0e14ef6` pushed to origin/dev; `VITE_FIREFLIES_KEY` added to Vercel Production; redeployed (`ay02t1xox`, aliased to vm-management-front-end.vercel.app). Production hard gate passed: /fireflies renders 16 real titles with mappings reflected (proves baked key + direct api.fireflies.ai call works, no dev proxy); Past Meetings card renders on the prod Unio agenda.
  - **Vercel env (2026-05-29):** `VITE_FIREFLIES_KEY` added to **Production** via CLI; latest prod deploy redeployed to bake it in. **Preview scope NOT set** — Vercel CLI 50.37.0 non-interactive `env add ... preview` kept returning `git_branch_required` even with `--value --yes`; minor follow-up, not needed for the origin/dev→production flow. When V2.2 re-adds the agenda-update field denylist, `firefliesTitles` must be allowlisted.
- **v0.2.3.g Fireflies management page (in progress, NOT committed):**
  - NEW `src/pages/FirefliesMeetings.jsx` — title-centric: lists unique Fireflies recording titles (count + date range), maps each → agenda via inline Autocomplete (arrayUnion/arrayRemove on `agenda.firefliesTitles`), unmapped-only filter, search, load-more, row→MeetingDetailModal preview. Sole mapping UI (no per-agenda editor, Andy call).
  - `src/routes.jsx` — `/fireflies` route
  - `src/components/Sidebar.jsx` — "Fireflies" top-level tab (lucide Captions icon)
  - **Decisions (Andy):** own top-level sidebar tab (not nested); title-centric; group by unique title; Fireflies page is the only mapping surface.
  - **Verified:** build green; page renders 10 real unique titles w/ counts + date ranges; Map autocomplete opens + lists real agendas; load-more + search + unmapped filter render.
  - **END-TO-END VERIFIED (2026-05-29):** Andy authorized mapping. Mapped the 9 unambiguous exact (single-doc) matches via direct Firestore arrayUnion write; confirmed PastMeetingsCard renders on the Unio agenda ("PAST MEETINGS · 10") and MeetingDetailModal opens with real Overview/Action Items/Topics/timestamps. Full loop works.

**Fireflies title → agenda mappings (production data, 2026-05-29):**
- MAPPED (9, exact single-doc): Vistamar Platform Development updates · Unio Weekly Marketing Meeting · VM Weekly Touch Base · Biweekly Marketing Updates · June Content Strategy · May Content · Andy + Cedric — Claude Code & SQL MCP Setup · ID Care – Marketing Committee · GV – Biweekly
- LEFT FOR ANDY (ambiguous — duplicate agenda docs with same title [base + _R instance], or near-misses): GV-Vistamar Bi-Weekly Mtg (2 docs) · BMD Marketing (2 docs) · BMD - Biweekly (2 docs) · ID Care - Biweekly (2 docs) · ID Care – Biweekly (en-dash; agendas use hyphen) · VM - Business Dev (≈ "VM - Weekly Business Dev") · ID Care · Vistamar/Balance Marketing Weekly Update · Tate SOP Discusssion · MB Rotary Long-Term Planning Committee · Long-Range Planning Committee Mtg.
- Side note surfaced: several agendas exist as duplicate base+`_R<instance>` docs (recurring artifact) — worth a cleanup pass; ambiguity is why those titles were left unmapped.
