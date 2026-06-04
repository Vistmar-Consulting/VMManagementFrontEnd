# Past Meetings Section Redesign

**Date:** 2026-06-04  
**Status:** Approved  
**Component:** `src/components/PastMeetingsCard.jsx`

---

## 1. Goal

Replace the current always-expanded flat list with a collapsible white card that defaults to collapsed. The section stays out of the way for users who don't need it and opens fully when needed.

---

## 2. Visual Design

### Collapsed state
A white card (`border-radius: 10px`, `border: 1px solid cream3`) showing only the header row:

```
┌─────────────────────────────────────────────────────┐
│ ▌ PAST MEETINGS  [6]                              › │
└─────────────────────────────────────────────────────┘
```

- Copper accent bar (3px wide) + uppercase copper label + count pill
- Chevron (`›`) on the far right
- Clicking anywhere on the header expands the card

### Expanded state
Same white card, header now has a bottom border, body rendered below:

```
┌─────────────────────────────────────────────────────┐
│ ▌ PAST MEETINGS  [6]                              ∨ │
├─────────────────────────────────────────────────────┤
│ [bg: cream]                                         │
│  ┌──────────────────────────────────────┐ [↻ Refresh]│
│  │ 🔍 Search recordings…               │           │
│  └──────────────────────────────────────┘           │
│                                                     │
│  ┌─ FIREFLIES RECORDINGS ─────── 6 recordings ─┐   │
│  │ GV – Biweekly       Jun 3, 2026  NEW  3 act ↕│   │
│  │ Discussed SEO audit findings, keyword …      │   │
│  │─────────────────────────────────────────────│   │
│  │ GV – Biweekly       May 20, 2026      2 act  │   │
│  │ Reviewed May performance metrics …          │   │
│  │─────────────────────────────────────────────│   │
│  │  … (scrollable, ~5 rows visible)            │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

- Body background: `cream` (`#faf8f5`)
- Inner Fireflies card: white, `border: 1px solid cream3`, `border-radius: 8px`
- Inner card header: `cream2` background, uppercase muted label + recording count on right
- Scrollable list: `max-height: ~255px` (≈5 rich rows), `overflow-y: auto`
- No pagination — just scroll

### Row format (rich)
Each Fireflies row shows:
- **Line 1:** bold title + muted date + optional `NEW` green badge + optional `N actions` copper badge (right-aligned)
- **Line 2:** one-line truncated AI summary snippet (from `summary.short_summary` or `summary.overview`)
- Hover: faint copper background
- Click: opens existing `MeetingDetailModal`

`NEW` badge appears on recordings that weren't present the last time the user explicitly refreshed. Implementation: a `seedIds` ref snapshots the recording IDs present in `initialData` at mount. When the user presses **Refresh**, `seedIds` is updated to the IDs present just before `refetch()` is called, so only IDs that appear after that press get the badge. Automatic background refetches (triggered by the 30-min stale TTL) also update `seedIds` before fetching, so the badge never fires without a deliberate user action. The badge persists for the session (until the user refreshes again or navigates away).

---

## 3. Behaviour

### Collapse / expand
- Default: **collapsed**
- State held in local component `useState` (not persisted — resets on page navigate, which is correct)
- Smooth CSS transition on the chevron rotation; no height animation required (MUI Collapse or simple `display` toggle is fine)

### Search
- Single `TextField` in the body, shared across (only Fireflies recordings for now; designed to extend to a second card later)
- Filters `allMeetings` list by: title, date string, prefetched detail overview + action items + keywords (same logic as current `PastMeetingsCard`)
- Clears on collapse (reset `search` state when user collapses)

### Refresh button
- Lives in the search row, right-aligned
- Calls React Query `refetch()` — same as the existing Refresh in `FirefliesMeetings.jsx`
- Shows `CircularProgress` (16px) while `isFetching`; disabled during fetch
- After refetch, React Query updates `listData`; the NEW badge logic re-evaluates against what was in cache before the refetch

### Data / cache
- Unchanged from the post-fix behaviour: `initialDataUpdatedAt` + `staleTime: 30min`
- Refetch writes the updated list to `localStorage["fireflies-meetings-cache"]`
- `NEW` badge: on mount, snapshot the set of IDs present in `initialData` (the pre-refetch cache); after refetch, any ID not in that snapshot gets the badge for the session

### Title filter pills
- **Removed.** The search bar covers this use case. Fewer UI elements in an already-dense section.

### Loading / empty states
- Count pill in header: omitted when list is loading and no initial data exists (count is 0)
- If list is loading and no initial data: shimmer bars (existing `ShimmerBar`) inside the inner card
- If no meetings match: italic "No recordings match your search" or "No recorded meetings found for this series"

---

## 4. Component Changes

### `PastMeetingsCard.jsx` — full rewrite of render output; data logic mostly preserved

**Keep:**
- `useQuery` with `initialData` / `initialDataUpdatedAt` / `staleTime: 30min` (the TTL fix)
- `allMeetings` filter by `firefliesTitles` (case-insensitive)
- `detailsMap` prefetch effect for deep search
- `MeetingDetailModal` integration
- `search` state + filter logic

**Remove:**
- `titleFilter` state and title-filter pills
- `hasCachedList` / `enabled: !hasCachedList` (already removed in prior fix)

**Keep (explicitly):**
- `isFetching` / `isLoading` from `useQuery`
- `detailsMap` prefetch effect (fires at mount regardless of `isOpen`; prefetching in background is correct)
- `highlight()` utility (still used for search match highlighting in snippet Line 2)
- The search TextField and its clear-X live entirely inside the collapsible body; they are not visible in the collapsed state

**Add:**
- `isOpen` state (default `false`)
- `refetch` and `isFetching` from `useQuery` destructure
- `seedIds` ref — snapshot of IDs present in `initialData` at mount; updated just before each refetch (manual or auto) so `NEW` badge only fires after a deliberate Refresh press
- Outer white card wrapper
- Collapse/expand toggle on header click
- Refresh button wired to `refetch()`
- `isFetching` spinner on Refresh button
- Reset `search` on collapse

### No other files change.

---

## 5. Out of Scope

- Second inner card (saved meeting agendas / version history) — deferred
- Persisting collapsed/expanded state across navigation
- Animations beyond chevron rotation
