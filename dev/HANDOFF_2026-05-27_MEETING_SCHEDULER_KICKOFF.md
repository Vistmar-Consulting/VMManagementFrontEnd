# HANDOFF — 2026-05-27 — Meeting Scheduler Kickoff

End of the long V1 Project Board session. Next session kicks off the **Meeting Scheduler** (V2), which Andy will start fresh.

## Where things stand

The Project Board is fully functional on production: https://vm-management-front-end.vercel.app

Five people can sign in today (everyone in the @vistamarconsulting.com Google Workspace — Andy + Scot + Bill + Hugo + Cedric). Auth uses Google Identity Services (ID-token + `signInWithCredential`) — see commit `49db8e1` and `0c0c93d` for the rebuild + hooks-rule fix.

What works on the board:
- Monday.com-style table, 14 columns, collapsible Active/Completed/Archive groups
- Full CRUD: items, subtasks, categories, tags
- Notes modal (threaded comments — flat for V1, schema supports reply nesting)
- Files modal (URL link attachments; file uploads await Blaze)
- Multi-assignee (overlapping avatars + dropdown)
- Status pills (now including AI Gen at the top — see below)
- Priority + status + assignee + category + tag dropdowns inline on every row
- Inline title edit
- Per-row + global expand-all toggle
- Filter cascade: filtering by Priority/Status/Tag/Search shows matching subtasks AND auto-expands their parents; siblings hide
- 7 scorecards: Assigned / In Progress / Review / On Hold / Done / Overdue / Due This Wk (business-week Mon–Fri, not rolling 7 days)
- Org filter chips: All · Vistamar · Unio · Bryn Mawr · Golden Vision · ID Care
- Standalone search bar (matches title + description across items + subtasks)
- Free-form color picker (HSV + hex + preset palette) for category/tag dialogs
- Sequential per-org item numbers (I-1, I-2, SI-1, SI-2 via `runTransaction` on org-doc counters)
- Sidebar: Dashboard · Task Board · Settings (collapsed by default, expands to Organizations + Profile)
- AI Gen status (`statusId: 8`, cyan, top of dropdown) — placeholder for the V3 AI feature

What's seeded right now (mock data, NOT live `pm.Items`):
- 4 client orgs: unio, bryn-mawr, golden-vision, id-care
- 1 internal org: vistamar
- 8 categories (global, shared across orgs)
- 5 tags (global)
- 44 items + their subtasks (Unio-only mock from `_PM_Archive_From_Console_2026-05-12/src/pages/pages/pmItems.js`)

Andy may want to swap mock for live SQL later — `mcp__sql-server` queries `pm.Items` directly (~85 rows). Not blocking V2.

## What's NOT done in V1 (deferred — see `dev/DEFERRED.md`)

- DnD row reorder (lib installed, no wiring)
- Members admin page
- File uploads (Blaze-gated)
- Migration script from live SQL
- Date-picker keyboard nav

## V2 — Meeting Scheduler (this is what the NEXT session works on)

### Source-of-truth references the next session needs to read

1. **`docs/plans/2026-05-14-project-board-port.md`** — the port brief that drove V1. V2 will likely want its own brief in `docs/plans/`.
2. **`docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` §7** — V2 sketch (will need amendment per below).
3. **`docs/superpowers/specs/2026-05-20-meetings-v2-design.md`** — V2 design doc (may exist; check).
4. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/*`** — the Console implementation being ported (Node.js Vercel functions, ~60% of code survives the FE port).
5. **`~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/Agenda.jsx`** — 6,475-line agenda UI from Console. Will need its own port pass.
6. **Memory: `project-v2-meeting-scheduler-direction`** — captures the architectural decision (Graph canonical, Google mirror, NOT Google-Meet-only as 2026-05-12 spec originally said).

### Architecture (per Andy 2026-05-27, settled)

**M365-primary dual-write to ICS-mirrored Google calendar.** Detail:

- Service account: `meetings@vistamarconsulting.com` — already provisioned in `Console-Meetings` GCP project (`console-meetings-service@console-meetings.iam.gserviceaccount.com`)
- **Microsoft Graph (Teams) — canonical event**:
  - Created via `meetings@` Microsoft 365 mailbox
  - `isOnlineMeeting: true` → mints the Teams join URL natively
  - Sends `.ics` invites to ALL attendees from Outlook/Teams
- **Google Calendar — ICS-mirrored copy** for Vistamar team members:
  - Created via `meetings@` Google service account (using DWD or service-account impersonation)
  - Embeds the same Teams URL in `conferenceData` / description
  - `sendUpdates: "none"` for the mirror (Graph already invited everyone)
- **The Graph Event ID is stored on the Calendar Series doc** in Firestore so the Meeting Agenda can be married to the Graph event for updates / cancellations / attendee patches.

### Firestore data model (V2 additions per spec §4)

```
calendar_series/{seriesId}           [V2]  seriesId = Graph series eventId
  organizationId, title, recurrenceRule, conferenceType: 'teams',
  graphEventId,                       ← marries to Graph
  googleEventId,                      ← marries to Google mirror
  iCalUID,                            ← RFC 5545 stable ID
  defaultAttendees: [{ email, displayName, memberId }],
└─ agendas/{agendaId}                 [V2]
     meetingDatetime, title, notes, status,
     attendees: [{ email, displayName, memberId, responseStatus }]
   └─ topics/{topicId}                [V2]
        title, notes, order, ownerMemberId
      └─ comments/{commentId}         [V2]  same shape as items/.../comments
```

### V2 ops setup checklist (Andy needs to do)

- [ ] Upgrade Firebase project `management-db9eb` to Blaze (pay-as-you-go). Cost realistically ~$0/mo for a 5-person team — Blaze has generous free tier.
- [ ] After Blaze: `firebase init functions/` — scaffolds `functions/` dir
- [ ] Service account JSON for `meetings@vistamarconsulting.com` — already exists in `Console-Meetings` GCP project; need to either reuse the existing key or generate a new one for Management. Store the secret in GCP Secret Manager (`meetings-service-account-key`).
- [ ] Microsoft 365 admin: confirm `meetings@` mailbox has an app registration with `Calendars.ReadWrite` + `Mail.Send` Graph permissions. Console did this; reuse or re-grant for Management's tenant if different.

### Code layout V2 will need

```
functions/
├── src/
│   ├── meetings/
│   │   ├── create.js          (port from archive api/meetings/create.js)
│   │   ├── cancel.js
│   │   ├── reschedule.js
│   │   ├── attendees.js
│   │   ├── list.js
│   │   ├── send-prep.js
│   │   └── _lib/
│   │       ├── graph-events.js     (port — canonical write path)
│   │       ├── google-calendar.js  (port — mirror write path)
│   │       ├── gmail-send.js       (NEW — replaces Postmark + Graph sendMail)
│   │       └── auth.js             (port — Firebase Admin token verify)
│   └── ...
```

src/pages/Calendar.jsx and src/pages/Agenda.jsx (FE) port from archive, rewired to Firestore data layer the same way TaskBoard was ported.

### Where V2 design conversations are likely to surface

- Conferencing UX: Teams URL on the Google mirror, or join in Google Meet for VM team? Current direction = single Teams URL, embedded in mirror.
- Recurrence: Graph supports rich RRULE; Google supports same. Console used Cadence object → RRULE. Port the helper.
- Attendee invites: Graph fans `.ics` natively. Avoid Postmark/SendGrid roundtrip entirely.
- Tate's recurring meetings: one-shot migration script using Graph's `events/{id}` move semantics. See archive `dev/HANDOFF_2026-04-30_TATE_MIGRATION.md`.

## Useful state for the next session

- **All 5 team members have signed in at least once** (confirmed by Andy testing with a second account); `users` collection has 5 docs.
- **agent-browser works with `--profile "Profile 10"`** for Andy's Vistamar Chrome profile, inheriting his auth. Useful for end-to-end verification without OAuth round-trips.
- **`mcp__sql-server`** with named connection `vmcr` provides read access to live `pm.*` SQL. Used during V1 for status enum validation; will be useful again for V2 to validate meeting + agenda schema vs Console.
- **Vercel auto-deploys** on `git push origin main:dev`. Manual deploys via `npx vercel deploy --prod` work too.
- **Firebase CLI token expires every ~12 hours** — Andy reauths via `! npx firebase login --reauth` when needed.

## Last commit on this session

```
<latest-sha>  chore(session-close): AI Gen status + slice 6 docs + meeting-scheduler handoff
```

Working tree should be clean after that. Next session can branch from this state.

*— Session closed 2026-05-27 evening.*
