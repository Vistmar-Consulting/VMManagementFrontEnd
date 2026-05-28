# Agenda Detail Page — Console Design Reference

**Audience:** Claude working in `VMManagementFrontEnd` who has been asked to port the **Agenda Detail** page — the surface that opens when a user clicks a meeting card from the Meeting Agendas listing (see `docs/MEETING_AGENDAS_PAGE_REFERENCE.md` for that listing).

**Read first:** `docs/MEETING_AGENDAS_PAGE_REFERENCE.md`. Same source-tree, same design tokens, same archive root, same proxy/auto-bind rules. This doc *extends* that one.

**Scope of this doc:** the two view modes of the Agenda Detail:
- **Working view** — the meeting-driving CRUD surface. Topic cards with embedded Mini Project Boards, KPI scorecards, Talking Points, Topic Notes, an Open Floor section, a Past Meetings (Fireflies) card, and a sidebar with Meeting Focus + Attendees.
- **Overview view** — the read-style document layout. Flat inline-editable topics with talking-point bullets, an Open Floor list, an attendee chip strip. No board, no sidebar, no scorecards.

A `Working | Overview` segmented toggle in the top-right of the hero switches between them. State key: `viewMode` (`"working" | "overview"`) inside `AgendaDetail` (`Agenda.jsx:4390`).

---

## 1. Where the Source Lives (archive)

All paths are absolute on Andy's machine. Read-only — do not edit.

| Concern | Path |
|---|---|
| Archive root | `/Users/andrewdeemer/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/` |
| Entire agenda module (both views) | `…/src/pages/pages/Agenda.jsx` |
| Hooks (read + write) | `…/src/hooks/useAgendaStore.js`, `…/src/hooks/usePmApi.js`, `…/src/hooks/usePmBoardActions.js`, `…/src/hooks/usePmMembers.js`, `…/src/hooks/usePmCategories.js`, `…/src/hooks/usePmTags.js` |
| PM avatar | `…/src/pages/pages/PmAvatar.jsx` |
| PM pill colors | `…/src/pages/pages/pmPillColors.js` |
| PM members helpers | `…/src/pages/pages/pmMembers.js` |
| Backend (Vercel functions) | `…/api/meetings/*.js` (already covered in the prior doc) |
| Feature memory | `…/dev/feature_memory/Agenda_Detail_View.md`, `Topic_Cards.md`, `Mini_Project_Board.md`, `Threaded_Comments.md`, `Agenda_Action_Bar.md`, `Meeting_Prep_Email.md`, `Pastel_Pill_System.md`, `Avatar_Color_System.md` |

### Read the feature memory FIRST

These four explain decisions you can't reverse-engineer from the code:

1. `Agenda_Detail_View.md` — page-level history. What's been added, removed, renamed.
2. `Topic_Cards.md` — the card subsystem in detail.
3. `Mini_Project_Board.md` — board nested inside each topic.
4. `Agenda_Action_Bar.md` — top-of-page action buttons (Join, Send Invite, Send menu).

---

## 2. Top-Level Component: `AgendaDetail`

Defined at `Agenda.jsx:4351`. Single component handles both views via `viewMode` state. Receives one prop: `agendaId`.

### Data sources (all read from the same hook instances — important to avoid stale-state bugs)

```js
const [allAgendas, agendaHelpers]               = useAgendas(orgId);
const [allTopics,  topicHelpers]                = useTopics(orgId);
const [allAttendees, attendeeHelpers]           = useAttendees(orgId);
const [allOpenFloor, openFloorHelpers]          = useOpenFloor(orgId);
const [calendarSeriesData, calendarSeriesHelpers] = useCalendarSeries(orgId);
const [allTalkingPoints, talkingPointHelpers]   = useTalkingPoints(orgId);
const [allFirefliesMappings]                    = useFirefliesMeetings(orgId);
```

The composed slices for this agenda:

```js
const a = allAgendas.find((ag) => ag.Id === agendaId);                // the agenda row
const topics = allTopics.filter((tp) => tp.Agenda_Id === agendaId).sort(by Sort_Order);
const attendees = allAttendees.filter((at) => at.Agenda_Id === agendaId);
const openFloor = allOpenFloor.filter((of) => of.Agenda_Id === agendaId);
const agendaCalSeries = calendarSeriesData.find((c) => c.Agenda_Id === agendaId);
```

**Critical rule:** the working view's `AgendaTopicCard` writes to `allTalkingPoints` via `talkingPointHelpers`, and the Overview view *also* reads/writes those same helpers (`Agenda.jsx:6298-6315`). Both views share one source of truth. **Never instantiate the hooks separately per view** — `useAgendaDetail` exists but only as a derivation; in production both views consume the same instance. If you split them, the writes from one view don't appear in the other until a remount. See the Console comment at `Agenda.jsx:4356-4357`:

> "Single hook instances for both read AND write — avoids stale state between separate instances"

---

## 3. Hero (Shared by Both Views)

`Agenda.jsx:4750-5340`. Sits above the view-mode-specific body.

```
┌─────────────────────────────────────────────────────────────┐
│                                       ┌──────────────────┐  │
│                                       │ Working│Overview │  │ ← segmented toggle
│                                       └──────────────────┘  │   (top-right, abs)
│                                                             │
│                    Meeting Title                            │ ← inline-editable TextField
│                    (Playfair 28px, centered)                │
│                                                             │
│       🗓 Friday, June 12 at 9:00 AM    rescheduled ⓘ        │ ← schedule popover trigger
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Toggle (`Agenda.jsx:4756-4789`)

Pill-style segmented control inside `t.cream3` background, `borderRadius: 8px`. Active mode: `background: #fff`, `boxShadow: 0 1px 3px rgba(0,0,0,0.12)`, `color: t.ink`, weight 600. Inactive: transparent, `color: t.ink3`, weight 500.

### Title (`Agenda.jsx:4790-4815`)

`TextField`, `disableUnderline: true`, Playfair Display 28px (24 on xs), centered. `onBlur` writes back via `agendaHelpers.update(agendaId, { Meeting_Title: title })` if changed.

### Schedule row (`Agenda.jsx:4816-5340`)

- If the agenda has neither a `Meeting_Date` nor a calendar series binding: shows a dashed-border "Set date & time" button.
- If it has a date: shows `<Schedule>` icon + `format(meetingDate, "EEEE, MMMM d 'at' h:mm a")`. Hover: copper border. Click → opens schedule Popover.
- If `isOneTimeChange` (this-meeting-only reschedule): renders an amber `rescheduled` `MiniPill`.

The schedule Popover handles **three modes**, set via `scheduleMode`:
1. `"create"` — for unbound agendas: frequency pills (`weekly / biweekly / monthly / quarterly / one-time`) → day-of-week + ordinal (for monthly/quarterly) + time picker → "Save".
2. `"this-meeting"` — reschedule one instance.
3. `"all-future"` — reschedule the series from a date forward.

The popover writes (a) optimistically to the local SQL `Calendar_Series` store and (b) flags `inviteSendPending` in localStorage so the Send Invite button surfaces in the action bar (see §4.1).

---

## 4. Working View (`viewMode === "working"`)

`Agenda.jsx:5340-6296`. Layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│  HERO (toggle, title, schedule)                                     │ ← §3
├─────────────────────────────────────────────────────────────────────┤
│  ACTION BAR    [Join Meeting]      [Send ▾] [Send Invite] [Conclude]│ ← §4.1
├──────────────────────────────────────────┬──────────────────────────┤
│  MAIN COL                                │  SIDE COL                │
│                                          │                          │
│  ┌─────────────────────────────────────┐ │  ┌────────────────────┐  │
│  │ ▼  Topic Title  [Cat] [Tag] [⋮]    │ │  │ MEETING FOCUS      │  │ ← Scorecards
│  ├─────────────────────────────────────┤ │  │ Done│Rev│Hold│OvDu │  │   (clickable filter)
│  │ KPI scorecards (7 across)           │ │  └────────────────────┘  │
│  │ Assigned·InPg·Rev·Hold·Done·OvDu·DueWk │  ┌────────────────────┐  │
│  │ ───────────────────────────────     │ │  │ ATTENDEES   Tasks  │  │ ← Avatar list
│  │ Talking Points (copper)             │ │  │ ● Andy         3   │  │   (clickable filter
│  │  • point                            │ │  │ ● Cedric       2   │  │    + Manage Guests)
│  │  • point                            │ │  │ ───────────────    │  │
│  │  + Add a talking point…             │ │  │ ● Leslie       1   │  │
│  │ ─────────────────────────────       │ │  └────────────────────┘  │
│  │ Project Board                       │ │  ┌────────────────────┐  │
│  │   ▼ Active (3) [blue accent]        │ │  │ PREPARED BY        │  │
│  │     Item Pri  Status  Asgn Due 📝🔗 │ │  │ Vistamar Consulting│  │
│  │     Item Pri  Status  Asgn Due 📝🔗 │ │  │ May 28 at 2:13 PM  │  │
│  │     + New Item                      │ │  └────────────────────┘  │
│  │   ▶ Completed (1) [green accent]    │ │                          │
│  │   ▶ Archive [grey accent]           │ │                          │
│  │ ─────────────────────────────       │ │                          │
│  │ Topic Notes (blue)                  │ │                          │
│  │  • note                             │ │                          │
│  │  + Add a note…                      │ │                          │
│  └─────────────────────────────────────┘ │                          │
│                                          │                          │
│  + Add Topic (dashed)                    │                          │
│                                          │                          │
│  ▌ OPEN FLOOR (copper)                   │                          │
│   • discussion item                      │                          │
│   + Add item                             │                          │
│                                          │                          │
│  ▌ PAST MEETINGS (Fireflies)             │                          │
│   ┌────────────────────────────────────┐ │                          │
│   │ Search… Topic filter pills         │ │                          │
│   │ Mtg title · date · action count → │ │                          │
│   │ Mtg title · date · action count → │ │                          │
│   └────────────────────────────────────┘ │                          │
└──────────────────────────────────────────┴──────────────────────────┘
```

### 4.1 Action Bar (`Agenda.jsx:5341-5530`) — see also `feature_memory/Agenda_Action_Bar.md`

Sticky-ish bar above the topic cards. Components (left → right):

| Button | When shown | What it does |
|---|---|---|
| **Join Meeting** | Always when `cachedTeamsUrl` is set | Outlined button, Teams blue logo, `<a target="_blank">` to `teams_url`. |
| spacer | always | pushes the rest right |
| **Send Updated Invite** / **Send Meeting Invite** | Conditional (`hasAttendees && ((!hasBinding && hasSchedule) || (hasBinding && inviteSendPending))`) | Fires `POST /api/meetings/create` (unbound) or `POST /api/meetings/attendees` (bound) with the staged diff. On success, mints a `Calendar_Series` row and clears the localStorage flag. |
| **Send ▾** | Always | Opens a menu (Meeting Prep email, Schedule notification, etc.) — see `Meeting_Prep_Email.md`. |
| **Conclude** | After the meeting | Green outlined button; sets `Agenda_Status = "concluded"`. |

**Invite-send persistence** (`Agenda.jsx:4417-4437`): when the user stages a schedule or attendee change locally, the page sets `localStorage["invite-send-pending-${agendaId}"]` so the Send Invite button keeps showing across reloads until they actually fire the mutation. Preserve this pattern — Andy explicitly wanted an explicit "send" step instead of auto-firing on every edit. See memory `project_explicit_send_invite_button`.

### 4.2 ContentGrid (`Agenda.jsx:310-328`)

```js
const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 320px;   /* main + sidebar */
  gap: 32px;
  padding: 0 32px 48px;
  max-width: 1280px;
  margin: 0 auto;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const MainCol = styled.div` min-width: 0; `;
const SideCol = styled.div` /* sidebar */ `;
```

### 4.3 Topic Cards (`AgendaTopicCard` at `Agenda.jsx:2064-2588`)

Drag-to-reorder via `react-beautiful-dnd` (`DragDropContext` + `Droppable` + `Draggable` at `Agenda.jsx:5547-5740`). Reorder fires `topicHelpers.reorder(topicId, destinationIndex, agendaId)`.

#### Card chrome
- `styled(TopicCard)` — white, `borderRadius: 12px`, `boxShadow: 0 1px 3px rgba(0,0,0,0.05)`, 4px left accent stripe in `cc.accent` color (from category color, or `topicAccent(topicIndex)` palette as fallback).
- Fade-up entrance animation (`fadeUp` keyframes), staggered by `$delay`.

#### Header (`Agenda.jsx:2163-2313`) — collapsed by default
- `<ExpandMore>` chevron (rotates `-90deg` when collapsed).
- Topic title (Playfair 18px weight 500).
- Category `MiniPill`s (from `topic.Category_Ids`, colored via `categoryColors(cat.Category_Color)`). Click → opens category picker popover.
- Tag `MiniPill`s.
- Vertical ellipsis menu (`⋮`) on the right — Edit (transforms card into the edit form at `Agenda.jsx:5556-5681`) / Delete.

#### Body (`TopicBody`, `Agenda.jsx:2314-2584`) — visible when expanded

In order:

1. **Topic KPI Scorecard** (`Agenda.jsx:2314-2387`) — 7-column strip (Assigned · In Progress · Review · On Hold · Done · Overdue · Due This Wk), each cell clickable to filter the embedded MiniProjectBoard. Active cell gets `rgba(184,115,51,0.08)` background + 2px colored bottom border. Zero-value cells are 0.4 opacity, non-clickable.

2. **Talking Points** (`Agenda.jsx:2389-2489`) — cream card (`background: t.cream`, `border: 1px solid cream2`), copper uppercase label. Bulleted list with 5px copper dot. Each point is click-to-edit (inline TextField). Hover reveals trash `Close` icon. Bottom is an "+ Add a talking point…" dashed-border input that adds on Enter.

3. **Project Board** (`MiniProjectBoard`, `Agenda.jsx:1455-1600`) — see §4.4.
   - Edge case: if topic has no Category_Ids AND no Tag_Ids, the board is replaced with italic placeholder `"Select categories or tags to see items"` (`Agenda.jsx:2492-2495`).

4. **Topic Notes** (`Agenda.jsx:2500-2582`) — white card, blue uppercase label (not copper — visually distinct from Talking Points). Same bullet/edit/delete pattern, blue dot, blue focus border. Multiline (Shift+Enter for new line). "+ Add a note…" multiline TextField at the bottom.

#### Filter coupling

Topic cards react to two page-level filters set on the sidebar:
- `meetingFocusFilter` — set by clicking a Meeting Focus scorecard (`done | review | onHold | overdue | dueThisWeek`)
- `attendeeFilter` — set by clicking an attendee chip

When either filter is active (`hasExternalFilter`), the topic card auto-expands if it has any matching items, auto-collapses if not. On filter clear, it restores its prior expanded state via `savedExpandedExt`. See `Agenda.jsx:2095-2135` for the logic — port it carefully because it has the "remember user's prior choice" UX nuance.

### 4.4 Mini Project Board (`MiniProjectBoard` at `Agenda.jsx:1455-1600`)

A miniature version of the main Task Board, scoped to the topic's items (filtered by Category_Ids OR Tag_Ids).

#### Groups (`renderGroup`, `Agenda.jsx:1552-1591`)
- **Active** (`Status_Id ∉ {5, 7}`) — `t.blue` left border + tinted header. Expanded by default. Shows "+ New Item" at the bottom.
- **Completed** (`Status_Id === 5`) — `t.green`. Expanded by default if non-empty; collapses when no items.
- **Archive** (`Status_Id === 7`) — grey `#9e9e9e`. Collapsed by default.

Each group header: 3px colored left border, `${color}0D` tinted background, chevron, title, count.

#### Columns (`colHeaders`, `Agenda.jsx:1543-1550`)

```
[expand 28px] [Item 1fr] [Priority 85px] [16] [Status 95px] [16] [Assigned 80px] [Due 70px] [Notes 38px] [Files 38px] [delete 30px]
```

#### Rows (`MiniBoardItem` + `MiniBoardRow`, `Agenda.jsx:1603-1850`+)
- Parent item with optional `Subitems[]`. Subitems indent and prefix with a sub-row chevron.
- Inline editing on every column: title text, priority dropdown, status dropdown (pill-style with colored backgrounds), multi-assignee dropdown (avatars + names), due date picker, Notes (opens threaded comments modal — see `Threaded_Comments.md`), Files (opens file-link modal).
- Hover reveals trash icon on the right.

#### Filter coupling
- `scorecardFilter` (from the topic's own KPI strip) filters Active items via `matchesScorecard`.
- `meetingFocusFilter` (sidebar) filters Active items via `matchesMeetingFocus`.
- `attendeeFilter` (sidebar) filters all groups including Completed/Archive.
- Filter-driven auto-collapse logic (`Agenda.jsx:1466-1492`): Done filters always collapse Active, expand Completed. Attendee-only filter expands all groups. Filter cleared → restores prior state.

#### Data write
All board mutations route through `usePmBoardActions` (`actions.addItem`, `actions.updateItem`, `actions.deleteItem`, `actions.addSubitem`). Internally these hit Hugo's API (.NET / SQL `pm.Items` + `pm.Subitems`).

### 4.5 Open Floor (`Agenda.jsx:5919+`)

Section under topic cards. Copper uppercase label. Bulleted list of `Discussion_Item` strings, click to edit, X to delete, "+ Add item" dashed-border input. Writes via `openFloorHelpers` → `pm.Open_Floor` table.

### 4.6 Past Meetings — Fireflies (`PastMeetingsCard` at `Agenda.jsx:3470-3756`)

Below Open Floor. Lists past Fireflies transcripts for this org. **Important context (memory `project_fireflies_upgrade`):** Fireflies is on the Business plan ($19/user/mo, 60 req/min) under `seo@vistamarconsulting.com`. The GraphQL API at `api.fireflies.ai/graphql` is wired with key `VITE_FIREFLIES_KEY`.

- Parent card: search input + meeting-title filter pills (click to filter by series) + "Last refreshed" timestamp.
- Each row: title, date, action-item count pill.
- Click row → `MeetingDetailModal` (`Agenda.jsx` further down) with markdown overview, action items, key decisions, transcript viewer.
- Caching: localStorage persistence — `enabled: !cached`, `staleTime: Infinity`, `retry: 0`. Survives reload with zero API calls.

**Port note:** for V2 you might defer the Fireflies card. It's optional; the agenda is fully usable without it.

### 4.7 Sidebar — Meeting Focus (`Agenda.jsx:6033-6122`)

`Section` styled component (`Agenda.jsx:330-355`) — cream background card, copper uppercase label.

4-cell `KpiGrid`:

| Key | Label | Color |
|---|---|---|
| `done` | Done | `t.green` |
| `review` | Review | `#9c6ade` |
| `onHold` | On Hold | `t.red` |
| `overdue` | Overdue | `t.red` |

Plus a "Due this week" `MiniPill` next to the section header when `dueSoon > 0` (amber on active, cream on inactive).

Counts are computed across **all topics' relevant items**: items deduplicated by `Item.Category_Id ∈ topic.Category_Ids || Item.Tag_Ids ∩ topic.Tag_Ids`. "Projects" (items with subitems) are skipped — their subitems get counted instead. Archive items (`Status_Id === 7`) are excluded.

Clicking a KPI sets `meetingFocusFilter` on the page. Active KPI gets a 2px colored outline. Click again to clear. Counts are recomputed reactively when `attendeeFilter` is set — they then reflect only that attendee's items.

### 4.8 Sidebar — Attendees (`Agenda.jsx:6125-6248`)

Section with header `"Attendees"` (copper) + dashed "Manage Guests" button + `"Tasks"` column label on the right.

For each attendee:
- 24px Avatar (color from `member.Avatar_Color`, "?" grey if `_unresolved`)
- Member name (weight 500, weight 600 when active filter)
- Right-aligned task count

Sorted: **clients first** (anyone not `@vistamarconsulting.com`), then a `Divider`, then VM team members. Each group alphabetized. Silent proxies (`meetings@`, `seo@`) filtered out via `isSilentProxy`. See memory `silent_proxies`.

Click row → toggles `attendeeFilter` to that member's name. Active row: `copperFaint` background, copper border. Coupled with all topic cards and mini board groups.

**Manage Guests dialog** (`ManageGuestsDialog` at `Agenda.jsx:3757+`):
- Member-picker autocomplete from `pmMembers` for internal adds.
- Free-text email + display name input for external attendees.
- Two-radio scope when editing a bound series: "Future meetings only" (default) | "Apply to all (incl. past)".
- On Save, computes add/remove diffs, writes optimistically to `pm.Agenda_Attendees`, and sets `inviteSendPending` so the Send Invite button surfaces (does NOT fire Graph immediately — see memory `meetings_no_overcomplicate`).

### 4.9 "Prepared by" footer (`Agenda.jsx:6267-6293`)

Tiny block at the bottom of the sidebar: "PREPARED BY" copper label + "Vistamar Consulting" + today's date. Cosmetic — copy verbatim.

---

## 5. Overview View (`viewMode === "overview"`)

`AgendaOverview` at `Agenda.jsx:2594-2950+`. A flatter document-style layout sharing the SAME write hooks as Working view — edits in either view propagate to the other.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  HERO (toggle, title, schedule)                             │  ← §3, same as Working
├─────────────────────────────────────────────────────────────┤
│  [Andy] [Cedric] [Bill] [Leslie]                            │  ← Attendee chips
│                                                             │
│  Topic Name (Playfair, 15px, bold, underline)               │
│   • talking point                                           │  ← inline-editable inputs
│   • talking point                                           │
│   • talking point                                           │
│                                                             │
│  Another Topic                                              │
│   • talking point                                           │
│   • talking point                                           │
│                                                             │
│  ＋ Add Topic                                                │  ← dashed copper button
│                                                             │
│  OPEN FLOOR (copper uppercase label)                        │
│   • discussion item                                         │
│   ＋ Add item                                                │
│                                                             │
│  PAST MEETINGS  (PastMeetingsCard, same as Working view)    │
└─────────────────────────────────────────────────────────────┘
```

### What's missing vs Working view

- **No Action Bar.** No Join Meeting, no Send buttons, no Conclude.
- **No sidebar.** No Meeting Focus, no Attendees panel, no Manage Guests.
- **No Mini Project Board, no KPI scorecard, no Topic Notes.** Each topic in Overview view is just title + bullet talking points.
- **No drag-to-reorder.** Topics in DOM order (still sorted by `Sort_Order` from the data layer).
- **No category/tag pills on the topic heading.** The Overview is content-focused; categorization metadata stays in Working view.

### Inline editing UX (`Agenda.jsx:2671-2684`)

Borderless inputs with a transparent bottom-border that turns copper on focus:

```js
const inputSx = {
  border: "none",
  borderBottom: "1.5px solid transparent",
  outline: "none",
  background: "transparent",
  width: "100%",
  padding: "2px 0 3px",
  cursor: "text",
  fontFamily: "inherit",
  fontSize: "inherit",
  color: "inherit",
  transition: "border-color 0.12s",
  "&:focus": { borderBottomColor: t.copper },
};
```

- **Topic name** (`Agenda.jsx:2715-2730`) — Playfair 15px weight 700, persistent 1.5px copper underline. `onBlur` writes `Topic_Name`.
- **Talking point** (`Agenda.jsx:2742-2754`) — 12px, copper focus underline. `onBlur` writes; **Enter** inserts a new blank talking point AFTER the current one (via fractional `Sort_Order: current + 0.5`) — see `handlePointKeyDown`.
- **Empty value on blur** → deletes the row (`handlePointBlur` removes if `value.trim()` is empty). Same pattern for open-floor items.
- Hover row reveals a tiny ✕ icon (`opacity 0 → 1`) for explicit delete.

### Add controls
- `＋ Add Topic` button (`Agenda.jsx:2774-2787`) — copper, dashed border. Adds `Topic_Name: "New Topic"`.
- `＋ Add item` button for Open Floor when empty.

### Attendee chip strip (`Agenda.jsx:2688-2704`)

Pill chips, `t.cream2` background, `t.cream3` border, 11px. Read-only here — to manage attendees, switch to Working view.

### Past Meetings card

Same `PastMeetingsCard` component as Working view (`Agenda.jsx:6027`). Both views render it; it's a low-cost addition to keep the Fireflies transcripts available in both modes.

---

## 6. Shared Subsystems

### 6.1 Design tokens (`t` palette)

Same as the Meeting Agendas listing — see `docs/MEETING_AGENDAS_PAGE_REFERENCE.md` §3. **Don't redefine; reuse the one module.**

### 6.2 Avatar (`Avatar` at `Agenda.jsx:370-386`, also `src/pages/pages/PmAvatar.jsx`)

24px circle, member-color background, white initials (`initials(name)` at `Agenda.jsx:492`). 2px white border + negative-margin stack when overlapped. Pass `$bg`, `$size`, `name`.

### 6.3 Member resolution (`resolveMember` at `Agenda.jsx:512-530`)

Resolves an attendee row to a full member object via FK match (`User_Id` then `Member_Id`). If unresolved (e.g., external attendee not in `pm.Members`), returns a sentinel with `_unresolved: true` so the Avatar renders as `?` grey. See memory `user_job_title_deferred` for why Member fields are sparser than they look.

### 6.4 Pill helpers
- `MiniPill` styled span (`Agenda.jsx:356`) — generic pastel pill, `$bg` + `$color` props.
- `CATEGORY_COLORS` map + `categoryColors(hexColor)` (`Agenda.jsx:545-559`) — derives a `{ bg, color, accent }` triple from a category's stored hex.
- `topicAccent(index)` (`Agenda.jsx:561-562`) — fallback color rotation when topic has no category.
- `getPillBg`, `getTextColor` from `pmPillColors.js` — used for tag pills.

See `Pastel_Pill_System.md` feature memory for the full color theory.

### 6.5 Silent proxy filter

`meetings@` and `seo@` are filtered out everywhere attendees are rendered. See `docs/MEETING_AGENDAS_PAGE_REFERENCE.md` §7 for the definitive rule. In Agenda Detail specifically:

- Sidebar Attendees list: `attendees.filter((att) => !isSilentProxy(att.Member_Email))` at `Agenda.jsx:6195-6197`.
- Overview attendee chips: same filter implicitly via `resolveMember` falling through (silent proxies aren't members).
- Topic card avatar stacks: same.

### 6.6 Schedule popover

Detailed in §3. Reads/writes `Meeting_Date`, `Meeting_Time`, `Cadence`, `Calendar_Series` row. On any change, sets `inviteSendPending` so the Send Invite button surfaces in the Working-view action bar.

### 6.7 Send Meeting Invite button (memory `project_explicit_send_invite_button`)

This is **not** the same as the Send menu (which sends prep emails). It's an explicit calendar-mutation trigger. The button only appears in Working view when there are staged calendar/attendee changes. Pressing it fires `POST /api/meetings/create` (if no binding yet) or `POST /api/meetings/attendees` (diff add/remove). Until pressed, nothing has gone to Graph or to client inboxes.

**Do not auto-fire on every edit.** Andy wants the staging step. Memory `feedback_meetings_no_overcomplicate` reinforces this — keep the smallest possible mutation surface.

---

## 7. State Inventory (working view)

`AgendaDetail` is heavy. Here's the state inside it so you know what to port:

| State | Where set | Purpose |
|---|---|---|
| `title` | initial from `a?.Meeting_Title` | Controlled hero TextField |
| `viewMode` | toggle click | `"working" | "overview"` |
| `manageGuestsOpen` | sidebar / Manage Guests button | Dialog open flag |
| `attendeeFilter` | sidebar attendee row click | Page-level attendee filter (string member name or null) |
| `meetingFocusFilter` | sidebar KPI click | `"done" | "review" | "onHold" | "overdue" | "dueThisWeek" | null` |
| `editingFloorIdx`, `editingFloorValue` | Open Floor row click | Inline-edit state |
| `newFloorItem` | Open Floor + Add input | Controlled input |
| `sendMenuAnchor` | Send ▾ button | Menu anchor el |
| `scheduleAnchor`, `scheduleMode` | date click | Schedule popover state |
| `createFrequency`, `createDay`, `createOrdinal`, `createError` | schedule popover | Create-mode form state |
| `pickerMonth` | schedule popover calendar | Picker month |
| `pickerHour`, `pickerMin`, `pickerIsPM`, `pickerDisplayHour` | schedule popover time | Time picker |
| `scheduleSendPending` (localStorage) | reschedule mutations | Tracks unsent schedule changes |
| `inviteSendPending` (localStorage) | schedule + attendee mutations | Surfaces Send Invite button |
| `editingTopicId`, `newTopicTitle`, `newTopicSummary`, `newTopicCategoryIds`, `newTopicTagIds` | topic ⋮ Edit | Topic edit form |
| `addingTopic` | + Add Topic | Inline add form open |
| `autoExpandId` | after topic save | Triggers `AgendaTopicCard.initialExpanded` |
| `sendError` | mutation failures | Inline error |
| `createMutation`, `attendeeMutation`, `rescheduleMutation`, `cancelMutation` | React Query | Mutation handles |

The Overview view (`AgendaOverview`) is stateless beyond its callbacks — all state lives in `AgendaDetail` and is passed in via props (`topics`, `talkingPoints`, `attendees`, `openFloor`, `topicHelpers`, `talkingPointHelpers`, `openFloorHelpers`, `agendaId`, `orgId`, `meetingDate`, `pmMembers`, `calendarSeries`, `firefliesTitles`).

---

## 8. Data Model — Fields Used on This Page

### `pm.Meeting_Agendas` (the agenda itself)
- `Id`, `Org_Id`, `Meeting_Title`, `Meeting_Date`, `Meeting_Time`, `Cadence` (null for ad-hoc), `Agenda_Status` (`draft | active | concluded | cancelled`).

### `pm.Calendar_Series` (1:1 with bound agendas)
- `Id`, `Agenda_Id`, `iCalUID`, `Google_Event_Id`, `M365_Event_Id`, `Teams_Url`, `Day_Of_Week`, `Time_Of_Day`, `Cadence`, `Sync_Status`, `Ordinal`.

### `pm.Agenda_Topics`
- `Id`, `Agenda_Id`, `Topic_Name`, `Topic_Desc`, `Category_Ids[]` (PK array), `Tag_Ids[]`, `Sort_Order`.

### `pm.Topic_Talking_Points`
- `Id`, `Topic_Id`, `Agenda_Id`, `Talking_Point`, `Sort_Order`.

### `pm.Topic_Notes`
- `Id`, `Topic_Id`, `Agenda_Id`, `Topic_Note`.

### `pm.Agenda_Attendees`
- `Id`, `Agenda_Id`, `User_Id` (nullable FK `sec.Users`), `Member_Id` (nullable FK `pm.Members`), `Member_Name`, `Member_Email`.

### `pm.Open_Floor`
- `Id`, `Agenda_Id`, `Discussion_Item`, `Sort_Order`.

### `pm.Items` + `pm.Subitems` (rendered inside Mini Project Boards)
- Filtered into a topic via `Category_Id ∈ topic.Category_Ids` OR `Tag_Ids ∩ topic.Tag_Ids`.
- Key fields used by the row renderer: `Title`, `Description`, `Status_Id`, `Priority_Id`, `Category_Id`, `Tag_Ids[]`, `Assigned_User_Ids[]`, `Assigned_Member_Ids[]`, `Due_Date`, `Notes` (threaded comments), `Files`.

### `pm.Fireflies_Meeting_Mappings`
- Per-agenda title aliases that the Fireflies query filters on. `Agenda_Id`, `Fireflies_Meeting_Title`.

### V2 Firestore mapping
The Console PM module is being ported. The 2026-05-20 V2 design spec at `docs/superpowers/specs/2026-05-20-meetings-v2-design.md §4` lays out the Firestore shape:
- `calendar_series/{seriesId}` ← `pm.Calendar_Series`
- `agendas/{agendaId}` ← `pm.Meeting_Agendas`
- `agendas/{agendaId}/topics/{topicId}` ← `pm.Agenda_Topics`
- `agendas/{agendaId}/topics/{topicId}/talkingPoints/{tpId}` ← `pm.Topic_Talking_Points`
- `agendas/{agendaId}/topics/{topicId}/notes/{noteId}` ← `pm.Topic_Notes`
- `agendas/{agendaId}/attendees/{attendeeId}` ← `pm.Agenda_Attendees`
- `agendas/{agendaId}/openFloor/{itemId}` ← `pm.Open_Floor`

Items / Subitems live in `tasks/` (your V1 schema). The cross-link is `Category_Id` + `Tag_Ids` matching, same logic — port `boardItems` selector verbatim.

---

## 9. Component Index (quick lookup by file:line)

| Component / styled | File:Line |
|---|---|
| `AgendaDetail` | `Agenda.jsx:4351` |
| Hero title + schedule | `Agenda.jsx:4790-5340` |
| Working/Overview toggle | `Agenda.jsx:4756-4789` |
| Schedule Popover (3 modes) | `Agenda.jsx:4856-5300` |
| Action Bar | `Agenda.jsx:5341-5530` |
| ContentGrid (2-col layout) | styled at `Agenda.jsx:310-328` |
| MainCol | styled at `Agenda.jsx:319` |
| SideCol | styled at `Agenda.jsx:324` |
| Sidebar — Meeting Focus | `Agenda.jsx:6033-6122` |
| Sidebar — Attendees | `Agenda.jsx:6125-6248` |
| Sidebar — Prepared by | `Agenda.jsx:6267-6293` |
| `ManageGuestsDialog` | `Agenda.jsx:3757+` |
| `AgendaTopicCard` | `Agenda.jsx:2064-2588` |
| Topic edit form (inline) | `Agenda.jsx:5556-5681` |
| + Add Topic (inline form) | `Agenda.jsx:5743+` |
| Topic KPI scorecard | `Agenda.jsx:2314-2387` |
| Talking Points list | `Agenda.jsx:2389-2489` |
| Topic Notes list | `Agenda.jsx:2500-2582` |
| `MiniProjectBoard` | `Agenda.jsx:1455-1600` |
| `MiniBoardItem` (parent row + subitems) | `Agenda.jsx:1603-1652` |
| `MiniBoardRow` (single row, all columns) | `Agenda.jsx:1653+` |
| Open Floor section | `Agenda.jsx:5919+` |
| `PastMeetingsCard` (Fireflies) | `Agenda.jsx:3470-3756` |
| `AgendaOverview` | `Agenda.jsx:2594-2950+` |
| Helpers — `initials`, `memberColor`, `resolveMember` | `Agenda.jsx:492-530` |
| `CATEGORY_COLORS`, `categoryColors`, `topicAccent` | `Agenda.jsx:545-562` |
| `t` palette | `Agenda.jsx:86-107` |
| Styled exports (TopicCard, TopicBody, KpiGrid, etc.) | `Agenda.jsx:236-490` |

---

## 10. Port Order Suggestion

Outside-in, same pattern as the listing-page doc:

1. **Two-view shell.** `AgendaDetail` component with hero + toggle + empty body. Render `<div>Working view</div>` / `<div>Overview view</div>` placeholders.
2. **Overview view first.** Smaller surface, no embedded board complexity. Confirms your data hooks + write-back patterns work before you tackle the working view. Talking-point Enter-key insertion at fractional sort order is the tricky bit.
3. **Working view chrome.** Action bar + ContentGrid + sidebar shells (no data).
4. **Sidebar — Meeting Focus + Attendees.** These can render off existing data; they don't need topic-card logic. Build them as standalone components and wire `attendeeFilter` / `meetingFocusFilter` page state.
5. **AgendaTopicCard (without the board).** Header, KPI strip, Talking Points, Topic Notes. Editable. No Mini Project Board.
6. **MiniProjectBoard.** This is the big one — same row component as your existing Task Board, ideally reused. Add the Active/Completed/Archive grouping wrapper.
7. **Topic-card ↔ filter coupling.** Auto-expand/collapse on external filter, scorecard click filtering.
8. **Drag-reorder.** Wrap topic list in `DragDropContext`.
9. **Schedule popover** (create + this-meeting + all-future modes).
10. **Send Invite button.** Wire `inviteSendPending` localStorage state to the callable.
11. **Past Meetings (Fireflies).** Defer if not needed for V2.1.

Andy will scope the slice. V2.3 in the 2026-05-27 plan covers the Agenda Detail surface — use that scope unless Andy says otherwise.

---

## 11. Gotchas

- **Single hook instances.** Don't reach for `useAgendaDetail` (composed hook) for read in one component and `useTopics` / `useTalkingPoints` for write in another within `AgendaDetail`. Their internal state diverges, and you'll get stale renders. The Console explicitly notes this at `Agenda.jsx:4356`. Pattern: in `AgendaDetail`, instantiate all the helpers once and pass them down via props.
- **Talking-point Enter-insertion uses fractional `Sort_Order`.** `current.Sort_Order + 0.5`. The data layer accepts non-integer sort orders. Don't reindex on every insert; the data layer normalizes lazily.
- **Empty inline-edit on blur = delete.** Both Talking Points and Open Floor items: blur with empty trimmed string → row removed. This is intentional and worth preserving — users discover it quickly and it's the cleanest way to delete a typed-by-accident row.
- **Topic-card initialExpanded only triggers on prop change.** After saving an edit, `setAutoExpandId(editingTopicId)` to force re-expand. See `Agenda.jsx:2072-2074`.
- **Mini Project Board "no cat/tag" empty state.** A new topic with no categories or tags shows an italic placeholder instead of the board. Andy doesn't want a blank dashboard staring at the user — they need to pick a filter first. Memory `feedback_no_lazy_deferrals` applies if you're tempted to silently render an empty board.
- **Past Meetings (Fireflies) is cached aggressively.** `staleTime: Infinity`, localStorage persistence, `retry: 0`. Don't add background refetch — Fireflies has a 60/min rate limit and Andy got bitten when prior code hammered it.
- **`hashState` routing.** The Console used hash-based view state (`#agenda/:id`) so browser back/forward worked. The V2 port should use React Router routes (`/agendas/:agendaId`), not hash. Memory: `feedback_no_lazy_deferrals` ≠ "preserve broken patterns" — replace hash with proper routing.
- **Member fields are sparser than they look.** Memory `user_job_title_deferred`: `sec.Users` + `pm.Members` both lack `Job_Title` currently, so any UI that wants role/title strings will need to wait for the full-stack write. Don't display `Member_Role` — it's not populated.
- **Drag handle conflict with click-to-expand.** The Console wraps the topic card in a `dragHandleProps` Box around the whole card. The card header's `onClick={() => setExpanded(...)}` only fires on click, not drag, because react-beautiful-dnd suppresses click after drag. If you reimplement reorder with a different DnD lib, verify this UX still works — Andy will notice.

---

## 12. Single-Sentence Brief

Port `AgendaDetail` (`Agenda.jsx:4351-end`) with both `viewMode === "working"` and `viewMode === "overview"` branches: working view is a two-column layout with an Action Bar, a main column of draggable `AgendaTopicCard`s (each card: KPI strip → Talking Points → MiniProjectBoard → Topic Notes), an Open Floor section, a Past Meetings (Fireflies) card, and a sidebar with Meeting Focus + Attendees + Prepared-by; overview view is a flat document of inline-editable topic headings with talking-point bullets, an Open Floor, an attendee chip strip, and a Past Meetings card — both views share one set of data hooks and write helpers, all attendees filtered through `isSilentProxy`, and explicit calendar/attendee mutations gated behind a "Send Meeting Invite" button that surfaces via localStorage-tracked staged changes.
