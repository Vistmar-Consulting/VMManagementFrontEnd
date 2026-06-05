# Collapsible Sidebar — Design Spec

**Date:** 2026-06-05  
**Status:** Approved

---

## Problem

The sidebar (240px wide) consumes a large fraction of the screen on iPhone, leaving the content area too narrow to use comfortably.

## Solution

Add a chevron toggle to the sidebar header. Clicking it collapses the sidebar to an icon-only rail (52px). Defaults to collapsed on mobile viewports, expanded on desktop. User choice persisted in `localStorage`.

---

## Behavior

### Expanded state (240px)
- Sidebar shows full width: brand name "Vistamar Management", nav labels, Settings children collapse — all as today.
- A `ChevronLeft` `IconButton` sits on the right side of the sidebar header.

### Collapsed state (52px)
- Sidebar shrinks to icon-only rail: nav icons remain visible and clickable; all text labels, the brand name, and the Settings children list are hidden.
- A `ChevronRight` `IconButton` sits centered in the sidebar header (the brand text is gone, so the chevron centers itself).
- Clicking any icon in the collapsed rail **navigates** as normal AND expands the sidebar. This handles the Settings group (which has no route of its own) uniformly — clicking Settings icon expands the sidebar so children are visible.
- Width transition: `width 0.2s ease` for a smooth slide.

### Default state
- **Mobile (viewport < 600px / MUI `xs`):** collapsed by default on first visit.
- **Desktop (≥ 600px):** expanded by default on first visit.
- **Returning visits:** `localStorage` key `vm-sidebar-collapsed` overrides the default — user's last explicit choice is respected.

### Layout
`SignedInLayout` needs no changes. The content `Box` uses `flex: 1` — it automatically expands to fill the space the sidebar vacates. The sidebar uses `flexShrink: 0` so it holds its own width.

---

## Files

| File | Change |
|---|---|
| `src/theme/index.js` | Add `collapsedWidth: 52` to `theme.sidebar` |
| `src/components/Sidebar.jsx` | All collapse logic: state, chevron button, conditional rendering |

`src/layouts/SignedInLayout.jsx` — **no changes.**  
`src/components/AppTopBar.jsx` — **no changes.**

---

## Implementation detail — Sidebar.jsx

### State
```js
const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
// Compute the seed once at mount via useRef — avoids a localStorage read on
// every render and bypasses the timing race where useLocalStorage's internal
// useEffect may fire before useMediaQuery resolves on mobile.
const defaultCollapsed = useRef(
  (() => {
    const stored = localStorage.getItem('vm-sidebar-collapsed');
    return stored === null ? isMobile : JSON.parse(stored);
  })()
);
const [collapsed, setCollapsed] = useLocalStorage(
  'vm-sidebar-collapsed',
  defaultCollapsed.current
);
```
`useLocalStorage` from `@uidotdev/usehooks` (already used in TaskBoard + Calendar). `useRef` + IIFE ensures `localStorage` is read exactly once at mount; on all subsequent renders `useLocalStorage` uses the already-persisted value and the ref is ignored.

**Imports to add:** `useRef` from `react`; `useMediaQuery` and `useTheme` from `@mui/material` (neither is currently used in `Sidebar.jsx` — must be added explicitly).

### Width + overflow
```js
sx={{
  width: collapsed ? theme.sidebar.collapsedWidth : theme.sidebar.width,
  // overflow: hidden clips label text during the collapse transition.
  // NOTE: a box-shadow on this element would also be clipped; use
  // filter: drop-shadow() instead if a shadow is ever added.
  overflow: 'hidden',
  transition: 'width 0.2s ease',
  ...
}}
```

### Header
- Expanded: `Stack direction="row" justifyContent="space-between"` — brand text on left, `ChevronLeft` on right.
- Collapsed: `Stack direction="row" justifyContent="center"` — only `ChevronRight` centered.

### Nav items (TOP_LEVEL)
- Icon always rendered.
- `ListItemText` wrapped in a `Collapse` or simply conditionally rendered based on `collapsed`.

### Settings group
- When collapsed: `ListItemText` hidden, chevron indicator hidden. Clicking the Settings `ListItemButton` must set **both** `setCollapsed(false)` AND `setSettingsOpen(true)` — so the sidebar expands and the Settings children are immediately visible. (If only `setCollapsed(false)` is called and `settingsOpen` was `false`, the user sees an expanded sidebar with a closed Settings group and has to click again.)
- When expanded: existing toggle behavior unchanged (`setSettingsOpen(o => !o)`).

### Settings children
- `<Collapse in={settingsOpen && !collapsed}>` — children only show when both settings is open AND sidebar is expanded.

---

## Theme addition

```js
theme.sidebar = {
  width: 240,
  collapsedWidth: 52,
  // ... existing keys unchanged
};
```

---

## Out of scope

- Auto-collapse on navigation (not needed — icon rail is always usable).
- Hamburger button in AppTopBar (not needed — chevron stays visible in the rail).
- Tooltip on hover for icon-only rail (nice-to-have, not in scope).
