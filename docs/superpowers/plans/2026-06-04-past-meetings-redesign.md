# Past Meetings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-expanded flat Fireflies list with a collapsible white card that defaults collapsed, with a Refresh button and rich rows (title + date + NEW badge + action count + snippet).

**Architecture:** Single-file rewrite of `PastMeetingsCard.jsx`. Data logic (useQuery, detailsMap prefetch, deep search) is preserved. The render output is replaced entirely. A `seedIdsRef` tracks which recording IDs were present at mount / last refresh so the NEW badge only fires for genuinely new recordings.

**Tech Stack:** React 18, MUI 5, TanStack React Query 5, date-fns, existing `firefliesStyled.js` tokens.

---

## Key facts before you touch anything

1. **`GQL_MEETING_LIST` does not return `summary`** — `m.summary` is always `undefined` in list results. The current code is silently broken here. Rich rows must pull snippet + action items from `detailsMap[m.id]?.transcript?.summary` (the prefetched detail data), not from `m.summary`.

2. **Count pill in header** shows `allMeetings.length` (total recordings for this series). The inner-card header shows the filtered count. Do not use `meetings.length` for the outer pill.

3. **`seedIdsRef`** is a `useRef` (not state) so updating it never triggers a re-render.

4. **Imports to add:** `useRef` (react), `Button, CircularProgress, Tooltip` (MUI), `Refresh` (@mui/icons-material).  
   **Imports to remove:** `Divider` (no longer used).

---

## File Map

| File | Change |
|---|---|
| `src/components/PastMeetingsCard.jsx` | Full rewrite (data logic kept, render replaced) |

No other files change.

---

## Task 1: Update imports and state — no visual change yet

**Files:**
- Modify: `src/components/PastMeetingsCard.jsx:19-32`

- [ ] **Step 1: Update the import block**

Replace lines 19-28:

```jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box, Button, CircularProgress, IconButton,
  TextField, Tooltip, Typography,
} from "@mui/material";
import { Close, Refresh, Search } from "@mui/icons-material";
import { format } from "date-fns";
```

- [ ] **Step 2: Add `isOpen` state and `seedIdsRef` inside the component, just after the existing `search` and `selectedId` state**

After `const [selectedId, setSelectedId] = useState(null);` add:

```jsx
const [isOpen, setIsOpen] = useState(false);
// Snapshot of recording IDs at mount (or last manual refresh).
// Used to mark recordings that appeared since then with a NEW badge.
const seedIdsRef = useRef(
  (() => {
    try {
      const raw = localStorage.getItem("fireflies-meetings-cache");
      const parsed = raw ? JSON.parse(raw) : null;
      return new Set((parsed?.data?.transcripts || []).map((t) => t.id));
    } catch { return new Set(); }
  })()
);
```

- [ ] **Step 3: Add `isFetching` and `refetch` to the useQuery destructure**

Change line 45:
```jsx
// Before:
const { data: listData, isLoading: listLoading } = useQuery({
// After:
const { data: listData, isLoading: listLoading, isFetching, refetch } = useQuery({
```

- [ ] **Step 4: Add `handleRefresh` function (after the `highlight` function, before the return)**

```jsx
const handleRefresh = () => {
  // Update seedIds to current list so only recordings that appear *after*
  // this press get the NEW badge.
  seedIdsRef.current = new Set((listData?.transcripts || []).map((t) => t.id));
  refetch();
};
```

- [ ] **Step 5: Remove `titleFilter` state, `meetingTitles` useMemo, `loading`/`count` aliases, and `getActionItems` helper**

Delete each of these blocks:
```jsx
const [titleFilter, setTitleFilter] = useState(null);

// Unique meeting titles for filter pills
const meetingTitles = useMemo(() => { ... }, [allMeetings]);
```
```jsx
const loading = listLoading;
const count = meetings?.length || 0;
```
```jsx
const getActionItems = (summary) => { ... };
```

- [ ] **Step 6: Remove `titleFilter` from the `meetings` useMemo**

In the `meetings` useMemo, delete the `if (titleFilter)` filter line AND remove `titleFilter` from the dependency array:

```jsx
// Before:
}, [allMeetings, titleFilter, search, detailsMap]);

// After:
}, [allMeetings, search, detailsMap]);
```

The `meetings` useMemo now only applies the `search` filter.

- [ ] **Step 7: Verify no runtime errors**

Run `npm run dev` and open any agenda detail page. The component still renders (it hasn't changed visually yet — that's Task 2). No console errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/PastMeetingsCard.jsx
git commit -m "refactor(past-meetings): wire isOpen/seedIdsRef/refetch, drop titleFilter"
```

---

## Task 2: Rewrite the render output

**Files:**
- Modify: `src/components/PastMeetingsCard.jsx` — replace the entire `return (...)` block

This is the main visual change. Replace everything from `return (` through the closing `</>` (lines 168–301) with the following:

- [ ] **Step 1: Write the new return block**

```jsx
  const totalCount = allMeetings.length;
  const filteredCount = meetings.length;

  return (
    <>
      {/* ── Outer white card ── */}
      <Box
        sx={{
          mt: 4,
          background: "white",
          border: `1px solid ${t.cream3}`,
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        {/* ── Collapsible header ── */}
        <Box
          onClick={() => {
            if (isOpen) setSearch("");
            setIsOpen((v) => !v);
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 1.5,
            cursor: "pointer",
            userSelect: "none",
            borderBottom: isOpen ? `1px solid ${t.cream2}` : "none",
            "&:hover": { background: t.copperFaint },
          }}
        >
          <Box sx={{ width: 3, height: 16, borderRadius: 0.5, background: t.copper, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper }}>
            Past Meetings
          </Typography>
          {totalCount > 0 && (
            <MiniPill style={{ background: t.copperFaint, color: t.copper }}>{totalCount}</MiniPill>
          )}
          <Box sx={{ ml: "auto", fontSize: 14, color: t.ink3, transition: "transform 0.2s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", display: "flex", alignItems: "center" }}>
            ›
          </Box>
        </Box>

        {/* ── Collapsible body ── */}
        {isOpen && (
          <Box sx={{ p: 2, background: t.cream }}>

            {/* Search + Refresh row */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search recordings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: <Search sx={{ color: t.ink3, fontSize: 16, mr: 0.5 }} />,
                  ...(search && {
                    endAdornment: (
                      <IconButton size="small" onClick={() => setSearch("")}>
                        <Close sx={{ fontSize: 14 }} />
                      </IconButton>
                    ),
                  }),
                }}
                sx={{
                  "& .MuiInputBase-root": { fontSize: 12, borderRadius: "8px", background: "white", height: 34 },
                  "& .MuiOutlinedInput-notchedOutline": { borderColor: t.cream3 },
                  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: t.copperLight },
                  "& .Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: t.copper },
                }}
              />
              <Tooltip title="Refresh from Fireflies">
                <span>
                  <Button
                    size="small"
                    onClick={handleRefresh}
                    disabled={isFetching}
                    startIcon={isFetching ? <CircularProgress size={12} sx={{ color: t.ink3 }} /> : <Refresh sx={{ fontSize: 14 }} />}
                    sx={{
                      fontSize: 11, color: t.ink2, textTransform: "none",
                      border: `1px solid ${t.cream3}`, borderRadius: "8px",
                      height: 34, px: 1.5, whiteSpace: "nowrap",
                      "&:hover": { background: t.cream2 },
                    }}
                  >
                    Refresh
                  </Button>
                </span>
              </Tooltip>
            </Box>

            {/* ── Inner Fireflies card ── */}
            <Box sx={{ border: `1px solid ${t.cream3}`, borderRadius: "8px", overflow: "hidden", background: "white" }}>
              {/* Inner card header */}
              <Box sx={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                px: 1.5, py: 1, background: t.cream2,
              }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.ink3 }}>
                  Fireflies Recordings
                </Typography>
                <Typography sx={{ fontSize: 10, color: t.ink3 }}>
                  {search ? `${filteredCount} of ${totalCount}` : `${totalCount} recording${totalCount !== 1 ? "s" : ""}`}
                </Typography>
              </Box>

              {/* Scrollable list */}
              <Box sx={{ maxHeight: 255, overflowY: "auto" }}>
                {listLoading ? (
                  [0, 1, 2].map((i) => (
                    <Box key={i} sx={{ p: 1.5, borderBottom: `1px solid ${t.cream2}` }}>
                      <ShimmerBar $h={13} $w="40%" $mb={5} />
                      <ShimmerBar $h={11} $w="85%" $mb={0} />
                    </Box>
                  ))
                ) : meetings.length === 0 ? (
                  <Typography sx={{ fontSize: 12, color: t.ink3, fontStyle: "italic", py: 2.5, textAlign: "center" }}>
                    {search ? "No recordings match your search" : "No recorded meetings found for this series"}
                  </Typography>
                ) : (
                  meetings.map((m) => {
                    const detail = detailsMap[m.id]?.transcript?.summary;
                    const actionItems = detail?.action_items
                      ? (Array.isArray(detail.action_items) ? detail.action_items : detail.action_items.split("\n").filter(Boolean))
                      : [];
                    const rawSnippet = detail?.short_summary || detail?.overview || "";
                    const snippet = rawSnippet.length > 140 ? rawSnippet.slice(0, 140) + "…" : rawSnippet;
                    const isNew = !seedIdsRef.current.has(m.id);
                    return (
                      <Box
                        key={m.id}
                        onClick={() => setSelectedId(m.id)}
                        sx={{
                          px: 1.5, py: 1.25,
                          borderBottom: `1px solid ${t.cream2}`,
                          cursor: "pointer",
                          transition: "background 0.1s",
                          "&:hover": { background: t.copperFaint },
                          "&:last-child": { borderBottom: "none" },
                        }}
                      >
                        {/* Row line 1: title + date + NEW + action count */}
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: snippet ? 0.4 : 0 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: t.ink }}>
                            {m.title || "Untitled"}
                          </Typography>
                          <Typography sx={{ fontSize: 10, color: t.ink3, flexShrink: 0 }}>
                            {m.date ? format(new Date(m.date), "MMM d, yyyy") : ""}
                          </Typography>
                          {isNew && (
                            <Box component="span" sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", px: 0.75, py: 0.25, borderRadius: "4px", background: "#d4edda", color: "#1a6b2e" }}>
                              new
                            </Box>
                          )}
                          {actionItems.length > 0 && (
                            <MiniPill style={{ background: t.copperFaint, color: t.copper, marginLeft: "auto" }}>
                              {actionItems.length} action{actionItems.length !== 1 ? "s" : ""}
                            </MiniPill>
                          )}
                        </Box>
                        {/* Row line 2: snippet */}
                        {snippet && (
                          <Typography sx={{ fontSize: 11, color: t.ink2, lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>
                            {search ? highlight(snippet, search) : snippet}
                          </Typography>
                        )}
                      </Box>
                    );
                  })
                )}
              </Box>
            </Box>

          </Box>
        )}
      </Box>

      {selectedId && (
        <MeetingDetailModal transcriptId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
```

- [ ] **Step 2: Save the file and check for obvious syntax errors**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors. If there are JSX syntax errors, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/components/PastMeetingsCard.jsx
git commit -m "feat(past-meetings): collapsible white card, Refresh button, rich rows, NEW badge"
```

---

## Task 3: Visual verification

**Files:** none (read-only)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev -- --force
```

Expected: server ready at `http://localhost:5173`.

- [ ] **Step 2: Open the GV – Biweekly agenda in agent-browser (headed)**

```bash
agent-browser --headed open http://localhost:5173
```

Log in if prompted (Google SSO — requires Andy's account). Navigate to the GV – Biweekly agenda detail page.

- [ ] **Step 3: Verify collapsed state**

Take a screenshot. The Past Meetings section should be a white card showing only the header bar with copper accent, label, count pill, and `›` chevron. The body should be hidden.

```bash
agent-browser screenshot /tmp/pm-collapsed.png
```

Expected: white card, no search bar visible, chevron pointing right.

- [ ] **Step 4: Verify expand + rich rows**

```bash
agent-browser find text "Past Meetings" click
agent-browser wait 1000
agent-browser screenshot /tmp/pm-expanded.png
```

Expected: card expands, search bar + Refresh button visible, inner Fireflies card showing recordings with title + date. Jun 3 recording should show `new` badge if it wasn't in the localStorage cache when the page loaded.

- [ ] **Step 5: Verify search filtering**

```bash
agent-browser find placeholder "Search recordings…" fill "Jun 3"
agent-browser screenshot /tmp/pm-search.png
```

Expected: inner card header updates to "1 of N", only the Jun 3 recording visible.

- [ ] **Step 6: Verify Refresh button**

Clear the search field, click Refresh. Button should show spinner briefly, then restore.

- [ ] **Step 7: Verify collapse resets search**

Type something in search, then click the header to collapse. Re-expand — search field should be empty.

- [ ] **Step 8: Kill dev server, commit if any fixes were needed**

If no fixes were needed during verification, no additional commit required — Task 2 commit stands.

If fixes were needed:
```bash
git add src/components/PastMeetingsCard.jsx
git commit -m "fix(past-meetings): post-verification corrections"
```

---

## Done

The redesigned `PastMeetingsCard` is complete. The component is collapsed by default, wraps everything in a white card, shows rich rows with snippet + NEW badge, and has a working Refresh button that updates the NEW badge baseline.
