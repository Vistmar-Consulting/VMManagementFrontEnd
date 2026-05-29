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
2. `dev/HANDOFF_2026-05-27_MEETING_SCHEDULER_KICKOFF.md` — V2 kickoff brief, **current** architecture (M365-primary dual-write)
3. `dev/DEFERRED_PLAYBOOK.md` — #8 TaskBoard.jsx extraction note (V2 prereq for agenda→item create, if that flow lands in V2)
4. `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` §4 + §7 — data model + V2 sketch
5. `docs/superpowers/specs/2026-05-20-meetings-v2-design.md` — **OUTDATED** (asserts Google-only; superseded by 2026-05-27 HANDOFF). Needs SUPERSEDED header once new plan is approved. Otherwise structurally useful as a reference for FE surfaces (§6) and phased build order (§9).
6. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/` — Vercel functions being ported
7. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/Agenda.jsx` (6,475 lines) — the real Console meetings UI; FE port reference

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

**Deploy note for future:** Vercel auto-deploy on push to `origin/dev` failed to fire for commits `105af3c`, `44de415`, `87ec165` (between roughly 2026-05-28 20:30 PDT and 2026-05-29 10:30 PDT). All three sat on `origin/dev` without a corresponding deploy. Resolution: `npx vercel --prod --yes` from repo root manually published deployment `vm-management-front-dei4fot6y` which aliased to the production domain. Worth investigating Vercel's GitHub webhook on the Management project — auto-deploy on the Console project still works, so this isn't a global outage.
