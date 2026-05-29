# Session: SES-20260527-Andrew-v0.2.0-meeting-scheduler

- **Session ID:** SES-20260527-Andrew-v0.2.0-meeting-scheduler
- **Developer:** Andrew
- **Date:** 2026-05-27 (kickoff)
- **Version Start:** v0.2.0 (V1 Project Board closed out; production stable at https://vm-management-front-end.vercel.app)
- **Version End:** (pending)
- **Commit Start:** 6a067ba991f3432a6f0ee192c4b768098465c1f2
- **Branch:** main (push target: `origin/dev` via `git push origin main:dev`)
- **Task:** V2 kickoff — Meeting Scheduler + Meeting Agendas. Port Console's `Agenda.jsx` flow onto Firebase Functions + Firestore. Implements canonical-Graph + Google-mirror dual-write per 2026-05-27 HANDOFF.
- **Folder:** dev/sessions/v0_2_0_Andrew_MEETING_SCHEDULER/
- **Status:** active

## Source-of-Truth Docs (read order)

1. `CLAUDE.md` (project) + `~/.claude/CLAUDE.md` (global) — non-negotiable conventions
2. `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` §4 + §7 — data model + V2 sketch
3. `docs/superpowers/specs/2026-05-20-meetings-v2-design.md` — **OUTDATED** (asserts Google-only; superseded twice — see Deferred section below). Useful for FE surfaces (§6) + phased build order (§9) as historical reference.
4. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/` — Vercel functions ported from here
5. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/Agenda.jsx` (6,475 lines) — Console meetings UI; FE port reference
6. `docs/MEETING_AGENDAS_PAGE_REFERENCE.md` + `docs/AGENDA_DETAIL_PAGE_REFERENCE.md` — canonical design specs Andy authored for the V2 ports (must-match-verbatim)
7. `api/meetings/_lib/google-calendar.js` + V2.2.2b.7 section of this file — current source of truth on invite-fanout architecture (Google fans, Graph mirrors silently). Retires the 2026-04-28 m365-primary design doc.

**Memory pointers that matter here:**
- `project-v2-meeting-scheduler-direction` — dual-write architecture (Graph canonical, Google ICS mirror)
- `project-v3-ai-feature-intent` — Fireflies + agenda → AI Gen items (V3)
- `feedback-port-faithfully-check-source` — V2 is a port, not a rebuild; read archive first
- `feedback-keep-management-lean` — never re-add anything in spec's dropped-deps list

## V2 Scope Snapshot (per HANDOFF + 2026-05-20 spec §6/§9 for surfaces)

**Backend (`functions/src/meetings/`):**
- `create.js`, `cancel.js`, `reschedule.js`, `rename.js`, `attendees.js`, `list.js`, `send-prep.js`, `send-schedule.js` — ports from archive `api/meetings/*`
- `_lib/graph-events.js` — canonical Graph write path
- `_lib/google-calendar.js` — Google mirror write path
- `_lib/gmail-send.js` — NEW, replaces Postmark/Graph sendMail
- `_lib/auth.js` — Firebase Admin token verification

**Frontend:**
- `src/pages/Calendar.jsx` — two-pane list view (series + upcoming agendas), Org filter chips (NOT a FullCalendar grid; Console only had a scaffold)
- `src/pages/Agenda.jsx` — per-occurrence agenda detail
- Reschedule Dialog ⭐ (high-priority slice — the 2026-05-20 GV-Bi-Weekly pain point)
- Manage Guests Dialog
- Send Meeting Invite button (explicit, separate from Save)
- Sidebar additions: Calendar, Agendas

**Firestore (new collections — see 2026-05-20 spec §4):**
- `calendar_series/{seriesId}` with `agendas/{agendaId}` and `agendas/{agendaId}/topics/{topicId}` subcollections
- Security rules denylist on Google-affecting fields (must go through callables to keep Firestore + Google in sync)

## Pre-Implementation Blockers (open)

- [ ] **Blaze upgrade** for `management-db9eb` — Cloud Functions cannot deploy on Spark. Local scaffold + unit tests OK without; end-to-end deploy needs it. Andy owns.
- [ ] **Microsoft Graph credentials in GCP Secret Manager** — currently in Azure VistamarVault (`teams-client-id`, `teams-client-secret`, `teams-tenant-id`, `teams-host-user-id`). Migrate or re-grant the app registration for Management's tenant.
- [ ] **Google service account key in GCP Secret Manager** (`meetings-service-account-key`) — reuse `console-meetings-service@console-meetings.iam.gserviceaccount.com` or generate new key for Management.
- [ ] **Tate's recurring meetings migration** (separate one-shot script per HANDOFF) — out of scope for this V2 session, but worth confirming it doesn't block V2.1.

## Plan for This Session (proposed, awaiting Andy approval)

1. **Brainstorm 5 open questions with Andy** (architecture confirmation, Blaze timing, V2.1 slice, TaskBoard #8 prereq, Tate timing).
2. **Write V2 implementation plan** at `docs/plans/2026-05-27-meeting-scheduler-port.md` — same shape as `docs/plans/2026-05-14-project-board-port.md`. Get explicit approval before any code.
3. **Begin V2.1 (Reschedule slice)** — the highest-value first ship since it unblocks the 2026-05-20 pain point.
4. **Re-litigate the 2026-05-20 spec status** — once new plan is approved, add a SUPERSEDED header to `2026-05-20-meetings-v2-design.md`.

## Files Modified

- `dev/sessions/v0_2_0_Andrew_MEETING_SCHEDULER/context.md` — created (this file)
- `dev/SESSION_INDEX.json` — V1 entry closed (`status: completed`); V2 entry added (`status: active`)

## Current State

**ARCHITECTURE CORRECTION (2026-05-27 evening).** First-draft plan assumed Firebase Functions + GCP Secret Manager per HANDOFF. Andy ruled that out: *"Why do I have to flip to Blaze? Get all the things you need from VMConsoleFrontEnd, including the Azure stuff."* Corrected direction:

- **Backend:** Vercel API routes in `api/meetings/*` (NOT Firebase Functions, NOT Blaze)
- **Secrets:** Reuse Console's Azure VistamarVault via service-principal env vars (AZURE_KV_*) — NOT GCP Secret Manager
- **Google-native Join meeting button:** PRESERVED — `buildConferenceData` workaround in `_lib/google-calendar.js` ported intact per Andy: *"I want the google native Join meeting button, don't fuck with that"*
- **Postmark + Graph sendMail:** PRESERVED (no Gmail swap) — port `relay-mail.js` + `graph-mail.js` intact
- **Auth:** presence-only on backend for V2.1 parity with Console (TODO upgrade to Firebase ID token verify before V2.2 cancel/delete endpoints — captured in DEFERRED.md)

**V2.1 LANDED in same session (2026-05-27 evening):**
- `api/meetings/_lib/*` × 10 files ported verbatim from archive (keyvault, cors, auth, attendee-helpers, google-calendar, graph-events, graph-mail, relay-mail, agenda-email, schedule-email)
- `api/meetings/*.js` × 8 endpoints ported (reschedule + list are the V2.1 ship; create/cancel/rename/attendees/send-prep/send-schedule sit dormant for V2.2-V2.4)
- 2 small backend edits for Management's slug-based orgId (Console used numeric): `list.js` makes `org_id` optional; `listEvents` + `listEventResponses` skip orgId filter when null
- `src/pages/Calendar.jsx` — read-only meeting list with Org filter chips, Reschedule + Join buttons per row, refresh button
- `src/components/RescheduleDialog.jsx` — instance/series scope, date+time pickers, attendee-notify explainer, useMutation → `/api/meetings/reschedule`
- `src/lib/meetingsApi.js` — fetch wrapper, passes Firebase ID token in `X-User-Token` header
- `/calendar` route + Calendar sidebar link (lucide `CalendarDays` icon)
- `QueryClientProvider` wired in `App.jsx` (V1 didn't use React Query at runtime; V2 does for meetings mutations + queries)
- Deps installed: `@azure/identity@^4.4.0`, `@azure/keyvault-secrets@^4.8.0`, `googleapis@^140.0.0`
- `vite.config.js` — optional `VITE_API_PROXY_TARGET` env-gated proxy so local Vite can forward `/api/*` to a deployed preview during dev
- CORS allowlist swapped from Console origins → `vm-management-front-end.vercel.app` + localhost:5173 + `*-vistamar-consulting.vercel.app` preview regex (same regex still matches Management's preview URLs)
- `npm run build` passes (32s, 1.3MB bundle — pre-existing V1 bundle size, no V2 regression)

## Pending Ops (Andy)

1. **Set Vercel env vars on Management project** — copy from Console FE's `.env.local`:
   - `AZURE_KV_URL`
   - `AZURE_KV_TENANT_ID`
   - `AZURE_KV_CLIENT_ID`
   - `AZURE_KV_CLIENT_SECRET`
   Set for Production + Preview + Development scopes. Then trigger redeploy (or push will auto-redeploy).
2. **Smoke test on deployed preview** — open `/calendar` → confirm meetings@'s real events load → pick a NON-critical recurring meeting → Reschedule dialog → move it 15 min → confirm both Outlook + meetings@'s Google Calendar reflect the change.
3. **Live acceptance** — once smoke is clean, the V2.1 success criterion is reschedule the GV-Bi-Weekly in <30 seconds via the UI. That's the pain point that motivated V2.1.

## V2 Plan Doc Status

`docs/plans/2026-05-27-meeting-scheduler-port.md` was drafted under the WRONG architecture (Firebase Functions + GCP Secret Manager). Pending rewrite (task #8) to match the actual landed direction. The data model + FE surface sections survive; the entire Cloud Functions + ops sections need to be replaced with Vercel API routes + Azure KV setup. Not blocking V2.1 ship; needed before V2.2 work begins.

## Architectural Constraints to Carry Forward

- `_lib/auth.js` is presence-only. **Upgrade to Firebase ID token verify before V2.2 ships cancel/delete endpoints.** Roughly 30 lines using `firebase-admin` in the api/ functions.
- `_lib/agenda-email.js:201` has a "View full agenda in Console" string. Fix when V2.4 ports send-prep + send-schedule.
- `org_id` flow is asymmetric: existing Console events on meetings@'s calendar have NUMERIC orgIds in extendedProperties; new Management events will have SLUG orgIds. List endpoint skips the filter when null so both coexist. Don't enable orgId filtering on list.js without a backfill plan.

## Post-Review Fixes Landed (2026-05-27 late evening)

Code-review pass (superpowers:code-reviewer subagent) surfaced 3 Critical + 1 Important issue. All addressed in a follow-up commit:

- **C1 — org_id missing in listEvents mapper.** `_lib/google-calendar.js` `listEvents` was filtering by `orgId` on the read but never returning it in the response. Calendar.jsx's org chip filter compared `m.org_id` against every meeting and stripped them all when any chip other than "All" was picked. Fix: add `org_id: e.extendedProperties?.private?.orgId || null` to the mapper.
- **C2 — 6 dormant endpoints exposed phishing-fanout primitives.** `create.js`, `cancel.js`, `rename.js`, `attendees.js`, `send-prep.js`, `send-schedule.js` were all reachable on prod URL with presence-only auth — `send-*` particularly nasty (could send from `meetings@vistamarconsulting.com` to attacker-chosen recipients). Fix: new `requireV2_2Enabled` helper in `_lib/auth.js` that 404s unless `MEETINGS_V2_2_ENABLED=true` env var is set. Wired into all 6 dormant endpoints. V2.1-live endpoints (reschedule, list) unchanged.
- **C3 — Reschedule passed Google-instance ID where master ID was needed.** Calendar.jsx returns 1 row per expanded instance via `singleEvents: true`, so `event_id` for recurring rows = `<master>_<date>`. The archive's `findInstanceByDate` calls `cal.events.instances({ eventId })` which requires the master ID — would have failed on every recurring reschedule. Fix: in RescheduleDialog, pick `meeting.series_id` for recurring (the master), `meeting.event_id` for singles. Force non-recurring meetings to "series" mode (patches directly via `cal.events.patch`, skips `findInstanceByDate`).
- **I3 — Duration silently reset to 1hr on every reschedule.** Archive's `addOneHour` flattened 30-min standups + 90-min strategy sessions. Fix: FE computes `originalDurationMinutes` from `meeting.end_date - meeting.date`, passes to backend as `duration_minutes`. Backend uses it; falls back to 60 only if absent. Dialog UI now shows "Duration preserved at X min" + "Times shown in Pacific (Vistamar HQ)" caption.

Build still passes (36s, no size regression). One trade-off accepted from review's I1: kept hardcoded `America/Los_Angeles` since all V1 users are PT — added the explicit caption instead of `Intl.DateTimeFormat().resolvedOptions().timeZone` detection (3-line punt).

## Useful Repo State

- Branch `main` clean, up-to-date with `origin/dev` at `6a067ba`.
- Last 5 commits (background cleanup session 2026-05-27): `6a067ba`, `71f42a1`, `c0d9371`, `f6a7901`, `e7e23bd`.
- Production stable; 5 users signed in (Andy, Scot, Bill, Hugo, Cedric).
- Firestore + storage rules deployed (V1 ruleset). V2 will need rule additions for `calendar_series` + subcollections.
- `agent-browser` works with `--profile "Profile 10"` for Vistamar Chrome auth.

## Open Questions (active — surfaced to Andy)

See task list (TaskList) for the 4 active session tasks. The brainstorming question list is in the upcoming AskUserQuestion turn.

## V2.2.2b.7 — Email fan-out verification (2026-05-29) ✅

**Architecture flipped on 2026-05-28:** the M365 `meetings@vistamarconsulting.com` mailbox does NOT have email send rights in our tenant — Graph creates events silently regardless of `Prefer: outlook.send-notifications` headers, and zero invites delivered between 2026-04-29 and 2026-05-28 across every Graph code path tried. The Google Workspace `meetings@` mailbox HAS send rights. Commit `87ec165` flipped every Google Calendar mutation from `sendUpdates:"none"` to `sendUpdates:"all"` so Google fans the `.ics` from its side. Graph still mints the Teams meeting binding (we need joinUrl for conferenceData) but is fully silent on the email side.

**Verification run (2026-05-29 10:36-10:48 PDT)** — end-to-end against production deployment `dpl_5pjiTzSGX9CWk5Wjp7p2eJGun2wt`. Test agenda title: "TEST — invite fanout verification (2026-05-29)". Attendees: adeemer@vistamarconsulting.com + (later) deemerwsp@gmail.com. Org: Vistamar. Verified via claude_ai_Gmail MCP against adeemer@vistamarconsulting.com inbox.

| Fan path | Fired at | Delivered at | Latency | Outcome |
|---|---|---|---|---|
| CREATE | 10:36:18 | 10:36:40 | 22s | ✅ `Invitation: TEST — invite fanout verification...` from meetings@vistamarconsulting.com to adeemer@ + seo@ (silent proxy) with Teams join URL |
| ATTENDEE-ADD | 10:38:27 | — | — | ✅ PATCH succeeded (Send Meeting Invite button cleared diff). deemerwsp@gmail.com persisted on Google roster (visible in reschedule's toRecipients line). Direct delivery to deemerwsp@ inbox not verified — personal-gmail MCP returned `invalid_grant`; would need reauth to confirm. Existing-attendee mailboxes don't get a separate "Updated invitation" for attendee-only patches per Google's default behavior. |
| RESCHEDULE | 10:45:58 | 10:46:19 | 21s | ✅ `Updated invitation: TEST — ... @ Fri May 29, 2026 6:30pm - 7pm (PDT)` to all 3 attendees (adeemer@, seo@, deemerwsp@) |
| CANCEL | 10:47:21 | 10:47:35 | 14s | ✅ `Canceled event: TEST — ...` to adeemer@ with cancellation `.ics` |

**Cleanup:** test agenda deleted via the Cancel agenda flow (which also walks topics + openFloor subcollections) and navigated back to /calendar. Confirmed Calendar page renders cleanly post-delete.

**Caveat to track:**
- The personal-gmail MCP (authorized for adeemer@vistamarconsulting.com per session memory) returned `invalid_grant` throughout the run — the token must have expired. To verify "new attendee gets the .ics on attendee-add" end-to-end we'd need either personal-gmail reauthorized or a second test mailbox the claude_ai_Gmail MCP can read. For now the persisted-roster + downstream-fan-success is sufficient evidence the API call landed correctly on Google's side.

**Deploy note (retracted):** During the verification session I initially wrote that Vercel auto-deploy had failed to fire for commits `105af3c`, `44de415`, `87ec165` last night, based on the production-URL bundle hash not changing between V2.2.2b.6 and those commits. That diagnosis was wrong. Investigation 2026-05-29 11:00 PDT via GitHub commit-status API confirms all three commits posted "success" Vercel checks within ~10 seconds of push, with deploy URLs aliased to the production domain. The FE bundle hash didn't change because those three commits only touched `api/meetings/_lib/*.js` (backend); the React bundle was identical across them. Auto-deploy works fine; ping-commit verification 11:01:52 PDT → build started 11:01:55 (3-second latency). No webhook fix needed.

## Deferred (live tracker — consolidated 2026-05-29 from retired DEFERRED.md + DEFERRED_PLAYBOOK.md)

Project convention as of 2026-05-29: deferred items live in this section of context.md, not in a separate `dev/DEFERRED.md`. Next session inherits this section; add/remove items as state changes.

### Open from this V2 session

- **Reconcile 2026-05-20 V2 design spec with current direction** (task #4) — `docs/superpowers/specs/2026-05-20-meetings-v2-design.md` still asserts Google-only architecture, which was superseded twice (M365-primary on 2026-04-28, then Google-fans-Graph-mirrors on 2026-05-29). Needs a SUPERSEDED header + a one-line pointer to the current model in `api/meetings/_lib/google-calendar.js` + this context.md's V2.2.2b.7 section.
- **Rewrite V2 plan for Vercel + Azure KV direction** (task #8) — `docs/plans/2026-05-27-meeting-scheduler-port.md` was drafted under Firebase Functions + GCP Secret Manager assumptions. Data model + FE surface sections survive; the ops sections need a full rewrite. Not blocking shipping, but should land before any new V2 contributor onboards.
- **Re-authorize `personal-gmail` MCP** — returned `invalid_grant` throughout the V2.2.2b.7 verification, which blocked direct confirmation that newly-added attendees receive the initial `.ics` in their personal Gmail (e.g. `deemerwsp@gmail.com`). Indirect evidence (persisted roster + downstream reschedule/cancel fan-out) was sufficient for sign-off but not for a clean direct verify. Reauth via `/mcp` or whatever Anthropic's flow is.
- **AgendaHero field-name bug** — `src/pages/AgendaDetail.jsx:152` reads `calendarSeries?.graphEventId` for `canReschedule`, but the actual field on `calendar_series` docs is `graphSeriesEventId`. Causes recurring-instance agendas with a real Graph binding to show the copper "Click to schedule" hot button instead of "Click to reschedule," which would mint a duplicate event if clicked. ActionBar's `isBound` check uses the correct field; Hero hasn't been updated. Pre-existed V2.2.2b.4; flagged during 2026-05-28 verification.

### V2 follow-ups (carried from old DEFERRED.md)

- **`agenda-email.js` user-facing string** — has "View full agenda in Console" link. Update when porting send-prep + send-schedule (V2.4 area).
- **Backend auth presence-only on V2.1-live endpoints** — `_lib/auth.js` was upgraded to Firebase ID token verify in V2.2.2b, so this is largely closed. Verify `reschedule.js` + `list.js` got the upgrade applied; if not, propagate it.

### V1 polish (mostly closed, residue remains)

- **Firebase Storage initialization** — Blaze-only since late 2025. `storage.rules` authored. Files modal currently URL-link-only; "📎 Attach file" button lands when Storage is live.
- **Cloud-Function auth-onCreate trigger** (spec §5) — Blaze-required. V1 uses client-side bootstrap in AuthContext as a documented exception.
- **DnD reorder** via `@hello-pangea/dnd` + `fractional-indexing.generateKeyBetween` — library installed (V2.2.2f uses it for topic reorder); not wired for Project Board row drag yet.
- **`useItems` server-side pagination** — fine at <500 items, switch when crossed.
- **`isDueThisWeek` timezone-implicit** — uses local `Date()`. Document the US-West assumption or convert to `date-fns-tz` with fixed `America/Los_Angeles` when team goes remote.
- **Members admin page + Settings page** — both stubs. V1 sidebar doesn't link them. Decide keep-as-scaffolding vs delete next time it comes up.
- **KanbanBoard dead route** — `/board/kanban` still routes to `KanbanBoard.jsx`. Decide keep-as-alt-view vs delete.
- **MUI-prefix import convention** — CLAUDE.md mandates `import Chip as MuiChip`-style; only `TaskBoardRow.jsx` + `TaskBoardColumnHeader.jsx` follow it. Decide retire vs apply everywhere.
- **vitest counter test** — boot Firestore emulator, fire 100 parallel `handleAddItem` calls, assert all `itemNumber`s unique. Guards the per-org counter against silent regressions. ~30 lines once emulator's running.
- **`useCallback` wrap `getCommentCount` / `getFileCount` in TaskBoard.jsx** + consider `React.memo(TaskBoardRow)` when item count grows past ~200.
- **Date-picker keyboard navigation** — DatePicker opens on click, closes on outside-click. Tab/Enter/Escape behavior not tested.

### V3 / Far-Future

- **AI-driven Project Board updates** — Andy 2026-05-27 direction: Fireflies meeting transcripts + Meeting Agendas auto-suggest items/decisions. AI-suggested items land with `statusId: 8` (AI Gen), human confirms into Assigned.
- **Task File uploads** — Blaze-gated. V1 ships URL-link-only Files dialog.
- **Migration script** (`functions/scripts/migrate-from-sql.js`) — V1 ships mock data. Write when/if Andy wants live `pm.Items` pulled in from Console SQL.

## Session close — 2026-05-29

**What shipped this session (V2.2.2b.4 → V2.2.2b.7):**

| Slice | Commits | What's in it |
|---|---|---|
| V2.2.2b.4 | `c6a1330`, `2689e6c` | Monthly/Quarterly frequency with ordinal picker; Cancel meeting button; staged Send Meeting Invite pattern (Manage Guests writes Firestore only; new SendInviteDialog computes diff vs `agenda.lastSentAttendees` and PATCHes Google attendees); code-review pass fixes (legacy `lastSentAttendees` migration via gated `missingBaseline`; strict event_id resolution; multi-tab snapshot race fix; `patchAttendees` extraction; copy + UX nits) |
| V2.2.2b.5 | `5c7a3fd` | `NewMeetingDialog` + copper "+ New Meeting" button on Calendar page header. Single-form mint flow: title + org + attendees + cadence → agenda doc → `/api/meetings/create` → write back Teams URL etc. → nav to new agenda |
| V2.2.2b.6 | `e361f2e`, `246529d` | Always-notify Prefer header on every Graph mutation (then deprecated 2 commits later); split `Cancel meeting` (event only, clears binding) from `Cancel agenda` (hard-delete doc + subcollections + nav back to /calendar); morphing single-button slot in Action Bar |
| V2.2.2b.7 | `c0c84f8`, `105af3c`, `87ec165`, `4e0f6ec`, `cb8d33b` | Three failed Graph-side attempts at the email-fanout issue, then the real fix: flip every google-calendar.js mutation from `sendUpdates:"none"` to `sendUpdates:"all"` so Google fans the .ics from its (send-rights-having) Workspace mailbox. End-to-end verified — see V2.2.2b.7 table above. Docs retraction of "auto-deploy broken" misdiagnosis |
| Doc cleanup | `46b9f59` (this commit) | Retire `dev/HANDOFF_*.md` + `dev/DEFERRED*.md`; consolidate live state into this `context.md`; project CLAUDE.md updated to reflect the single-source convention |

**Architectural decision (final):** Google Workspace `meetings@` Calendar API is now the canonical invite-fan source via `sendUpdates:"all"`. Microsoft Graph still mints the calendar event row + Teams `joinUrl` (we need that for `conferenceData` on the Google mirror) but is silent on the email side because the M365 `meetings@` mailbox doesn't have email send rights in our tenant. Confirmed end-to-end against production 2026-05-29 across CREATE / RESCHEDULE / CANCEL paths; ATTENDEE-ADD confirmed at the API + Google-roster level (direct inbox confirmation deferred on `personal-gmail` MCP reauth).

**Production status:** stable. 5 users (Andy, Scot, Bill, Hugo, Cedric). V2 meeting scheduler is live end-to-end: create from scratch, schedule, reschedule, manage guests, send staged invites, cancel meeting, cancel agenda. Auto-deploy on push to `origin/dev` healthy (verified 11:02 PDT).

**Entry points for the next session:**
- **V2.2.2h (Past Meetings / Fireflies card)** — last user-visible piece of the Working view sidebar per `docs/AGENDA_DETAIL_PAGE_REFERENCE.md`. Surfaces a meeting's prior occurrences with Fireflies transcript links under Open Floor.
- **Hero `graphEventId` field-name bug fix** — one-line correction in `src/pages/AgendaDetail.jsx:152` per the Deferred section above.
- **Reconcile the design spec + plan docs** — tasks #4 + #8 above.
- **V2.2.2g.2 — TaskBoard.jsx extraction** (item #8 in the old DEFERRED) — was tagged URGENT before V2; V2 has shipped on top, so it's now polish, not a prereq. Still worth doing for future agenda→item flows.

Status: **closed.** Next session creates its own `dev/sessions/{folder}/context.md` and pulls live items from this Deferred section.
