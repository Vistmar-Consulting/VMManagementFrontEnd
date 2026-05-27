# Meetings V2 — Calendar + Agendas Design Spec

**Author:** Claude (Switchboard session, with Andy)
**Date:** 2026-05-20
**Status:** Draft for Andy's review; supersedes section 7 of `2026-05-12-vmmanagement-spinout-design.md` (which was an intentional sketch). When approved, this becomes the canonical V2 design and that section becomes historical.
**Builds on:** `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` (canonical for everything outside V2)

---

## 0. TL;DR

V2 turns Vistamar Management into the **single UI** for scheduling, rescheduling, and running every recurring client meeting. Replaces the manual Outlook/Calendar dance + the deprecated `api/meetings/*` Vercel layer. Architecture is the Firebase-native one already chosen for V1: Firestore as the FE database, **Firebase Cloud Functions** as the only server-side surface, **Google Calendar service-account on `meetings@vistamarconsulting.com`** as the canonical write path. Microsoft Graph is gone for good — we keep the Google service account and Gmail send via meetings@.

What V2 ships:
- **Calendar page** — list/grid of recurring series + upcoming agendas, filterable by Organization.
- **Series detail page** — title, recurrence, default attendees, every past/upcoming agenda, edit/cancel buttons.
- **Reschedule dialog** — single-instance OR whole-series time/date change. **This is the specific gap that surfaced 2026-05-20** (Andy had to manually pull Key Vault secrets and PATCH Graph + Google to move today's GV-Vistamar Bi-Weekly to 1:30pm).
- **Manage Guests dialog** — add/remove attendees on a series.
- **Agenda page** — per-occurrence agenda doc with topics, threaded comments, file attachments.
- **Send Meeting Invite button** — pushes the agenda + Google Meet join link to attendees via Gmail-from-meetings@.
- **Cloud Functions** — `create`, `cancel`, `reschedule`, `rename`, `attendees`, `list`, `sendPrep`, `sendSchedule` — ports of the archived Vercel endpoints, **stripped of all Graph/Postmark/Azure code paths**.

What V2 does NOT ship:
- Anything Graph-related.
- Anything that touches Microsoft 365 directly.
- Drag-to-reschedule on the calendar grid (V3 — keep all reschedules behind an explicit dialog for now).
- AI-assisted agenda drafting (V3).

---

## 1. Triggering Context — Why This Spec Exists Now

On 2026-05-20, Andy needed to move today's instance of the recurring **"GV – Biweekly"** meeting from 12:30pm PT to 1:30pm PT, keeping the rest of the series at 12:30pm. Since the Console FE meetings UI was dropped during the 2026-05-12 spinout and V2 isn't built, the only paths available were:

1. Open Outlook web as meetings@ and edit it there (manual, error-prone)
2. Hand-roll a Graph + Google Calendar reschedule from the shell

We went with #2. Working end-to-end procedure (preserved here so V2 can verify against it):

```
1. Pull Graph app creds from Azure Key Vault `VistamarVault`:
   teams-client-id, teams-client-secret, teams-tenant-id, teams-host-user-id
2. Pull Google service account JSON from `google-service-account-key`
3. Client-credentials flow → Graph token
4. List meetings@ calendarView for the day → find instance event id
5. PATCH /users/{hostUserId}/events/{instanceId} with new start/end → Graph fans out .ics
6. Build google-auth JWT with subject=meetings@vistamarconsulting.com (DWD)
7. List Google primary calendar for the day → find matching event id
8. events.patch with sendUpdates="none" (Graph already notified)
```

That procedure works but is hostile to anyone except Andy. **Every step except the first two needs to be invisible behind one dialog.** This spec specifies that dialog and the function behind it.

> **Note on Graph during V2:** the 2026-05-12 spinout decided we're dropping Graph entirely. Today's reschedule patched both Graph and Google because Tate's old recurring series was still **organized by meetings@'s M365 mailbox** (Graph-canonical, Google-mirror). After Tate's migration runs (see §11), meetings@ becomes a **Google-organized** series, Graph is no longer in the loop, and reschedule.js needs to mutate Google only. The V2 design below assumes the post-migration state. Pre-migration meetings get **migrated as a precondition**, not handled by dual-write code.

---

## 2. Sources of Truth

Read these before implementing anything in V2:

1. **`docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`** — canonical for the Firebase-native architecture, Firestore data model (sections 4 + 7 sketch), auth model. This spec only adds detail, never contradicts.
2. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/`** — the working Vercel implementation (frozen). Read each file; identify which paths port, which delete.
3. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/_lib/google-calendar.js`** — the Google API client. ~60% survives the move. Re-auth becomes GCP ADC inside Firebase Functions (no Azure Key Vault).
4. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/feature_memory/`** — `Meeting_Agendas.md`, `Meeting_Agendas_Board_View.md`, `Calendar_Agenda_Sync.md`, `Agenda_Action_Bar.md`, `Agenda_Detail_View.md`, `Meeting_Prep_Email.md`, `Meetings_API.md`. Each one is the *why* for a design decision the archive code embeds.
5. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/HANDOFF_2026-04-30_TATE_MIGRATION.md`** — Tate → meetings@ migration playbook. V2 cutover prerequisite.
6. **VistamarVault** in Azure (read-only via `az keyvault secret`) — for the **migration script only**. After cutover, secrets live in **GCP Secret Manager** scoped to the Firebase project `management-db9eb`.

Read order: spinout spec §4 + §7 → this spec → `_lib/google-calendar.js` → `reschedule.js` → `feature_memory/Meeting_Agendas.md` → `feature_memory/Calendar_Agenda_Sync.md` → start implementation plan.

---

## 3. Architecture (V2 deltas only)

Inherits everything from the spinout spec §3. V2 adds:

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser (Vite SPA)                                               │
│  ─────────────────                                                │
│  • Calendar page → Firestore onSnapshot(calendar_series)          │
│  • Agenda page  → Firestore onSnapshot(calendar_series/.../       │
│                                          agendas/{agendaId})      │
│  • Mutations that touch Google Calendar → React Query →           │
│    HTTPS callable Cloud Function                                  │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
                ┌────────────────────────────────────┐
                │  Firebase Cloud Functions          │
                │  (Node 20, in `functions/`)        │
                │                                    │
                │  meetings/                         │
                │    create.js                       │
                │    reschedule.js                   │
                │    cancel.js                       │
                │    rename.js                       │
                │    attendees.js                    │
                │    list.js                         │
                │    sendPrep.js                     │
                │    sendSchedule.js                 │
                │    _lib/google-calendar.js         │
                │    _lib/gmail-send.js              │
                │    _lib/auth.js                    │
                │                                    │
                │  Auth: every callable verifies     │
                │  context.auth.token.email ends     │
                │  with @vistamarconsulting.com.     │
                │                                    │
                │  Secrets (GCP Secret Manager):     │
                │    meetings-service-account-key    │
                │                                    │
                │  ADC + DWD subject = meetings@     │
                └────────────────────────────────────┘
```

**Single backend stack:** Google Calendar API only. No Graph, no Postmark, no Key Vault. The reschedule.js logic collapses from "PATCH Graph → mirror Google" to **"PATCH Google with sendUpdates=externalOnly"** (Google sends invite-update emails to non-Workspace attendees directly).

**Cloud Functions region:** `us-west1` (matches Firestore region — see CLAUDE.md).

**Conferencing:** Google Meet `conferenceData` on every event. The old Microsoft-Teams-as-add-on hack (the entire reverse-engineered `buildConferenceData` block in archived `_lib/google-calendar.js`) **gets deleted** — Google Meet is native and works without it.

---

## 4. Data Model (Firestore)

Extends spinout spec §4. Authoritative for V2:

```
calendar_series/{seriesId}
  organizationId: string                  ← tag (organizations/{slug})
  title: string                           ← "GV – Biweekly"
  googleCalendarId: string                ← always 'primary' (meetings@'s)
  googleSeriesEventId: string             ← Google Calendar recurring event id
  recurrence: string[]                    ← RRULE strings as Google stores them
  defaultStart: { hour, minute, tz }      ← canonical series start
  defaultDurationMinutes: number          ← 60 typical
  defaultLocation: string | null
  conferenceType: 'meet'
  defaultAttendees: [{ email, displayName, memberId, optional }]
  description: string
  createdAt, updatedAt: Timestamp
  createdByUid, updatedByUid: string
  archived: bool                          ← soft-delete; cancellation removes from Google but doc stays for history
  ─ subcollections ──
  agendas/{agendaId}
    iCalUID: string                       ← Google Calendar iCalUID
    googleEventId: string                 ← instance-specific id (for reschedule patches)
    meetingDatetime: Timestamp            ← single source of truth for "when"
    durationMinutes: number               ← per-instance override; defaults to series
    status: 'draft' | 'sent' | 'archived'
    title: string                         ← per-instance override; defaults to series title
    notes: string                         ← free text / markdown
    attendees: [{ email, displayName, memberId, responseStatus, optional }]
    meetUrl: string | null
    rescheduledFrom: Timestamp | null     ← original time if this instance is an exception
    cancelledAt: Timestamp | null
    createdAt, updatedAt: Timestamp
    createdByUid, updatedByUid: string
    ─ subcollections ──
    topics/{topicId}
      title: string
      notes: string
      order: number                       ← fractional
      ownerMemberId: string | null        ← uid of the topic owner
      linkedItemIds: string[]             ← items in the project board referenced by this topic
      createdAt, updatedAt: Timestamp
      ─ subcollection ──
      comments/{commentId}                ← same shape as items/.../comments
```

**Key denormalization decisions:**

- **`meetingDatetime` is the source of truth on the agenda doc**, not the series. The series carries defaults; each agenda may diverge (reschedules, one-off time shifts). Calendar page reads agendas, not series, for "what's scheduled when."
- **`attendees` is an array on the agenda doc**, not a subcollection. Same rationale as items: ≤15 attendees per meeting, well under document size cap, no fanout reads for guest list rendering.
- **`googleEventId` per agenda** — Google Calendar single-instance exceptions get their own event id. We store it so reschedule.js can `events.patch` the correct event without re-listing.
- **`rescheduledFrom`** captures provenance so the audit trail survives even if the original time is overwritten.
- **No `members` collection** — same as V1, attendees reference `users/{uid}` via `memberId` (nullable for external attendees).
- **`archived` on series + `cancelledAt` on agenda** — soft deletes. Google Calendar gets the actual delete; Firestore preserves history.

**Storage paths:**
- `gs://management-db9eb.firebasestorage.app/agendas/{agendaId}/{filename}` — agenda attachments
- `gs://management-db9eb.firebasestorage.app/topics/{topicId}/{filename}` — topic-card attachments (optional, V3)

**Composite indexes:**
- `agendas` group: `(organizationId ASC, meetingDatetime ASC)` — Calendar page upcoming-list query.
- `agendas` group: `(status ASC, meetingDatetime DESC)` — Pending/Sent filter on the agenda board.

---

## 5. Cloud Functions Catalog

All HTTPS callable. Auth gate from `_lib/auth.js`: reject unless `context.auth.token.email` ends in `@vistamarconsulting.com` AND `users/{uid}.active == true`.

| Function | Method shape | Port status from archive | Notes |
|---|---|---|---|
| `meetings-create` | `{ orgId, title, startIso, durationMinutes, recurrence, attendees, description }` → `{ seriesId, googleEventId }` | Port + simplify (drop Graph) | Creates Google series event + `calendar_series/{seriesId}` Firestore doc + first agenda |
| `meetings-reschedule` | `{ seriesId, agendaId, mode: 'instance'\|'series', newStartIso, newDurationMinutes?, notifyAttendees: bool }` → `{ ok }` | Port + collapse to Google-only | **The 2026-05-20 trigger.** `instance` mode → `events.patch` on `googleEventId` with `sendUpdates=externalOnly` if notify=true. `series` mode → `events.patch` on series master + update `calendar_series.defaultStart` |
| `meetings-cancel` | `{ seriesId, agendaId?, mode: 'instance'\|'series', notifyAttendees: bool }` → `{ ok }` | Port | `instance` → `events.delete` on agenda's googleEventId + agenda.cancelledAt; `series` → `events.delete` on series master + `calendar_series.archived=true` |
| `meetings-rename` | `{ seriesId, newTitle, applyTo: 'future'\|'all' }` → `{ ok }` | Port | Updates Google + Firestore. `future` only renames the series master (existing exceptions keep their title) |
| `meetings-attendees` | `{ seriesId, add: [], remove: [], applyTo: 'future'\|'all' }` → `{ ok }` | Port | Patch Google attendees, update `calendar_series.defaultAttendees` and per-agenda `attendees` |
| `meetings-list` | `{ orgId?, from: iso, to: iso }` → `{ series: [...], agendas: [...] }` | Port (FE prefers Firestore onSnapshot now; this exists only for background reconciliation) | Optional — most reads go direct to Firestore |
| `meetings-sendPrep` | `{ agendaId }` → `{ ok }` | Port + swap Postmark→Gmail-from-meetings@ | Renders prep email (topics, notes, attendees) → Gmail send → marks `agenda.preparedAt` |
| `meetings-sendSchedule` | `{ agendaId }` → `{ ok }` | Port + swap | The **explicit Send Meeting Invite button**. Builds HTML invite body, calls Gmail API, sets `agenda.status = 'sent'` |

**Deleted from archive (do NOT port):**
- `_lib/graph-events.js`, `_lib/graph-mail.js` — Graph is gone
- `_lib/keyvault.js` — Azure Key Vault is gone; use GCP ADC + Secret Manager
- `_lib/relay-mail.js` — Postmark is gone; Gmail API replaces it
- The `appendAddOnQuerystring`/`buildConferenceData` Teams-add-on workaround in `_lib/google-calendar.js` — Google Meet is native, ~80 lines of reverse-engineered code can be deleted

**Rewritten:**
- `_lib/auth.js` — middleware that reads Firebase Auth context (available natively in callable Functions; ~10 lines vs the archive's ~50)
- `_lib/gmail-send.js` — new, replaces both Postmark relay and Graph sendMail. Uses the same service account, scope `https://www.googleapis.com/auth/gmail.send`, subject=meetings@

**Survives largely intact (~60% of archive):**
- `_lib/google-calendar.js` event create/patch/delete logic
- Attendee helpers (`_lib/attendee-helpers.js`)
- Endpoint-level orchestration in `create.js`, `cancel.js`, `reschedule.js`, `rename.js`, `attendees.js`, `list.js`, `send-prep.js`, `send-schedule.js`

---

## 6. Frontend Surfaces

### 6.1 Calendar Page (`/calendar`)

Two-pane:
- **Left: Series list** — table of `calendar_series` filtered by Organization chips (same chip pattern as Project Board). Columns: Title, Org, Recurrence summary ("Every other Tuesday 12:30pm PT"), Default attendees count, Last sent agenda, Next occurrence. Row click → Series detail page.
- **Right: Upcoming agendas** — flat list of next ~20 agendas across all series (filtered by same chips), sorted by `meetingDatetime`. Each card shows time, title, attendee chips, status pill (draft/sent), inline buttons: **Reschedule**, **Cancel**, **Open agenda**.

No calendar grid view in V2 — list view is enough until we have enough series volume to justify a grid lib.

### 6.2 Series Detail Page (`/calendar/series/:seriesId`)

- Header: title, org, recurrence summary, **Edit Series**, **Cancel Series** buttons
- Default attendees section: chip list + **Manage Guests** button → opens dialog
- Past + Upcoming agendas table (paginated): time, title, status, **Open**, **Reschedule**, **Cancel** per row

### 6.3 Reschedule Dialog ⭐

**This is the dialog that would have saved Andy the 90-minute shell session on 2026-05-20.** Spec it in detail:

- Triggered from: agenda card on Calendar page, agenda row on Series detail, Open Agenda page header
- Fields:
  - **Scope** (radio): `Just this meeting (YYYY-MM-DD)` (default) | `This and all future` | `Entire series`
  - **New date** (date picker, defaults to the agenda's current date)
  - **New time** (time picker, defaults to current start, 15-min increments, timezone-aware)
  - **Duration** (defaults to current; only shown if user opens "Advanced")
  - **Notify attendees** (checkbox, default ON for instance, default ON for series-future, default ON for series-all)
- Submit → React Query mutation → `meetings-reschedule` callable
- On success: dialog closes, toast "Meeting moved to 1:30pm PT", Firestore snapshot updates the row in place (no full refetch)
- On error: inline error, no dialog close. Common error: Google API rate limit → retry guidance.

**Implementation note:** the dialog is a thin form. All conflict logic (instance vs series, sendUpdates flag) lives in the callable. FE just collects fields, calls the function, watches for the doc to update.

### 6.4 Manage Guests Dialog

Add/remove attendees from a series. Two scopes via radio: `Apply to future meetings only` (default) | `Apply to all (including past)` — same shape as the archive's `attendees.js` endpoint. Internal members surface as a member-picker (autocomplete from `users/`); external attendees are free-text email + display name.

### 6.5 Agenda Page (`/calendar/agenda/:agendaId`)

Lifts wholesale from archive's `feature_memory/Agenda_Detail_View.md`. Sections:
- Header (title, datetime, attendees, Meet link, **Send Invite** button if not yet sent, **Reschedule**, **Cancel**)
- Notes (markdown editor, autosave to Firestore)
- Topics (cards, drag-reorder via fractional rank, threaded comments per topic)
- Action items (linked items from Project Board — V2 simplified: show a chips list of `linkedItemIds`, click-through to item; full Mini Project Board embed deferred to V2.1)

### 6.6 Send Meeting Invite Button

Calls `meetings-sendSchedule`. Disabled until agenda has at least 1 topic. After click: button → "Sending…", on success → "Sent ✓" + status pill flips to `sent` (via Firestore listener, not optimistic local state). Email format = port of archive's `_lib/relay-mail.js` template, but sent through Gmail API.

---

## 7. Auth + Security Rules

Extends spinout spec §5. New collections:

```
match /calendar_series/{seriesId} {
  allow read: if isActiveVMUser();
  allow create, update: if isActiveVMUser();
  allow delete: if isAdmin();   // soft-delete via archived=true is preferred; hard delete admin-only

  match /agendas/{agendaId} {
    allow read: if isActiveVMUser();
    allow create, update: if isActiveVMUser();
    allow delete: if isAdmin();

    match /topics/{topicId} {
      allow read: if isActiveVMUser();
      allow create, update, delete: if isActiveVMUser();

      match /comments/{commentId} {
        allow read: if isActiveVMUser();
        allow create: if isActiveVMUser();
        allow update, delete: if resource.data.authorUid == request.auth.uid;
      }
    }
  }
}
```

**Cloud Function-only writes:** the FE writes most fields directly, but Google-Calendar-affecting fields (`googleSeriesEventId`, `googleEventId`, `meetingDatetime` on agendas, attendee arrays when notifying) **must** go through callables so Google + Firestore stay in sync. Enforce this in rules with a denylist on those fields for direct client writes.

```
match /calendar_series/{seriesId} {
  allow update: if isActiveVMUser()
    && !request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(['googleSeriesEventId', 'recurrence', 'defaultStart', 'defaultDurationMinutes']);
}
```

Title-only renames stay direct from FE → fast typing UX. Anything touching Google goes through a callable.

---

## 8. Migration Plan

### 8.1 Tate → meetings@ (precondition)

Run the migration playbook in `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/HANDOFF_2026-04-30_TATE_MIGRATION.md`. Uses Google `events.move()` to transfer Tate's recurring series ownership to meetings@. **Must run before V2 cutover** so the V2 code path can assume Google-organized events.

Script lives in `functions/scripts/migrate-tate-meetings.js`. One-shot, idempotent (skips already-moved events).

### 8.2 Console events → `calendar_series` + `agendas` (V2 cutover)

For each existing Google series on meetings@'s calendar:
1. Read series metadata (title, recurrence, attendees, conferenceData) via Google API
2. Write `calendar_series/{seriesId}` doc (seriesId = Google series event id)
3. For each upcoming instance in the next 6 months: write `agendas/{agendaId}` doc

Script: `functions/scripts/migrate-console-meetings.js`. Idempotent (skips existing docs).

### 8.3 Cutover sequence

1. Tate migration runs (one-shot)
2. Console-meetings migration runs (one-shot)
3. V2 FE deploys to Vercel dev → manual smoke test (create test series, reschedule it, send invite)
4. V2 FE deploys to Vercel prod → Andy uses it for the next BMD biweekly
5. Old Vercel `api/meetings/*` deployment is decommissioned (already happened during spinout — re-confirm)

---

## 9. Phased Build Plan (within V2)

Suggested implementation order. Each phase ships a working slice.

| Phase | Scope | Done when |
|---|---|---|
| **V2.0 Infra** | Firebase Functions scaffold, Secret Manager wiring, `_lib/google-calendar.js` port + auth refresh, `_lib/auth.js` callable middleware | `meetings-list` callable returns meetings@'s upcoming events to a smoke-test FE button |
| **V2.1 Reschedule** | `meetings-reschedule` callable end-to-end; Calendar page (read-only list, no agenda details); Reschedule Dialog | Andy can move today's GV biweekly to 1:30pm from the Management UI in <30 seconds |
| **V2.2 Series CRUD** | `meetings-create`, `meetings-cancel`, `meetings-rename`; Series detail page; Manage Guests dialog | Andy can create a new biweekly series end-to-end, including a Meet link, without touching Outlook/Calendar |
| **V2.3 Agendas** | `agendas/{agendaId}` reads/writes, Agenda page (notes + topics + threaded comments), Calendar Agenda Sync | Andy can write next BMD biweekly's agenda in Management; it shows up against the right Google instance |
| **V2.4 Invites + Prep** | `meetings-sendSchedule` (Gmail API), Send Invite button; `meetings-sendPrep` (Meeting Prep email) | One-click send to attendees works; sent emails arrive from meetings@ |
| **V2.5 Cutover** | Migration scripts, Tate migration, prod deploy, Console URL decommission | Old links 404; Management is the only path |

**V2.1 is the highest-priority slice** because it unblocks the reschedule pain Andy hit today. Everything else after that is on a normal cadence.

---

## 10. Open Questions for Andy Before Implementation Begins

1. **Calendar grid view** — confirm V3 (list-only in V2)? Default reaction is yes, but worth checking.
2. **External attendees** (non-`@vistamarconsulting.com`) — they get the invite from meetings@ and can RSVP via the Google `.ics`, but they have no Management UI access. Confirm that's fine (they don't need it).
3. **Notify-attendees default** — should we default *on* for instance reschedules? Andy's instinct here matters (alternative: default off, let the user opt-in to email blast).
4. **Tate migration timing** — when does the actual migration playbook run? Before V2.1 ships, or in parallel with the build? Currently spec says precondition; revisit if it blocks V2.1.
5. **Service account scope** — current archive uses `https://www.googleapis.com/auth/calendar` (full). V2 can stay full-scope or narrow to `calendar.events` + `gmail.send`. No real reason to narrow unless we want least-privilege hygiene.
6. **Recurrence editor** — V2 only supports the recurrence patterns already in Tate's series (weekly, biweekly, monthly-day-of-week). Anything more exotic = V3 + a real RRULE editor. Confirm.
7. **Conflict detection** — when rescheduling, do we warn if the new time collides with another meeting on meetings@'s calendar? Nice-to-have, doable in V2.1 with `freeBusy.query`. Punt to V2.2 unless Andy wants it earlier.

---

## 11. Out of Scope (Explicit Non-Goals)

- Any Microsoft Graph / M365 code path. Permanently.
- Postmark or any third-party transactional email vendor.
- Drag-to-reschedule on a calendar grid (V3).
- AI-assisted agenda drafting / auto-topic extraction (V3).
- Per-attendee response-status dashboards (V3).
- Time-tracking against meetings (V3).
- Anything that would require attendees to authenticate into Management (they don't and shouldn't).

---

## 12. Implementation Brief Hand-Off

When Andy approves this spec, the next artifact is **`docs/plans/2026-05-XX-meetings-v2.1-reschedule.md`** — an implementation brief for V2.1 only (mirrors the format of `docs/plans/2026-05-14-project-board-port.md`). That brief is where:
- Specific archive file → new file mappings live
- Exact `_lib/google-calendar.js` diff (Azure-KV import removed, GCP ADC import added)
- The Reschedule dialog component design with state shape
- The Cloud Function smoke test plan

The spec stays architectural. Plans stay tactical.
