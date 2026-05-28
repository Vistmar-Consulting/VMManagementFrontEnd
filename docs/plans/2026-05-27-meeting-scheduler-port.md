# Meeting Scheduler Port — V2 Implementation Brief

**Author:** Claude (V2 kickoff session, with Andy)
**Date:** 2026-05-27
**For:** Claude session(s) implementing V2 in `~/Vistamar_Consulting/VMManagementFrontEnd/`
**Status:** Draft for Andy's approval. After approval: SUPERSEDES `docs/superpowers/specs/2026-05-20-meetings-v2-design.md` on the architectural surface (Graph + Google dual-write), but reuses that spec's data model §4, FE surfaces §6, security rules §7, and phasing §9 where they survive.

---

## TL;DR

V2 turns Vistamar Management into the **single UI** for scheduling, rescheduling, and running every recurring client meeting. Architecture: **canonical-Graph + Google-mirror dual-write** via the `meetings@vistamarconsulting.com` service account (one M365 mailbox + one Google service account, both already provisioned in `Console-Meetings` GCP project).

What V2 ships (in order, slice by slice):

| Slice | Scope | Done when |
|---|---|---|
| **V2.0 Infra** | Firebase Functions scaffold, GCP Secret Manager wiring, `_lib/graph-events.js` + `_lib/google-calendar.js` ports + auth refresh, `_lib/auth.js` callable middleware | `meetings-list` callable returns meetings@'s upcoming events to a smoke-test FE button |
| **V2.1 Reschedule ⭐** | `meetings-reschedule` callable end-to-end (Graph PATCH → Google mirror PATCH); Calendar page (read-only list); Reschedule Dialog | Andy can move today's GV biweekly to 1:30pm from the Management UI in <30 seconds |
| **V2.2 Series CRUD** | `meetings-create` (Graph + Google), `meetings-cancel`, `meetings-rename`; Series detail page; Manage Guests dialog | Andy can create a new biweekly series end-to-end, including a Teams join URL, without touching Outlook |
| **V2.3 Agendas** | `calendar_series/{seriesId}/agendas/{agendaId}` reads/writes; Agenda page (notes + topics + threaded comments); Calendar-Agenda sync | Andy can write next BMD biweekly's agenda in Management; it shows up against the right Graph event |
| **V2.4 Invites + Prep** | Send Meeting Invite button (separate from Save), Meeting Prep email | Explicit one-click send to attendees works |
| **V2.5 Cutover** | Tate-meetings migration script (one-shot), Console events → `calendar_series` backfill, prod cutover | All recurring meetings live in Management; Outlook stops being a write path |

**V2.1 is the first ship target** — it directly addresses the 2026-05-20 GV-Bi-Weekly reschedule pain (90-min shell session for a single 1hr shift).

This brief covers all of V2 architecturally, details V2.1 file-by-file, and sketches V2.2-V2.5 enough for ordering and dependency reasoning. Each later slice gets its own focused plan when Andy is ready to schedule it.

---

## Context: Why This Brief Exists Now

Two prior docs touch V2:

1. **`docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` §7** — V2 sketch written during the spinout. Brief, Google-leaning, intentionally incomplete.
2. **`docs/superpowers/specs/2026-05-20-meetings-v2-design.md`** — 393-line Google-only design doc written in Switchboard. **Architecturally superseded** by the 2026-05-27 HANDOFF (Andy revised the architectural direction to dual-write Graph + Google after that doc was drafted). Still useful for data model §4, FE surfaces §6, security rules §7, and phasing §9 — but §0, §3, §5, §11 must be read as **superseded**.

3. **`dev/HANDOFF_2026-05-27_MEETING_SCHEDULER_KICKOFF.md`** — the **current** architectural direction. Re-states the dual-write decision: Graph (canonical, Teams URL native, fans .ics) + Google (mirror, Vistamar internal team's calendars). Per Andy on 2026-05-27: "the M365-primary direction supersedes — don't re-litigate that decision."

This brief reconciles them. After Andy approves, the 2026-05-20 spec gets a `**SUPERSEDED 2026-05-27 — see docs/plans/2026-05-27-meeting-scheduler-port.md**` header on its §3/§5/§11 sections.

---

## Sources of Truth — Read Before Coding

**Always read in this order before any V2 code work:**

1. **`CLAUDE.md`** (project root) + **`~/.claude/CLAUDE.md`** (global) — non-negotiable conventions
2. **`dev/HANDOFF_2026-05-27_MEETING_SCHEDULER_KICKOFF.md`** — canonical architecture
3. **This file** — implementation brief
4. **`docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`** §4 (data model — V1) and §7 (V2 sketch)
5. **`docs/superpowers/specs/2026-05-20-meetings-v2-design.md`** §4 (data model — V2), §6 (FE surfaces), §7 (security rules), §9 (phasing). **Skip §0, §3, §5, §11** — superseded.
6. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/`** — Vercel implementation being ported
7. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/_lib/graph-events.js`** — Graph PATCH/POST/DELETE logic. ~70% survives.
8. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/_lib/google-calendar.js`** — Google API client. ~60% survives. Re-auth becomes GCP ADC inside Functions.
9. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/Agenda.jsx`** (6,475 lines) — Console meetings UI. Read chunked.
10. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/feature_memory/`** — `Meeting_Agendas.md`, `Meeting_Agendas_Board_View.md`, `Calendar_Agenda_Sync.md`, `Agenda_Action_Bar.md`, `Agenda_Detail_View.md`, `Meeting_Prep_Email.md`, `Meetings_API.md`. The *why* behind each archive decision.
11. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/HANDOFF_2026-04-30_TATE_MIGRATION.md`** — Tate → meetings@ migration playbook. V2.5 prerequisite.

**Read order recommendation:** HANDOFF (2026-05-27) → this file end-to-end → 2026-05-12 spec §4 → 2026-05-20 spec §4/§6/§7/§9 → archive `_lib/graph-events.js` + `_lib/google-calendar.js` → archive `reschedule.js` → `feature_memory/Meeting_Agendas.md` + `Calendar_Agenda_Sync.md` → start V2.0/V2.1.

---

## State of the Repo Right Now (V2 Starting Point)

### What's already built (KEEP — V1 surface, do not rewrite)

V1 production is stable at https://vm-management-front-end.vercel.app. 5 users signed in. Last commit on `origin/dev` is `6a067ba`.

| Path | Purpose |
|---|---|
| `src/firebase.js` | Web SDK init |
| `src/contexts/AuthContext.jsx` | Google SSO + `users/{uid}` bootstrap |
| `src/hooks/{useDoc, useCollection, useItems}.js` | Real-time Firestore listeners |
| `src/pages/{TaskBoard, ItemDetail, Members, Organizations, Settings, Profile, Dashboard, SignIn}.jsx` | V1 pages |
| `src/components/Sidebar.jsx` | Will get Calendar + Agendas links in V2 |
| `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc`, `firestore.indexes.json` | Deployed, V1 ruleset |
| `src/theme/*` | MUI + Emotion theme |
| `src/constants/itemStatuses.js`, `itemPriorities.js` | Status/priority enums |

### What does NOT exist yet (V2 will add)

- `functions/` — Cloud Functions root (Blaze prereq)
- `src/pages/Calendar.jsx` — list view
- `src/pages/Agenda.jsx` — detail page
- `src/components/{RescheduleDialog, ManageGuestsDialog, SendInviteButton}.jsx`
- `src/hooks/{useCalendarSeries, useAgenda, useAgendas}.js`
- Firestore collections: `calendar_series` (top-level) + subcollections
- Firestore rules for `calendar_series`
- Composite indexes for agendas queries

### Pre-implementation blockers (status as of 2026-05-27)

- [ ] **Blaze upgrade** for `management-db9eb` — Andy confirmed will upgrade. No Cloud Functions deploy until this lands.
- [ ] **TaskBoard.jsx extraction (#8 from DEFERRED_PLAYBOOK)** — Andy confirmed will run in a focused session before V2 code begins. Extracts `useItemMutations()` so V2.3 (agenda → linked items) doesn't duplicate item-create logic if/when that lands.
- [ ] **Microsoft Graph creds in GCP Secret Manager** — currently in Azure VistamarVault. Migrate `teams-client-id`, `teams-client-secret`, `teams-tenant-id`, `teams-host-user-id` to GCP `management-db9eb` project's Secret Manager. Source secrets MUST be re-pulled (don't copy from existing JS files — they'd be stale).
- [ ] **Google service account key in GCP Secret Manager** (`meetings-service-account-key`) — reuse `console-meetings-service@console-meetings.iam.gserviceaccount.com` (in GCP project `Console-Meetings`). Either grant the Management Functions runtime SA `iam.serviceAccountTokenCreator` on `console-meetings-service@`, or generate a new key and store it.
- [ ] **App registration** in Microsoft 365 admin — confirm `meetings@` app has `Calendars.ReadWrite` + `Mail.Send` Graph permissions (Console did this; if the tenant is the same, reuse; otherwise re-grant).
- [ ] **Tate's meetings migration** — separate one-shot script per HANDOFF; V2.5 prereq. Does NOT block V2.0/V2.1.

---

## V2 Architecture

Inherits everything from the 2026-05-12 spinout spec §3. V2 adds:

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser (Vite SPA)                                               │
│  ─────────────────                                                │
│  • Calendar page → Firestore onSnapshot(calendar_series)          │
│  • Agenda page  → Firestore onSnapshot(calendar_series/.../       │
│                                          agendas/{agendaId})      │
│  • Mutations that touch Graph + Google → React Query →            │
│    HTTPS callable Cloud Function                                  │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
                ┌────────────────────────────────────┐
                │  Firebase Cloud Functions          │
                │  (Node 20, in `functions/`,        │
                │  region us-west1)                  │
                │                                    │
                │  meetings/                         │
                │    create.js          → Graph + Google
                │    cancel.js          → Graph + Google
                │    reschedule.js      → Graph + Google
                │    rename.js          → Graph + Google
                │    attendees.js       → Graph + Google
                │    list.js            → Graph (canonical read)
                │    send-prep.js       → Gmail API as meetings@
                │    send-schedule.js   → (rarely used; Graph fans   │
                │                          .ics natively on create)  │
                │    _lib/                                            │
                │      graph-events.js     ← canonical write         │
                │      google-calendar.js  ← mirror write            │
                │      gmail-send.js       ← prep emails             │
                │      auth.js             ← callable middleware     │
                │                                    │
                │  Auth: every callable verifies     │
                │  context.auth.token.email ends     │
                │  with @vistamarconsulting.com AND  │
                │  users/{uid}.active == true.       │
                │                                    │
                │  Secrets (GCP Secret Manager):     │
                │    teams-client-id                 │
                │    teams-client-secret             │
                │    teams-tenant-id                 │
                │    teams-host-user-id              │
                │    meetings-service-account-key    │
                └────────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────────────────────┐
                │  Microsoft Graph (canonical)                     │
                │  • POST /users/{hostUserId}/events               │
                │    isOnlineMeeting: true → Teams URL minted      │
                │  • Fans .ics to ALL attendees from Outlook       │
                │                                                  │
                │  Google Calendar (mirror — internal team)        │
                │  • events.insert on meetings@'s primary cal      │
                │  • Teams URL embedded in conferenceData/desc     │
                │  • sendUpdates="none" (Graph already invited)    │
                │                                                  │
                │  Gmail (meetings@)                               │
                │  • Prep emails (separate from .ics invite)       │
                │  • Scope: gmail.send                             │
                └──────────────────────────────────────────────────┘
```

**Why dual-write:**
- Vistamar clients use Outlook/M365 → Graph-native `.ics` invitation flow gives them the cleanest experience and a Teams URL they already know how to join.
- Vistamar internal team uses Google Workspace → Google Calendar mirror makes the meeting appear on their calendars without manual entry.
- Graph is **canonical** for invite delivery and Teams URL. Google is **mirror-only** for visibility on internal calendars.

**Conferencing:** Teams URL (from `isOnlineMeeting: true`), embedded in Google mirror's `conferenceData` + description. NO Google Meet. The 2026-05-20 spec's "Google Meet only" framing is OUT.

**Cloud Functions region:** `us-west1` (matches Firestore — see CLAUDE.md).

**Authentication:**
- Graph: client-credentials flow with app registration (`teams-client-id`, `teams-client-secret`, `teams-tenant-id`). Token cached in Function memory; refresh on 401.
- Google: GCP ADC inside Functions runtime. Service account: `meetings-service-account@` (or reuse `console-meetings-service@`) with domain-wide delegation, subject = `meetings@vistamarconsulting.com`.
- Gmail: same Google service account, scope `https://www.googleapis.com/auth/gmail.send`, subject = `meetings@`.

---

## Data Model (Firestore)

Authoritative shape — reuses 2026-05-20 spec §4 verbatim with one addition (`graphEventId` field on series, since Graph is canonical):

```
calendar_series/{seriesId}                ← seriesId = Graph series eventId (canonical)
  organizationId: string                  ← tag, references organizations/{slug}
  title: string                           ← "GV – Biweekly"
  graphEventId: string                    ← Microsoft Graph series eventId (canonical, == seriesId)
  graphICalUID: string                    ← Graph iCalUId (RFC 5545 stable identifier)
  googleCalendarId: string                ← always 'primary' (meetings@'s)
  googleSeriesEventId: string             ← Google Calendar recurring event id (mirror)
  recurrence: string[]                    ← RRULE strings (Graph + Google both accept RFC 5545)
  defaultStart: { hour, minute, tz }      ← canonical series start time
  defaultDurationMinutes: number          ← 60 typical
  defaultLocation: string | null
  conferenceType: 'teams'                 ← always 'teams' (no Meet)
  defaultAttendees: [{ email, displayName, memberId, optional }]
  description: string
  createdAt, updatedAt: Timestamp
  createdByUid, updatedByUid: string
  archived: bool                          ← soft-delete; cancellation removes from Graph + Google but doc stays for history
  ─ subcollections ──
  agendas/{agendaId}                      ← agendaId = Graph instance eventId
    graphEventId: string                  ← per-instance Graph event id (for reschedule patches)
    googleEventId: string                 ← per-instance Google event id (mirror)
    iCalUID: string                       ← Graph instance iCalUId
    meetingDatetime: Timestamp            ← source of truth for "when"
    durationMinutes: number               ← per-instance override; defaults to series
    status: 'draft' | 'sent' | 'archived'
    title: string                         ← per-instance override; defaults to series title
    notes: string                         ← free text / markdown
    attendees: [{ email, displayName, memberId, responseStatus, optional }]
    teamsJoinUrl: string | null           ← from Graph (NOT meetUrl — we're using Teams)
    rescheduledFrom: Timestamp | null     ← original time if this instance is an exception
    cancelledAt: Timestamp | null
    createdAt, updatedAt: Timestamp
    createdByUid, updatedByUid: string
    ─ subcollections ──
    topics/{topicId}
      title: string
      notes: string
      order: number                       ← fractional rank string (uses fractional-indexing, same as items)
      ownerMemberId: string | null
      linkedItemIds: string[]             ← items/{itemId} references — click-through only in V2
      createdAt, updatedAt: Timestamp
      ─ subcollection ──
      comments/{commentId}                ← same shape as items/.../comments
        authorId, body, parentCommentId, createdAt
```

**Key decisions vs. 2026-05-20 spec §4:**
- Added `graphEventId` + `graphICalUID` on series, `graphEventId` + `iCalUID` on agendas (Graph IDs join Google IDs as denormalized refs).
- Renamed `meetUrl` → `teamsJoinUrl` on agenda doc.
- `conferenceType` is `'teams'` (was `'meet'`).
- Everything else unchanged: `meetingDatetime` source-of-truth on agenda doc, attendees as array (not subcollection), `archived` + `cancelledAt` soft-delete pattern.

**Composite indexes (new):**
- `agendas` collection group: `(organizationId ASC, meetingDatetime ASC)` — Calendar page upcoming-list query.
- `agendas` collection group: `(status ASC, meetingDatetime DESC)` — Pending/Sent filter on agenda board.

**Storage paths (added to `storage.rules`):**
- `gs://management-db9eb.firebasestorage.app/agendas/{agendaId}/{filename}` — agenda attachments (V2.3+)
- `gs://management-db9eb.firebasestorage.app/topics/{topicId}/{filename}` — topic-card attachments (V2.3+)

---

## Security Rules

Extends V1 rules. Add to `firestore.rules`:

```js
match /calendar_series/{seriesId} {
  // Read: any active VM user
  allow read: if isActiveVMUser();

  // Direct create: any active VM user can create a doc, BUT must not set Graph/Google IDs themselves
  // (those come back from the callable that owns the Graph+Google write).
  // Practical effect: client creates a draft series with title/org/recurrence, callable backfills IDs.
  allow create: if isActiveVMUser()
    && !request.resource.data.keys().hasAny([
         'graphEventId', 'graphICalUID',
         'googleSeriesEventId'
       ]);

  // Update: any active VM user EXCEPT for fields that must round-trip through Graph + Google
  allow update: if isActiveVMUser()
    && !request.resource.data.diff(resource.data).affectedKeys()
        .hasAny([
          'graphEventId', 'graphICalUID',
          'googleSeriesEventId',
          'recurrence', 'defaultStart', 'defaultDurationMinutes',
          'defaultAttendees',
        ]);

  // Delete: admin only (soft-delete via archived=true is the normal path)
  allow delete: if isAdmin();

  match /agendas/{agendaId} {
    allow read: if isActiveVMUser();
    allow create: if isActiveVMUser()
      && !request.resource.data.keys().hasAny([
           'graphEventId', 'googleEventId', 'iCalUID'
         ]);

    // Same denylist on fields that touch Graph + Google
    allow update: if isActiveVMUser()
      && !request.resource.data.diff(resource.data).affectedKeys()
          .hasAny([
            'graphEventId', 'googleEventId', 'iCalUID',
            'meetingDatetime', 'durationMinutes',
            'attendees', 'cancelledAt', 'teamsJoinUrl',
          ]);

    allow delete: if isAdmin();

    match /topics/{topicId} {
      // Topics are pure Firestore — no Graph/Google sync. Open writes.
      allow read, create, update, delete: if isActiveVMUser();

      match /comments/{commentId} {
        allow read: if isActiveVMUser();
        allow create: if isActiveVMUser();
        allow update, delete: if resource.data.authorId == request.auth.uid;
      }
    }
  }
}
```

**Title-only edits stay direct from FE → fast typing UX. Anything touching Graph/Google goes through a callable.**

---

## Cloud Functions Catalog (V2 complete)

All HTTPS callable. Auth gate from `_lib/auth.js`: reject unless `context.auth.token.email` ends in `@vistamarconsulting.com` AND `users/{uid}.active == true`.

| Function | Method shape | Port from archive | V2 slice |
|---|---|---|---|
| `meetings-create` | `{ orgId, title, startIso, durationMinutes, recurrence, attendees, description }` → `{ seriesId, graphEventId, googleSeriesEventId, teamsJoinUrl }` | `api/meetings/create.js` | V2.2 |
| `meetings-reschedule` | `{ seriesId, agendaId, mode: 'instance'\|'series', newStartIso, newDurationMinutes?, notifyAttendees: bool }` → `{ ok }` | `api/meetings/reschedule.js` | **V2.1** ⭐ |
| `meetings-cancel` | `{ seriesId, agendaId?, mode: 'instance'\|'series', notifyAttendees: bool }` → `{ ok }` | `api/meetings/cancel.js` | V2.2 |
| `meetings-rename` | `{ seriesId, newTitle, applyTo: 'future'\|'all' }` → `{ ok }` | `api/meetings/rename.js` | V2.2 |
| `meetings-attendees` | `{ seriesId, add: [], remove: [], applyTo: 'future'\|'all' }` → `{ ok }` | `api/meetings/attendees.js` | V2.2 |
| `meetings-list` | `{ orgId?, from: iso, to: iso }` → `{ series: [...], agendas: [...] }` | `api/meetings/list.js` | **V2.1** (smoke test) / V2.5 (backfill) |
| `meetings-sendPrep` | `{ agendaId }` → `{ ok }` | `api/meetings/send-prep.js` | V2.4 |
| `meetings-sendSchedule` | `{ agendaId }` → `{ ok }` | `api/meetings/send-schedule.js` | V2.4 (optional — Graph already fanned .ics on create) |

**Deleted from archive (do NOT port):**
- `_lib/keyvault.js` — Azure Key Vault gone; replace with GCP Secret Manager via `@google-cloud/secret-manager`
- `_lib/relay-mail.js` — Postmark gone; Gmail API + Graph sendMail replace it

**Rewritten:**
- `_lib/auth.js` — Firebase Auth callable middleware (native; ~10 lines vs archive's ~50)
- `_lib/gmail-send.js` — NEW, replaces relay-mail. Uses Google service account, scope `gmail.send`, subject `meetings@`.

**Survives largely intact (~70% of archive):**
- `_lib/graph-events.js` event create/patch/delete logic — change auth path from Azure KV → GCP Secret Manager; everything else stays.
- `_lib/google-calendar.js` event create/patch/delete logic — change auth path from JSON-from-KV → GCP ADC; remove the Teams-add-on workaround (Graph mints Teams URL natively, we just embed it).
- Attendee helpers (`_lib/attendee-helpers.js`)
- Endpoint-level orchestration in `create.js`, `cancel.js`, `reschedule.js`, etc.

---

## Frontend Surfaces (per 2026-05-20 spec §6, reused verbatim)

### Calendar Page (`/calendar`)

Two-pane:
- **Left: Series list** — table of `calendar_series` filtered by Organization chips (same chip pattern as Project Board's `OrgFilterChips`). Columns: Title, Org, Recurrence summary ("Every other Tuesday 12:30pm PT"), Default attendees count, Next occurrence. Row click → Series detail page.
- **Right: Upcoming agendas** — flat list of next ~20 agendas across all series (filtered by same chips), sorted by `meetingDatetime`. Each card shows time, title, attendee chips, status pill (draft/sent), inline buttons: **Reschedule**, **Cancel**, **Open agenda**.

No FullCalendar grid view in V2 — list view is enough until series volume justifies it. (Console's archive Calendar.jsx is an 87-line FullCalendar scaffold with demo events — not real meetings UI.)

### Series Detail Page (`/calendar/series/:seriesId`) — V2.2

Header: title, org, recurrence summary, Edit Series, Cancel Series buttons.
Default attendees: chip list + Manage Guests button.
Past + Upcoming agendas table (paginated): time, title, status, Open/Reschedule/Cancel per row.

### Reschedule Dialog ⭐ — V2.1

**The dialog that would have saved Andy the 90-minute shell session on 2026-05-20.**

- Triggered from: agenda card on Calendar page, agenda row on Series detail, agenda page header
- Fields:
  - **Scope** (radio): `Just this meeting (YYYY-MM-DD)` (default) | `This and all future` | `Entire series`
  - **New date** (date picker, defaults to current; uses MUI x-date-pickers DatePicker per Console archive)
  - **New time** (time picker, defaults to current start, 15-min increments, timezone-aware)
  - **Duration** (defaults to current; only shown if user opens "Advanced")
  - **Notify attendees** (checkbox, default ON)
- Submit → React Query mutation → `meetings-reschedule` callable
- On success: dialog closes, toast "Meeting moved to 1:30pm PT", Firestore snapshot updates the row in place
- On error: inline error, no dialog close. Common error: Graph API rate limit → retry guidance.

**Implementation note:** the dialog is a thin form. Conflict logic (instance vs series, sendUpdates flag) lives in the callable. FE collects fields, calls the function, watches for the doc to update.

### Manage Guests Dialog — V2.2

Add/remove attendees from a series. Two scopes via radio: `Apply to future meetings only` (default) | `Apply to all (including past)`. Internal members surface as a member-picker (autocomplete from `users/`); external attendees are free-text email + display name.

### Agenda Page (`/calendar/agenda/:agendaId`) — V2.3

Lifts wholesale from archive's `feature_memory/Agenda_Detail_View.md`. Sections:
- Header (title, datetime, attendees, Teams join URL link, **Send Invite** button if not yet sent, Reschedule, Cancel)
- Notes (markdown editor, autosave to Firestore)
- Topics (cards, drag-reorder via fractional rank, threaded comments per topic)
- Action items (linked items from Project Board — V2 simplified: chips list of `linkedItemIds`, click-through to item; full Mini Project Board embed deferred to V2.6 or later)

### Send Meeting Invite Button — V2.4

In V2.0-V2.2 the Graph create call **already fans .ics to all attendees** (that's the canonical invite). The Send Invite button on the Agenda page is used for **re-sending or for prep emails**, not the initial invite. Per archive's `Meeting_Prep_Email.md` feature memory.

---

## The Port — File by File (V2.1 Scope Only)

V2.0 + V2.1 file inventory. V2.2-V2.5 will get their own focused plans.

### 1. `functions/` — Cloud Functions root (NEW — Blaze prereq)

Created via `firebase init functions` after Blaze upgrade. Uses Node 20 (latest supported runtime).

```
functions/
├── package.json
├── tsconfig.json (or pure JS — match Console's archive style which is JS)
├── src/
│   ├── index.js           ← entry; exports all callables
│   ├── meetings/
│   │   ├── reschedule.js  ← V2.1
│   │   ├── list.js        ← V2.1 (smoke test)
│   │   └── _lib/
│   │       ├── graph-events.js
│   │       ├── google-calendar.js
│   │       ├── secrets.js  ← NEW: GCP Secret Manager fetch helper
│   │       └── auth.js
│   └── scripts/           ← one-shot scripts; not deployed as callables
└── .gitignore
```

### 2. `functions/src/meetings/_lib/secrets.js` (NEW)

**Purpose:** centralized GCP Secret Manager access. Replaces archive's `_lib/keyvault.js`.

```js
// functions/src/meetings/_lib/secrets.js
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();
const PROJECT_ID = "management-db9eb";
const cache = new Map();

export async function getSecret(name) {
  if (cache.has(name)) return cache.get(name);
  const [version] = await client.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
  });
  const value = version.payload.data.toString("utf8");
  cache.set(name, value);
  return value;
}
```

**Secrets to set up (manually via `gcloud secrets create`):**
- `teams-client-id`
- `teams-client-secret`
- `teams-tenant-id`
- `teams-host-user-id` (the UPN/ObjectId for `meetings@`)
- `meetings-service-account-key` (JSON content of the service account key)

### 3. `functions/src/meetings/_lib/auth.js` (NEW — rewritten from archive)

**Purpose:** callable middleware. Verifies request is from a signed-in active VM user.

```js
// functions/src/meetings/_lib/auth.js
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

export async function requireActiveVMUser(request) {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign-in required");
  if (!auth.token.email?.endsWith("@vistamarconsulting.com"))
    throw new HttpsError("permission-denied", "Vistamar domain required");

  const userDoc = await getFirestore().doc(`users/${auth.uid}`).get();
  if (!userDoc.exists || userDoc.data().active !== true)
    throw new HttpsError("permission-denied", "Inactive user");

  return { uid: auth.uid, email: auth.token.email, profile: userDoc.data() };
}
```

### 4. `functions/src/meetings/_lib/graph-events.js` (PORT)

**Source:** `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/_lib/graph-events.js`
**Target:** `functions/src/meetings/_lib/graph-events.js`

**Changes:**
- Replace `keyvault.js` import with `secrets.js` (new GCP path)
- Token cache stays — same in-memory pattern works in Functions runtime
- All `fetch` PATCH/POST/DELETE logic against `https://graph.microsoft.com/v1.0/users/{hostUserId}/events/{eventId}` stays verbatim
- Remove any code path that was wrapping `relay-mail.js` Postmark sends — that's a separate module
- Export: `getGraphToken()`, `createGraphEvent(payload)`, `patchGraphEvent(eventId, payload)`, `deleteGraphEvent(eventId, { sendCancellations })`, `getGraphEvent(eventId)`, `listGraphEvents({ from, to })`

**Verify in port:** the `isOnlineMeeting: true` flag + the `onlineMeetingProvider: "teamsForBusiness"` flag are still set in the create path. (These mint the Teams URL natively. Removing them would break the conferencing.)

### 5. `functions/src/meetings/_lib/google-calendar.js` (PORT)

**Source:** `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/_lib/google-calendar.js`
**Target:** `functions/src/meetings/_lib/google-calendar.js`

**Changes:**
- Replace Azure KV JSON pull with GCP ADC pattern. Service account auth via `google-auth-library` JWT, subject = `meetings@vistamarconsulting.com`.
- **DELETE** the `appendAddOnQuerystring` / `buildConferenceData` Teams-add-on workaround (~80 lines). It was reverse-engineered to make Google Calendar's "Join meeting" button work with a Teams URL embedded via conference data. In V2 we just put the Teams URL in the event's `description` + `location` fields; we don't need Google Calendar's native conference UI for the mirror.
- Keep: `events.insert`, `events.patch`, `events.delete`, `events.list` for the meetings@ primary calendar.
- All Google mirror writes set `sendUpdates: "none"` — Graph already invited everyone.
- Export: `getGoogleAuth()`, `insertGoogleEvent(payload)`, `patchGoogleEvent(eventId, payload)`, `deleteGoogleEvent(eventId)`, `getGoogleEvent(eventId)`, `listGoogleEvents({ from, to })`

### 6. `functions/src/meetings/list.js` (PORT — V2.1 smoke test)

**Source:** `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/list.js`
**Target:** `functions/src/meetings/list.js`

**Purpose:** read endpoint. Most FE reads go direct to Firestore via `onSnapshot`, but `list` is the V2.0 smoke test and the V2.5 backfill source. It queries Graph (canonical) and returns the structured list of series + agendas in the requested window.

**Implementation:**
```js
// functions/src/meetings/list.js
import { onCall } from "firebase-functions/v2/https";
import { requireActiveVMUser } from "./_lib/auth.js";
import { listGraphEvents } from "./_lib/graph-events.js";

export const meetingsList = onCall(
  { region: "us-west1" },
  async (request) => {
    await requireActiveVMUser(request);
    const { from, to } = request.data;
    if (!from || !to)
      throw new HttpsError("invalid-argument", "from + to required");
    return await listGraphEvents({ from, to });
  }
);
```

### 7. `functions/src/meetings/reschedule.js` (PORT — V2.1 ⭐)

**Source:** `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/reschedule.js`
**Target:** `functions/src/meetings/reschedule.js`

**Purpose:** the dialog that would have saved Andy 90 minutes on 2026-05-20.

**Implementation skeleton:**
```js
// functions/src/meetings/reschedule.js
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireActiveVMUser } from "./_lib/auth.js";
import { patchGraphEvent } from "./_lib/graph-events.js";
import { patchGoogleEvent } from "./_lib/google-calendar.js";

export const meetingsReschedule = onCall(
  { region: "us-west1", secrets: [
    "teams-client-id", "teams-client-secret",
    "teams-tenant-id", "teams-host-user-id",
    "meetings-service-account-key",
  ]},
  async (request) => {
    const { uid } = await requireActiveVMUser(request);
    const { seriesId, agendaId, mode, newStartIso, newDurationMinutes, notifyAttendees } = request.data;
    if (!seriesId || !agendaId || !mode || !newStartIso)
      throw new HttpsError("invalid-argument", "seriesId/agendaId/mode/newStartIso required");

    const db = getFirestore();
    const seriesRef = db.doc(`calendar_series/${seriesId}`);
    const agendaRef = seriesRef.collection("agendas").doc(agendaId);

    const [seriesSnap, agendaSnap] = await Promise.all([seriesRef.get(), agendaRef.get()]);
    if (!seriesSnap.exists) throw new HttpsError("not-found", "Series not found");
    if (!agendaSnap.exists) throw new HttpsError("not-found", "Agenda not found");

    const series = seriesSnap.data();
    const agenda = agendaSnap.data();

    const newStart = new Date(newStartIso);
    const newEnd = new Date(newStart.getTime() + (newDurationMinutes ?? agenda.durationMinutes) * 60000);

    if (mode === "instance") {
      // PATCH Graph instance event — Graph fans cancellation/update .ics to all attendees if notify=true
      await patchGraphEvent(agenda.graphEventId, {
        start: { dateTime: newStart.toISOString(), timeZone: "UTC" },
        end:   { dateTime: newEnd.toISOString(),   timeZone: "UTC" },
      }, { sendCancellations: notifyAttendees });

      // PATCH Google mirror — sendUpdates="none" (Graph already invited)
      await patchGoogleEvent(agenda.googleEventId, {
        start: { dateTime: newStart.toISOString(), timeZone: "UTC" },
        end:   { dateTime: newEnd.toISOString(),   timeZone: "UTC" },
      });

      // Update Firestore agenda doc
      await agendaRef.update({
        meetingDatetime: newStart,
        durationMinutes: newDurationMinutes ?? agenda.durationMinutes,
        rescheduledFrom: agenda.meetingDatetime,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: uid,
      });
    } else if (mode === "series") {
      // PATCH Graph series master event (changes defaultStart, applies to all future occurrences)
      // ... (port from archive's series-mode logic in reschedule.js)
    } else {
      throw new HttpsError("invalid-argument", "mode must be 'instance' or 'series'");
    }

    return { ok: true };
  }
);
```

**Verify against archive's `reschedule.js` for:** error handling on Graph 412 (ETag conflicts), Google 404 (event already moved), retry on transient 5xx.

### 8. `functions/src/index.js` (NEW)

```js
// functions/src/index.js
import { initializeApp } from "firebase-admin/app";
initializeApp();

export { meetingsList } from "./meetings/list.js";
export { meetingsReschedule } from "./meetings/reschedule.js";
// V2.2+ additions land here
```

### 9. `src/pages/Calendar.jsx` (NEW — V2.1, read-only)

**Purpose:** read-only list of `calendar_series` + upcoming agendas, filterable by Organization chips. Reschedule + Cancel inline on each agenda card.

**Implementation:** two-pane layout matching FE surfaces §6.1. Series list (left) + Upcoming agendas list (right). Both subscribe via `useCollection`. Org filter chips port the `OrgFilterChips` component from V1 TaskBoard.

```jsx
// src/pages/Calendar.jsx (sketch)
import { collection, query, orderBy, where } from "firebase/firestore";
import { useCollection } from "../hooks/useCollection";
import { db } from "../firebase";
import OrgFilterChips from "../components/OrgFilterChips";
import RescheduleDialog from "../components/RescheduleDialog";
// ...
```

**State:**
- `orgFilter` via `useLocalStorage('vm-calendar-org-filter', 'all')` — matches TaskBoard pattern
- `rescheduleTarget` — `{ seriesId, agendaId } | null` — open dialog when set

### 10. `src/components/RescheduleDialog.jsx` (NEW — V2.1 ⭐)

**Purpose:** the V2.1 ship target. Form + React Query mutation → `meetings-reschedule` callable.

**Fields:**
- Scope radio: instance / series / all-future
- Date picker (MUI x-date-pickers DatePicker)
- Time picker (MUI x-date-pickers TimePicker, 15-min step)
- Duration (advanced toggle)
- Notify attendees checkbox

**Mutation pattern (matches V1's use of React Query for callables only):**
```js
import { useMutation } from "@tanstack/react-query";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

const reschedule = httpsCallable(functions, "meetingsReschedule");
const mutation = useMutation({
  mutationFn: (payload) => reschedule(payload),
  onSuccess: () => { toast.success("Meeting moved"); onClose(); },
  onError: (err) => setError(err.message),
});
```

### 11. `src/hooks/useCalendarSeries.js` + `useAgenda.js` + `useAgendas.js` (NEW)

Thin domain wrappers around `useCollection`/`useDoc`:

```js
// src/hooks/useCalendarSeries.js
import { useCollection } from "./useCollection";
import { collection, orderBy } from "firebase/firestore";
import { db } from "../firebase";
export function useCalendarSeries() {
  return useCollection("calendar_series", [orderBy("title", "asc")]);
}

// src/hooks/useAgendas.js — for upcoming agenda list (collection group query)
export function useUpcomingAgendas({ from, to }) {
  // Uses collectionGroup("agendas") + where("meetingDatetime", ">=", from) etc.
  // Composite index: (organizationId ASC, meetingDatetime ASC)
}
```

### 12. `src/routes.jsx` — add Calendar route

```jsx
<Route path="/calendar" element={<Calendar />} />
// V2.2+: /calendar/series/:seriesId, /calendar/agenda/:agendaId
```

### 13. `src/components/Sidebar.jsx` — add Calendar link

Add a "Calendar" item under Dashboard. Icon: `<CalendarMonth />` from `@mui/icons-material`. Active when path is `/calendar*`.

### 14. `src/firebase.js` — add Functions client

```js
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
export const functions = getFunctions(app, "us-west1");
if (location.hostname === "localhost") {
  // optional emulator wiring once we set up the Functions emulator
  // connectFunctionsEmulator(functions, "localhost", 5001);
}
```

### 15. `firestore.rules` + `firestore.indexes.json` — add V2 rules + indexes

See **Security Rules** section above for rules. Indexes:

```json
// firestore.indexes.json — add:
{
  "collectionGroup": "agendas",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "organizationId", "order": "ASCENDING" },
    { "fieldPath": "meetingDatetime", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "agendas",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "meetingDatetime", "order": "DESCENDING" }
  ]
}
```

---

## Field Mapping Reference (Archive → V2)

Archive uses some PascalCase + some Hugo-shaped naming. V2 uses camelCase per CLAUDE.md "Cross-Stack Naming Parity."

| Archive | V2 (Firestore + FE + callables) | Notes |
|---|---|---|
| `Calendar_Series_Id` | `seriesId` / Firestore doc ID | == Graph series eventId |
| `Series_Title` | `title` | |
| `Graph_Event_Id` | `graphEventId` | |
| `Google_Event_Id` | `googleEventId` | |
| `iCalUId` (Graph) | `iCalUID` (matches RFC 5545 casing on agendas) | |
| `Meeting_Datetime` | `meetingDatetime` | Firestore `Timestamp` |
| `Default_Start` | `defaultStart: { hour, minute, tz }` | |
| `Duration_Minutes` | `durationMinutes` | |
| `Recurrence_Pattern` | `recurrence: string[]` | RRULE array |
| `Attendees` | `attendees: [{ email, displayName, memberId, responseStatus, optional }]` | Array, not subcollection |
| `Topic_Order` | `order` (fractional string) | Same lib as items (`fractional-indexing`) |
| `Topic_Owner_Member_Id` | `ownerMemberId` | UID |
| `Linked_Item_Ids` | `linkedItemIds: string[]` | `items/{itemId}` refs |
| `Org_Id` | `organizationId` | Slug |
| `Created_By` / `Updated_By` | `createdByUid` / `updatedByUid` | UID |

---

## Behavior Parity Checklist (V2.1 Done When)

Verify each before declaring V2.1 done. Use Playwright via `agent-browser` `--profile "Profile 10"` against the deployed preview URL.

### Cloud Functions
- [ ] `firebase deploy --only functions` succeeds (requires Blaze)
- [ ] `meetings-list` callable returns Graph events for a 7-day window
- [ ] `meetings-reschedule` `instance` mode: PATCH Graph + PATCH Google + update Firestore agenda doc — all three confirmed in logs + console
- [ ] `meetings-reschedule` `series` mode: PATCH Graph series master + PATCH Google series master + update Firestore series doc
- [ ] Errors propagate to FE as `HttpsError` with code + message
- [ ] Token cache works (no `getGraphToken()` call on every request after warmup)
- [ ] Secrets resolve from GCP Secret Manager — no Azure KV calls

### Calendar Page
- [ ] `/calendar` route exists, sidebar link present, active state correct
- [ ] Loads series list from Firestore via `useCalendarSeries`
- [ ] Loads upcoming agendas (next 20) via collection-group query
- [ ] Org filter chips work — filtering both panes
- [ ] Each agenda card shows: time, title, attendee chips, status pill, Reschedule + Cancel + Open buttons
- [ ] Loading state: subtle "Loading..." caption (not giant spinner — matches V1 pattern)
- [ ] Empty state: italic "No upcoming meetings" caption

### Reschedule Dialog
- [ ] Opens from agenda card "Reschedule" button
- [ ] Date picker, time picker, duration field, scope radio, notify checkbox all render
- [ ] Submit: invokes `meetingsReschedule` callable, shows pending state
- [ ] Success: closes dialog, toast appears, Firestore listener updates the agenda row in place (no manual refetch)
- [ ] Error: inline error message, dialog stays open, no toast
- [ ] **Andy moves today's GV biweekly to 1:30pm from the UI in <30 seconds** — this is the V2.1 acceptance test

### Real-time + Cross-tab
- [ ] Open `/calendar` in two tabs. Reschedule in tab A. Tab B updates within ~1s.
- [ ] Outlook on a separate machine receives the .ics update email (Graph fanned it).
- [ ] meetings@'s Google Calendar shows the new time (mirror sync confirmed).

### Security
- [ ] Direct Firestore write to `agendas/{agendaId}.meetingDatetime` from FE is REJECTED by rules (must go through callable)
- [ ] Direct write to `agendas/{agendaId}.notes` (free-text) is ALLOWED
- [ ] Non-admin can soft-archive a series (update `archived: true`); cannot hard-delete

---

## Operational Setup — Do These BEFORE V2.0 Code

### 1. Blaze upgrade

Firebase console → Project Settings → Usage and billing → Modify plan → **Blaze (Pay as you go)**. Link a billing account. Expected cost for our usage: ~$0/mo (Cloud Functions free tier covers our volume; Firestore + Storage stay within Spark limits).

After upgrade, `firebase init functions` becomes available.

### 2. Initialize `functions/` scaffold

```bash
cd /Users/andrewdeemer/Vistamar_Consulting/VMManagementFrontEnd
npx firebase init functions
# When prompted:
#   Language: JavaScript (matches archive style)
#   ESLint: Yes
#   Install dependencies: Yes
#   Runtime: Node 20
```

Edit `functions/package.json` to add:
```json
{
  "type": "module",
  "dependencies": {
    "firebase-admin": "^12.x",
    "firebase-functions": "^5.x",
    "google-auth-library": "^9.x",
    "@google-cloud/secret-manager": "^5.x",
    "googleapis": "^140.x"
  }
}
```

Add `functions/.eslintrc.cjs` matching the project root ESLint conventions.

### 3. GCP Secret Manager setup

In GCP Console for `management-db9eb` project (NOT Console-Meetings):

```bash
# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com --project=management-db9eb

# Create secrets (replace VALUES with actual creds)
gcloud secrets create teams-client-id --project=management-db9eb
echo -n "VALUE" | gcloud secrets versions add teams-client-id --data-file=- --project=management-db9eb
# ...repeat for teams-client-secret, teams-tenant-id, teams-host-user-id
# meetings-service-account-key gets the full JSON file:
gcloud secrets create meetings-service-account-key --project=management-db9eb
gcloud secrets versions add meetings-service-account-key --data-file=/path/to/key.json --project=management-db9eb
```

**Source of these secret values:**
- `teams-*`: pull from Azure VistamarVault via `az keyvault secret show` (Andy has access). One-time migration; afterward, Azure KV is no longer in the loop.
- `meetings-service-account-key`: pull from `Console-Meetings` GCP project — `gcloud iam service-accounts keys create` for `console-meetings-service@console-meetings.iam.gserviceaccount.com`. Alternative: reuse existing key if one is still active.

Grant the Functions runtime service account read access to each secret:
```bash
# The Functions default SA is named: {project-number}-compute@developer.gserviceaccount.com
# Find it: gcloud projects describe management-db9eb --format="value(projectNumber)"
gcloud secrets add-iam-policy-binding teams-client-id \
  --member="serviceAccount:{PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" --project=management-db9eb
# Repeat for each secret.
```

### 4. Microsoft 365 app registration verification

Confirm the app registration for `meetings@` has:
- `Calendars.ReadWrite` (Application — not Delegated)
- `Mail.Send` (Application — for future Graph sendMail; optional if we stick to Gmail for all sends)
- Admin consent granted

If the Management tenant differs from Console's tenant, re-grant. Otherwise reuse.

### 5. Local Functions emulator (optional but recommended)

```bash
cd functions/
npx firebase emulators:start --only functions
# Functions emulator runs at localhost:5001
# Connect FE via connectFunctionsEmulator(functions, "localhost", 5001) in dev mode
```

Lets us test callables locally without deploying. Note: Secret Manager **does NOT** work in the emulator — set env vars manually for local dev:

```bash
export FIREBASE_CONFIG='{"projectId":"management-db9eb"}'
export TEAMS_CLIENT_ID=...
# etc.
```

Modify `secrets.js` to fall back to `process.env` when `client.accessSecretVersion` fails (typical local-dev pattern).

### 6. Deploy V2.1 functions

After V2.1 code is written and tested locally:

```bash
cd functions/
npm run lint
npx firebase deploy --only functions:meetingsReschedule,functions:meetingsList --project=management-db9eb
```

Confirm in Firebase console → Functions that both appear in `us-west1`.

---

## Verification Gate (Before Declaring V2.1 Done)

UI verification hard gate per `feedback_self_verify_ui_before_asking.md` memory: **drive the browser yourself before asking Andy.**

1. **`npm run dev` boots cleanly** — Functions client wires up, no console errors on `/calendar` route
2. **Sign in as Andy via agent-browser** (uses his existing Vistamar Chrome profile)
3. **Navigate to `/calendar`** — list renders, org chips work, agendas appear
4. **Click Reschedule on an agenda** — dialog opens, all fields render
5. **Submit a reschedule** — dialog closes, toast appears, agenda row updates in place
6. **Check Outlook (Andy's account)** — invite update email received within ~10s
7. **Check meetings@'s Google Calendar** — event moved to new time
8. **Open Firebase Functions logs** — confirm Graph + Google PATCH succeeded, no errors
9. **Open `/calendar` in a second tab** — confirms cross-tab sync via Firestore listener
10. **Try to reschedule an agenda where the new time is in the past** — confirm error UX is clean (inline error, no console spam)
11. **Take screenshot at each major checkpoint**, save to `dev/sessions/v0_2_0_Andrew_MEETING_SCHEDULER/slice-X-name.png`

Only after all 11 boxes check, write the V2.1 slice summary in `dev/sessions/v0_2_0_Andrew_MEETING_SCHEDULER/context.md` and ask Andy to do final acceptance via a live reschedule of the GV-Bi-Weekly.

---

## Open Questions for Andy Before V2.0 Coding Begins

These are subset of the 2026-05-20 spec's §10 list, reframed for the dual-write architecture.

1. **Notify-attendees default** — V2.1 dialog defaults the `notifyAttendees` checkbox to ON. Confirm? (Alternative: default OFF, user must opt in to email blast. Risk: silent reschedules nobody knows about.)
2. **Series-mode reschedule scope** — current dialog has 3 scopes (instance / future / all). Console's archive only supports instance + series-master. Confirm we want a third "future only" option (Graph supports it via series exception patches).
3. **Recurrence editor — V2.2 vs V2.3** — V2.2's `meetings-create` needs a recurrence editor in the Create Series dialog. Console used a custom Cadence object → RRULE helper. Port that, or build a simpler UX (weekly / biweekly / monthly preset list)?
4. **Conflict detection** — when rescheduling, warn if new time collides with another meeting on meetings@'s Graph calendar? Doable via Graph `getSchedule` API. Nice-to-have for V2.1, or defer to V2.2?
5. **External attendees (non-`@vistamarconsulting.com`)** — they get Graph's .ics invite and can RSVP, but have no Management UI access. Confirm that's fine (they don't need it).
6. **Service account scope** — currently archive uses `https://www.googleapis.com/auth/calendar` (full). V2 can stay full-scope or narrow to `calendar.events` + `gmail.send`. Least-privilege hygiene — narrow it?
7. **Token caching** — Graph token cache stays in Function memory (resets on cold-start, ~1hr typical lifespan). Sufficient? Or move to Firestore-backed cache for warm reuse across cold-starts?

---

## What NOT to Do

- ❌ **Don't re-litigate the dual-write architecture.** It's settled per HANDOFF 2026-05-27. If a future review surfaces a reason to revisit, escalate to Andy explicitly.
- ❌ **Don't port the Teams-add-on conference workaround.** Graph mints Teams URL natively; Google mirror just needs the URL in description/location.
- ❌ **Don't port Postmark / `_lib/relay-mail.js`.** Gone permanently. Gmail API is the replacement.
- ❌ **Don't port Azure KV / `_lib/keyvault.js`.** GCP Secret Manager replaces it.
- ❌ **Don't write directly to `meetingDatetime`, `attendees`, or any Graph/Google-affecting field from the FE.** Always go through a callable.
- ❌ **Don't skip the Tate migration sequencing.** V2.5 migrates Tate's existing series ownership to `meetings@`. Pre-migration, some Graph IDs may be owned by Tate's mailbox and not patchable by the `meetings@` app registration.
- ❌ **Don't build a FullCalendar grid view in V2.** List view per FE surfaces §6.1. Grid view = V3 if ever.
- ❌ **Don't try to maintain Cloud-Function trigger-driven `agendas` row materialization in V2.1.** The agendas subcollection gets backfilled in V2.5 from Graph data. Until then, V2.1's read path uses Graph directly via `meetings-list`. V2.1 ONLY writes to the agenda doc when a reschedule patches an existing one.
- ❌ **Don't deploy V2.0 functions to prod before secrets are in GCP Secret Manager.** Functions will fail-closed on missing secrets — annoying but expected. Don't paper over with hardcoded values.

---

## Dependency Graph for V2 Slices

```
       (V1 stable) ──┐
                     │
   (#8 TaskBoard extraction — own session) ──┐  (Blaze upgrade — Andy ops)
                                              │   │
                                              ▼   ▼
                                          ┌───────────────┐
                                          │ V2.0 Infra    │ ← functions/ scaffold, secrets, _lib ports
                                          └───────┬───────┘
                                                  ▼
                                          ┌───────────────┐
                                          │ V2.1 Reschedule│ ⭐ first ship
                                          └───────┬───────┘
                                                  ▼
                                          ┌───────────────┐
                                          │ V2.2 CRUD     │ create, cancel, rename, guests
                                          └───────┬───────┘
                                                  ▼
                                          ┌───────────────┐
                                          │ V2.3 Agendas  │ agenda page, topics, comments
                                          └───────┬───────┘
                                                  ▼
                                          ┌───────────────┐
                                          │ V2.4 Send     │ invite send, prep email
                                          └───────┬───────┘
                                                  ▼
                                          ┌───────────────┐
                                          │ V2.5 Cutover  │ Tate migration, backfill, prod cut
                                          └───────────────┘
```

---

## After V2.1 Ships — Update Specs

When V2.1 lands and Andy reschedules the GV biweekly via the dialog, update:

1. **`docs/superpowers/specs/2026-05-20-meetings-v2-design.md`** — add SUPERSEDED header on §0, §3, §5, §11. Point readers to this brief.
2. **`docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`** §7 — rewrite to point at this brief as the authoritative V2 reference.
3. **Memory** — `project_v2_meeting_scheduler_direction.md` is already correct (dual-write); confirm no edits needed.

---

## Appendix: Sanity Check Questions

Before V2.0 code begins, the implementing session should be able to answer:

1. **Question:** Which Graph endpoint creates the canonical event?
   **Answer:** `POST https://graph.microsoft.com/v1.0/users/{hostUserId}/events` with `isOnlineMeeting: true` + `onlineMeetingProvider: "teamsForBusiness"`. `hostUserId` = `meetings@`'s ObjectId or UPN.

2. **Question:** Why does the Google mirror set `sendUpdates="none"`?
   **Answer:** Graph already fanned the `.ics` invite to all attendees. Google sending its own update would duplicate the notification.

3. **Question:** What replaces Azure Key Vault?
   **Answer:** GCP Secret Manager in the `management-db9eb` project. Secrets accessed via `@google-cloud/secret-manager` SDK with the Functions runtime SA granted `secretAccessor`.

4. **Question:** What does the FE write directly to Firestore vs. through a callable?
   **Answer:** Direct: title, notes, status, topic edits, topic comments. Through callable: meetingDatetime, attendees, recurrence, graph/google IDs (anything that must round-trip to Graph + Google).

5. **Question:** When does Tate's meetings migration run?
   **Answer:** V2.5 — after V2.0-V2.4 are working in dev. Migration uses `events.move()` on Google + Graph PATCH to transfer organizer to `meetings@`. One-shot, idempotent.

If the implementing session can't answer all five from memory after reading this brief, re-read before writing code.

---

*End of brief. After approval: SUPERSEDES the architecture surface of `docs/superpowers/specs/2026-05-20-meetings-v2-design.md`.*
