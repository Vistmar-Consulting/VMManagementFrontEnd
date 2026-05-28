# Meeting Agendas Page — Console Design Reference

**Audience:** Claude working in `VMManagementFrontEnd` who has been asked to port the Console Meeting Agendas / Meeting Scheduler UI. This doc is a single-source pointer: it tells you exactly where the canonical implementation lives in the archived Console repo, what the page anatomy is, and which subsystems you need to read before writing a line of port code.

**Why this doc exists:** the Project Management module (Meeting Agendas + Meeting Scheduler) was spun out of `VMConsoleFrontEnd` on 2026-05-12 and the working code now lives in an archive folder, not on the current Console branch. Fresh agents can't grep their way to it because it isn't under either project's `src/`. Read this doc, then read the files it points at.

**Status of V2 port:** an in-progress brief lives at `docs/plans/2026-05-27-meeting-scheduler-port.md` and a V2 design at `docs/superpowers/specs/2026-05-20-meetings-v2-design.md`. The 2026-05-27 plan currently scopes V2 to a **list-view** Calendar surface. Andy has since asked for the **full Console design** (Recurring cards at top → Upcoming/Past ad-hoc cards in the middle → month-view calendar grid at the bottom) — i.e., port `MeetingsHome` from the archive verbatim. Treat the Console design described in this doc as the target. Update the V2 plan accordingly when scoping the next sub-phase.

---

## 1. Where the Source of Truth Lives

All paths below are **absolute, on Andy's machine**. The archive is read-only reference material — do not edit anything inside it.

| Concern | Path |
|---|---|
| Archive root | `/Users/andrewdeemer/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/` |
| Meeting Agendas page (the entire UI) | `…/src/pages/pages/Agenda.jsx` (6,475 lines) |
| Calendar helpers (cadence detection, series grouping) | `…/src/pages/pages/meetingHelpers.js` |
| PM data hooks (agendas, attendees, members, calendar series) | `…/src/hooks/useAgendaStore.js`, `…/src/hooks/usePmApi.js` |
| Avatar / PM avatar component | `…/src/pages/pages/PmAvatar.jsx` |
| PM category color helpers | `…/src/pages/pages/pmPillColors.js` |
| Member resolution helpers | `…/src/pages/pages/pmMembers.js` |
| Backend (Vercel functions) — Graph + Google + Mail | `…/api/meetings/*.js`, `…/api/meetings/_lib/*.js` |
| Feature memory (design history & rationale) | `…/dev/feature_memory/*.md` |
| Standalone Calendar page (vestigial, mostly empty) | `…/src/pages/pages/Calendar.jsx` (87 lines — FullCalendar scaffold, NOT what we're porting) |

### The five feature-memory files that matter most

Read these in order — they were written contemporaneously with the design and capture the *why* behind decisions you'll otherwise miss:

1. `…/dev/feature_memory/Meeting_Agendas.md` — page-level history (renames, dropped features, lifecycle)
2. `…/dev/feature_memory/Meeting_Agendas_Board_View.md` — kanban-style board layout & card types
3. `…/dev/feature_memory/Calendar_Agenda_Sync.md` — `Calendar_Series_Id` model linking SQL agendas to Graph calendar series
4. `…/dev/feature_memory/Meetings_API.md` — Vercel function inventory + Graph migration history
5. `…/dev/feature_memory/Agenda_Detail_View.md` — the *detail* page (topic cards, sidebar, action bar) — separate surface from the page anatomy below

Also useful:
- `Topic_Cards.md`, `Mini_Project_Board.md`, `Threaded_Comments.md`, `Avatar_Color_System.md`, `Meeting_Prep_Email.md`

---

## 2. Page Anatomy — `MeetingsHome` (top → bottom)

The Meeting Agendas page renders a single component called `MeetingsHome`, defined at `Agenda.jsx:1080`. Its visible regions, in document order:

```
┌────────────────────────────────────────────────────────────────────────┐
│  "Meeting Agendas"          ← page title (Playfair Display 28px)       │
├────────────────────────────────────────────────────────────────────────┤
│  ▌ RECURRING MEETINGS       ← GroupHeader, copper accent               │
│  [card] [card] [card] [card]      ← grid of RecurringCard              │
│  (auto-fill, minmax(280px, 1fr), 16px gap)                             │
├────────────────────────────────────────────────────────────────────────┤
│  ▌ UPCOMING MEETINGS        ← GroupHeader, purple accent               │
│  [card] [card] [card] [+ Create] ← grid of DraftCard + dashed tile     │
├────────────────────────────────────────────────────────────────────────┤
│  ▶ PAST MEETINGS · N meetings    ← collapsible, grey                   │
│   (expanded:)                                                          │
│   [card] [card] [card] [card]    ← DraftCard, opacity 0.7              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ◀  May 2026  ▶                              Today    ← MeetingCalendar│
│  Sun  Mon  Tue  Wed  Thu  Fri  Sat                                     │
│  ┌────┬────┬────┬────┬────┬────┬────┐                                  │
│  │ 28 │ 29 │ 30 │  1 │  2 │  3 │  4 │     ← month grid, 7 cols        │
│  │    │    │    │ ▌GV│    │ ▌BMD│    │       chips per day:           │
│  │    │    │    │Biw │    │June│    │         copper = recurring     │
│  │    │    │    │    │    │ … │    │         purple = ad-hoc         │
│  └────┴────┴────┴────┴────┴────┴────┘                                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Region-by-region map

| Region | Component (file:line) | Notes |
|---|---|---|
| Page title | inline JSX, `Agenda.jsx:1207` | Playfair Display 28px, ink color `#1a1a2e` |
| Group header (the small uppercase accent label with a 3×18 colored bar) | `GroupHeader`, `Agenda.jsx:874` | Receives `color` + `label` props |
| Recurring meetings section | `Agenda.jsx:1215-1275` | Maps `unifiedRecurring` (calendar series + matched SQL agenda) and `unmatchedAgendas` (orphan SQL agendas with no calendar match) |
| Recurring card | `RecurringCard`, `Agenda.jsx:885-948` | 4px copper left border, cadence label, next-occurrence date, attendee avatar overlap stack |
| Upcoming meetings section | `Agenda.jsx:1277-1351` | Includes the "+ Create Meeting Agenda" dashed-border tile (`Agenda.jsx:1294-1350`) |
| Ad-hoc card (draft + sent + cancelled) | `DraftCard`, `Agenda.jsx:950-1075` | 4px purple left border. Draft variant adds a 1.5px dashed surround. Hover reveals trash icon for drafts/cancelled. |
| Past meetings (collapsible) | `Agenda.jsx:1353-1380` | Wrapped in MUI `Collapse`. Opacity 0.7 when expanded. |
| Month-view calendar | `MeetingCalendar`, `Agenda.jsx:568-872` | Month navigation arrows + "Today" button, 7-column grid, day cells with up-to-N meeting chips per day, popover preview on chip click |
| Meeting preview popover | inside `MeetingCalendar`, `Agenda.jsx:755-869` | MUI `Popover`, 320–340px wide. Title, datetime, "Recurring meeting" subtitle (if applicable), Teams join link, attendees list, "Open Agenda" copper CTA |

---

## 3. Design Tokens (the `t` palette)

`Agenda.jsx:86-107`. The whole module uses inline `sx={{ ... }}` style objects referencing this token bag — no MUI theme, no Emotion-styled component library on top. When you port, mirror these exactly (or move them to your own theme module if you prefer):

```js
const t = {
  ink: "#1a1a2e",         // headings
  ink2: "#3d3d5c",         // body
  ink3: "#6b6b8a",         // muted / secondary
  cream: "#faf8f5",        // panel bg
  cream2: "#f0ede8",       // chip bg
  cream3: "#e8e4dd",       // borders / dashed
  copper: "#b87333",       // accent for recurring + primary CTAs
  copperLight: "#d4a574",
  copperFaint: "rgba(184,115,51,0.08)",  // today-cell highlight
  blue: "#376fd0",         // draft label
  green: "#2e7d32",
  red: "#c62828",
  amber: "#ef6c00",
  purple: "#5e35b1",       // accent for ad-hoc / upcoming
  purpleLight: "#ede7f6",
  serif: "'Playfair Display', Georgia, serif",  // titles + section labels
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};
```

**Convention:** copper = recurring / brand primary; purple = ad-hoc; grey = past; green = positive (Done, Locked In); amber = pending; red = destructive.

---

## 4. Card Anatomy

### `RecurringCard` (`Agenda.jsx:885-948`)

- White card, `borderRadius: 14px`, `boxShadow: 0 2px 8px rgba(0,0,0,0.06)`, `4px solid copper` left border.
- Header row: uppercase `Recurring · Biweekly` (or `· Weekly`, `· Monthly`, `· 2x/Week` from `detectCadence`) + `ChevronRight` icon.
- Title: Playfair Display 18px, weight 500.
- Subtitle: `<Schedule>` icon + `Next: Jun 3 at 12:30 PM` (formatted from `series.nextDate`).
- Footer (above a 1px `cream` divider): overlapping attendee avatars (24px circles, –6px overlap), filtered by `isSilentProxy` to exclude `meetings@` and `seo@`.
- Hover: `translateY(-2px)` + shadow expands to `0 4px 20px rgba(184,115,51,0.15)`.

### `DraftCard` (`Agenda.jsx:950-1075`)

- White card, `borderRadius: 14px`, `boxShadow: 0 1px 3px rgba(0,0,0,0.06)`, `4px solid purple` left border.
- Draft variant: adds `1.5px dashed cream3` around the whole card.
- Hover-reveal trash icon for draft + cancelled (top-right, fades in `opacity 0 → 1`).
- Title: Playfair Display 18px, weight 500.
- Date row: `<Schedule>` icon + `format(parseISO(date), "MMM d 'at' h:mm a")`. If `Meeting_Date` is null **and** draft, show italic `"Draft"` blue label in place of the date.
- Optional topic pills (4 max, then `+N more`), colored by category (`CATEGORY_COLORS` / `topicAccent`).
- Footer: overlapping attendee avatars, same silent-proxy filter as recurring.

### "+ Create Meeting Agenda" tile (`Agenda.jsx:1294-1350`)

- `border: 2px dashed cream3`, `borderRadius: 14px`, centered content.
- 36×36 copper circle with white `+` symbol, then `Create Meeting Agenda` label (13px, weight 600).
- Click → mints a SQL draft agenda (status `draft`, no date/title/cadence), auto-adds the creating user as attendee, navigates to detail.
- Hover: border → copper, background → `copperFaint`.

---

## 5. Month-View Calendar — `MeetingCalendar` (`Agenda.jsx:568-872`)

### Header (`568-632`)

- Month navigation: `<ChevronLeft>` + `format(currentMonth, "MMMM yyyy")` (Playfair 20px) + `<ChevronRight>`.
- "Today" button (right-aligned, copper text).
- Receives `meetings`, `onSelectMeeting`, `onMonthChange`, `agendaAttendees` props.

### Grid (`634-753`)

- 7 columns (`repeat(7, 1fr)`), Sunday-first.
- Day-of-week header row, then a single grid `days` array (covering full weeks from `startOfWeek(monthStart)` to `endOfWeek(monthEnd)`).
- Each cell: `minHeight: 80px`, `1px solid cream3` border, background `copperFaint` for today / white in-month / `cream` out-of-month.
- Day number 11px; today gets a 22px copper circle with white text.
- Meeting chips inside each cell:
  - `borderLeft: 3px solid copper` for recurring / `purple` for ad-hoc.
  - Background `rgba(184,115,51,0.1)` / `rgba(94,53,177,0.08)`.
  - Title (9px, weight 600, ellipsis) + time (8px) below.
  - Past chips: `opacity 0.45` (raised to 0.7 on hover).
  - Click → opens MUI Popover (below).

### Popover preview (`755-869`)

- 320–340px wide, `borderRadius: 12px`, shadow `0 8px 32px rgba(0,0,0,0.12)`.
- Close `X` top-right.
- Title row: 14×14 copper square + Playfair 18px title + datetime (e.g. `Friday, June 12 · 9:00 – 9:45 AM`) + `Recurring meeting` if `Cadence`.
- Divider.
- Teams link block (if `m.teams_url`): blue `T` square + `Microsoft Teams Meeting` hyperlink.
- Divider.
- Attendees: `<People>` icon + `N attendees`, then a vertically scrollable (max 180px) list of `Avatar` + name pairs.
- Divider.
- Copper full-width "Open Agenda" button — fires `onSelectMeeting(meeting)`, which the parent uses to either navigate to a linked agenda or *auto-bind* a new one (see §6).

---

## 6. Data Flow — Recurring / Ad-hoc / Orphan / Calendar Join

`MeetingsHome` reconciles **three sources** for every page render:

1. **Calendar-series-derived recurring meetings** (`boardData.meetings`, fetched from `/api/meetings/list` over a 2-month window, grouped by title via `groupRecurringMeetings` from `meetingHelpers.js`).
2. **SQL store agendas** (`storeAgendas` via `useAgendas(orgId)` — Hugo's API), split into:
   - `recurringAgendas` (Cadence ≠ null)
   - `upcomingAdHoc` (Cadence == null, Meeting_Date ≥ now)
   - `pastAdHoc` (Cadence == null, Meeting_Date < now)
3. **The Calendar_Series store** (`calendarSeriesData` via `useCalendarSeries(orgId)`) — the join table linking a SQL agenda's `Id` to the Graph `series_id` / `Google_Event_Id` / `M365_Event_Id` / `Teams_Url`.

The join logic (`Agenda.jsx:1192-1200`):

```js
const unifiedRecurring = recurringSeries.map((series) => {
  const cs = calendarSeriesData.find((c) => c.Google_Event_Id === series.series_id);
  const agenda = cs ? recurringAgendas.find((a) => a.Id === cs.Agenda_Id) : null;
  return { ...series, agenda };
});
const matchedAgendaIds = new Set(unifiedRecurring.filter((u) => u.agenda).map((u) => u.agenda.Id));
const unmatchedAgendas = recurringAgendas.filter((a) => !matchedAgendaIds.has(a.Id));
```

Both `unifiedRecurring` (which has a calendar match) and `unmatchedAgendas` (orphan SQL agenda with no calendar series) render as `RecurringCard`s.

### Auto-bind on click

If a user clicks a calendar event (chip or RecurringCard) that has **no SQL agenda yet**, the page lazy-creates the binding via `autoBindCalendarMeeting` (`Agenda.jsx:1092-1130`) — it adds a row to `pm.Meeting_Agendas`, a row to `pm.Calendar_Series`, and attendee rows to `pm.Agenda_Attendees`, all in one click. **Constraint:** every `pm.Meeting_Agendas` row must be bound to a `pm.Calendar_Series` row (see Andy's `project_agenda_must_have_meeting` memory). Preserve this invariant in the port — agendas without meetings are forbidden.

### Cadence detection

`detectCadence(instanceCount, monthsInRange = 2)` in `meetingHelpers.js:41` — heuristic based on instance count over a 2-month window:

| Instances / month | Label |
|---|---|
| ≥ 7 | `2x/Week` |
| ≥ 3.5 | `Weekly` |
| ≥ 1.5 | `Biweekly` |
| ≥ 0.8 | `Monthly` |
| < 0.8 | `` (empty) |

---

## 7. Silent-Proxy Filter

`meetings@vistamarconsulting.com` and `seo@vistamarconsulting.com` are always invited to events (the former as organizer, the latter as the Fireflies recording proxy). They must **never** appear in any FE UI — not in attendee avatars, not in the popover attendee list, not in agenda attendee rows.

The filter helper is `isSilentProxy(email)` from `…/api/meetings/_lib/attendee-helpers.js` (also re-exported in the Console FE):

```js
export const HOST_PROXY_EMAIL = "meetings@vistamarconsulting.com";
export const FIREFLIES_GUEST_EMAIL = "seo@vistamarconsulting.com";
export const SILENT_PROXY_EMAILS = [HOST_PROXY_EMAIL, FIREFLIES_GUEST_EMAIL];

export function isSilentProxy(email) {
  if (typeof email !== "string" || !email) return false;
  return SILENT_PROXY_EMAILS.includes(email.toLowerCase());
}
```

Every attendee `.filter((att) => !isSilentProxy(att.Member_Email || att.email))` before render. Search the archive for `isSilentProxy` to see every callsite.

`withSilentProxies(attendees)` is the inverse — prepends both proxies to any list before sending to Graph. Use it on every event create / attendee patch. The SQL stored proc `pm.Add_Meeting_Agenda_Attendee` also filters silent proxies at the boundary as defense-in-depth, so duplicates from a missed FE filter don't corrupt the agenda.

---

## 8. Backend — `api/meetings/*`

Vercel serverless functions running under `meetings@vistamarconsulting.com`. Read `…/dev/feature_memory/Meetings_API.md` for the history (Google Calendar → Microsoft Graph migration 2026-04-08, dual-write to Google mirror, ICS fanout behavior).

| File | What it does |
|---|---|
| `create.js` | Creates a calendar event (Graph) + mirrors to Google. Wraps attendees in `withSilentProxies`. |
| `list.js` | Lists events for an org over a date range. Filters by `OrgId` extended property. |
| `reschedule.js` | Moves a single instance OR the entire series. Sends `.ics` updates with `Prefer: outlook.send-notifications`. |
| `attendees.js` | Add / remove attendees from a series. PATCH semantics. Notification rule: notify external only. |
| `cancel.js` | Cancel one instance, all-future, or whole series. |
| `rename.js` | PATCH series subject (used to sync agenda title → calendar title). |
| `send-prep.js` | Sends per-attendee Meeting Prep email (HTML built from current agenda + each recipient's task list). |
| `send-schedule.js` | Sends schedule confirmation email per attendee. |
| `_lib/graph-events.js` | The Graph client. CREATE, RESCHEDULE, RENAME, UPDATE-ATTENDEES, CANCEL, GET. ~530 lines. **Read this end-to-end.** |
| `_lib/google-calendar.js` | The Google mirror client. Same shape. `CALENDAR_ID = "primary"` (meetings@ primary). |
| `_lib/attendee-helpers.js` | `withSilentProxies`, `isSilentProxy`, `isVmEmail` — small, read first. |
| `_lib/keyvault.js` | Azure Key Vault wrapper. Secrets: `teams-client-id/secret/tenant-id/host-user-id`, `google-service-account-key`, `postmark-server-token`. |
| `_lib/auth.js` | Bearer-token auth for the Vercel function endpoints (token from the Console FE's logged-in user). |
| `_lib/cors.js` | `applyCors` middleware. |
| `_lib/graph-mail.js` | Microsoft Graph `sendMail` wrapper (used by send-prep and send-schedule). |

### V2 implementation note

The V2 plan (`docs/plans/2026-05-27-meeting-scheduler-port.md`) ports these to **Cloud Functions** under `functions/src/meetings/` instead of Vercel. The Graph + Google libs are ~95% portable — they're just OAuth2 + HTTPS calls. The Vercel-specific surfaces (`req`, `res`, CORS) get replaced with callable Function shapes.

---

## 9. Data Model — What the SQL Tables Hold (Console side)

Read `…/src/pages/pages/pmAgenda.js` and `…/src/hooks/useAgendaStore.js` for the field-by-field model. Headline:

| Console SQL table | Purpose |
|---|---|
| `pm.Meeting_Agendas` | One row per agenda (recurring or ad-hoc). PK `Id`, fields: `Org_Id`, `Meeting_Title`, `Meeting_Date`, `Meeting_Time`, `Cadence` (null = ad-hoc), `Agenda_Status` (`draft` / `active` / `concluded` / `cancelled`). |
| `pm.Calendar_Series` | Join table linking an agenda to its calendar event. PK `Id`, FK `Agenda_Id`, fields: `iCalUID`, `Google_Event_Id`, `M365_Event_Id`, `Teams_Url`, `Day_Of_Week`, `Time_Of_Day`, `Cadence`, `Sync_Status`. |
| `pm.Agenda_Attendees` | Attendee rows per agenda. FK `Agenda_Id`, fields: `Member_Id` (nullable, FK `pm.Members`), `Member_Name`, `Member_Email`. SP filters silent proxies. |
| `pm.Agenda_Topics` | Topic cards inside an agenda. See `Topic_Cards.md`. |
| `pm.Topic_Talking_Points`, `pm.Topic_Tasks` | Inside a topic. |
| `pm.Members` | Cross-org members directory. Fields: `Member_Name`, `Member_Email`, `Avatar_Color`, `Org_Id` (the member's home org). |

**V2 Firestore mapping:** `2026-05-20-meetings-v2-design.md §4` defines `calendar_series/{seriesId}`, `agendas/{agendaId}`, `agendas/{agendaId}/topics/{topicId}`. Field names mostly survive (camelCase in Firestore vs PascalCase in SQL) — use `Field Mapping Reference` in `docs/plans/2026-05-27-meeting-scheduler-port.md:736` as your authoritative mapping table.

---

## 10. Agenda Detail View — Out of Scope for This Doc

This doc covers the **page that lists** meetings. Clicking any card or calendar chip routes to the **Agenda Detail** view, which is a separate large surface (topic cards, mini project board, sidebar with Meeting Focus + Attendees, action bar with Send / Conclude / Regenerate). For that surface:

- Feature memory: `…/dev/feature_memory/Agenda_Detail_View.md`
- Components: also inside `Agenda.jsx` — `AgendaOverview` (`Agenda.jsx:2594+`), `AgendaTopicCard` (`Agenda.jsx:2064+`), `MiniProjectBoard` (`Agenda.jsx:1455+`)
- V2 port: scoped as V2.3 in `docs/plans/2026-05-27-meeting-scheduler-port.md:389`.

When you're ready to port the detail view, treat that as a separate sub-project.

---

## 11. Port Order Suggestion

If you're starting from zero in `VMManagementFrontEnd`, work outside-in:

1. **Page skeleton + GroupHeader.** Static placeholders for each region. No data.
2. **Design tokens.** Move the `t` palette into a real theme module (or keep inline — either way, lock the colors first so visual diff against the archive screenshots is meaningful).
3. **`MeetingCalendar` component.** Pure presentational, takes `meetings` array, fires `onSelectMeeting` and `onMonthChange`. Easiest to port in isolation because it has no SQL/Graph dependencies.
4. **`RecurringCard` + `DraftCard`.** Same — pure presentational, take a card-shaped object.
5. **Data layer.** `useCalendarSeries`, `useAgendas`, `useAttendees` hooks reading from Firestore (V2) instead of SQL. The shape of the records is what matters — match the Console field names exactly so the cards can render without translation logic.
6. **`MeetingsHome`.** Wire the three data sources + the join logic + auto-bind. This is the hairy part — port `unifiedRecurring`, `unmatchedAgendas`, `upcomingAdHoc`, `pastAdHoc` derivations carefully.
7. **Backend.** `meetings-create`, `meetings-reschedule`, `meetings-attendees-update`, `meetings-cancel`, `meetings-rename` as callable Cloud Functions, porting `_lib/graph-events.js` + `_lib/google-calendar.js` near-verbatim.

Andy will tell you which slice to ship first (he was talking about V2.1 = Reschedule Dialog in the 2026-05-27 plan). The order above is for the **full page** port, not for the minimum V2.1 surface.

---

## 12. Things That Will Trip You Up

- **`MEETINGS_SKIP_FIREFLIES_FOR_TESTS=1`** is set in Andy's `.env.local`. When the FE / scripts call `withSilentProxies`, this flag suppresses `seo@`. For real meetings, the runner must clear or override the flag (the production calls always include Fireflies). See `attendee-helpers.js:36`.
- **Graph PATCH is silent.** Updates to events via `PATCH /events` don't fan out `.ics` updates unless the request has header `Prefer: outlook.send-notifications`. Andy lost a day to this. The Console's `graph-events.js` sets that header correctly — preserve it on port. Also: Graph's `/events/{id}/forward` returns 202 but silently drops the mail. Don't use forward — use the notify-on-PATCH pattern.
- **VM email routing.** `vistamarconsulting.com` MX points to Gmail (not Outlook). So when Graph creates an event on `meetings@` and fans out `.ics` to VM team members, the `.ics` lands in their **Gmail** inbox; their Outlook just gets the calendar entry, no inbox copy. That's intentional and not a bug.
- **Per-client Google calendars exist but aren't wired.** The Console `dev/sessions/v5/5_1_0_Andrew_PROJECT_MANAGEMENT/context.md` mentions sub-calendars per org (`c_aa60cdd...@group.calendar.google.com` for Golden Vision, etc.), but `google-calendar.js` hardcodes `CALENDAR_ID = "primary"` (meetings@ primary). All client meetings currently land on meetings@'s primary calendar with the Org_Id stored as an extended property. Don't accidentally re-introduce sub-calendars during V2 — they broke Teams `isOnlineMeeting:true` in Graph last time (per `Meetings_API.md`).
- **Don't bring back the Project Management module CRUD into Console.** That repo is locked to Project Management spinout. The reference here is read-only.

---

## 13. Single-Sentence Brief

Port `MeetingsHome` (`Agenda.jsx:1080–~1450`) and its subordinates `RecurringCard`, `DraftCard`, `MeetingCalendar` verbatim into `VMManagementFrontEnd/src/pages/Calendar.jsx` (or a dedicated agendas route), backed by Firestore-shaped equivalents of `useAgendas` / `useAttendees` / `useCalendarSeries`, with the Vercel `api/meetings/*` functions reimplemented as callable Cloud Functions under `functions/src/meetings/`, preserving the silent-proxy filter and the agenda↔calendar-series 1:1 invariant.
