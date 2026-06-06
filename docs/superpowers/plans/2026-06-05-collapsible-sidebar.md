# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chevron toggle to the sidebar that collapses it to an icon-only rail (52px), defaulting to collapsed on mobile and expanded on desktop, persisted in localStorage.

**Architecture:** Two-file change only. `theme/index.js` gains `collapsedWidth: 52`. `Sidebar.jsx` gets collapsed state (seeded via `useRef` IIFE + `useLocalStorage`), a chevron button in the header, conditional rendering of text labels, and a split Settings click handler. `SignedInLayout` and `AppTopBar` are untouched — the flex layout auto-adjusts.

**Tech Stack:** React 18, MUI 5 (`useMediaQuery`, `useTheme`, `Collapse`), `@uidotdev/usehooks` (`useLocalStorage`), Lucide React (`ChevronLeft`, `ChevronRight`), React Router `NavLink`

---

## File Map

| File | Change |
|---|---|
| `src/theme/index.js` | Add `collapsedWidth: 52` to `theme.sidebar` |
| `src/components/Sidebar.jsx` | All collapse logic (state, chevron, conditional rendering) |

---

### Task 1: Add `collapsedWidth` to theme

**Files:**
- Modify: `src/theme/index.js:18-28`

**Current state of `theme.sidebar` block (lines 18–28):**
```js
theme.sidebar = {
  width: 240,
  color: "#cfd8dc",
  background: "#233044",
  active: "#2f3e54",
  header: {
    background: "#1e2a3a",
    color: "#FFFFFF",
    brand: "#7ea8e5",
  },
};
```

- [ ] **Step 1: Add `collapsedWidth`**

Change the block to:
```js
theme.sidebar = {
  width: 240,
  collapsedWidth: 52,
  color: "#cfd8dc",
  background: "#233044",
  active: "#2f3e54",
  header: {
    background: "#1e2a3a",
    color: "#FFFFFF",
    brand: "#7ea8e5",
  },
};
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```
Expected: 80 passed (no theme tests; just confirm nothing broke).

- [ ] **Step 3: Commit**

```bash
git add src/theme/index.js
git commit -m "feat(theme): add sidebar collapsedWidth token"
```

---

### Task 2: Collapsible Sidebar

**Files:**
- Modify: `src/components/Sidebar.jsx`

This task rewrites `Sidebar.jsx` entirely. The complete replacement is below — read carefully against the current file before applying.

**Current imports (lines 1–19):**
```js
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Box,
  Collapse,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import {
  CalendarDays,
  Captions,
  LayoutDashboard,
  Settings,
  SquareKanban,
} from "lucide-react";
```

- [ ] **Step 1: Update imports**

Replace the import block with:
```js
import { useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Box,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useLocalStorage } from "@uidotdev/usehooks";
import {
  CalendarDays,
  Captions,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Settings,
  SquareKanban,
} from "lucide-react";
```

- [ ] **Step 2: Add collapsed state after the existing `useState` for `settingsOpen`**

Current lines 55–64 (start of component):
```js
export default function Sidebar({ isAdmin }) {
  const location = useLocation();
  const visibleSettingsChildren = SETTINGS_CHILDREN.filter(
    (c) => !c.requireAdmin || isAdmin,
  );
  const isOnSettingsChild = visibleSettingsChildren.some(
    (c) => c.to === location.pathname,
  );
  // Always default to collapsed; user clicks to expand.
  const [settingsOpen, setSettingsOpen] = useState(false);
```

Replace with:
```js
export default function Sidebar({ isAdmin }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const location = useLocation();
  const visibleSettingsChildren = SETTINGS_CHILDREN.filter(
    (c) => !c.requireAdmin || isAdmin,
  );
  const isOnSettingsChild = visibleSettingsChildren.some(
    (c) => c.to === location.pathname,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Seed collapsed state once at mount. useRef + IIFE reads localStorage
  // synchronously so the default is the correct isMobile value — not a
  // stale snapshot from useLocalStorage's internal useEffect.
  const defaultCollapsed = useRef(
    (() => {
      const stored = localStorage.getItem("vm-sidebar-collapsed");
      return stored === null ? isMobile : JSON.parse(stored);
    })()
  );
  const [collapsed, setCollapsed] = useLocalStorage(
    "vm-sidebar-collapsed",
    defaultCollapsed.current
  );
```

- [ ] **Step 3: Update the outer `Box` to be width-responsive with transition**

Current outer Box `sx` (lines 67–78):
```js
    <Box
      component="nav"
      aria-label="Primary navigation"
      sx={(theme) => ({
        width: theme.sidebar.width,
        flexShrink: 0,
        minHeight: "100vh",
        bgcolor: theme.sidebar.background,
        color: theme.sidebar.color,
        display: "flex",
        flexDirection: "column",
      })}
    >
```

Replace with:
```js
    <Box
      component="nav"
      aria-label="Primary navigation"
      sx={(theme) => ({
        width: collapsed ? theme.sidebar.collapsedWidth : theme.sidebar.width,
        flexShrink: 0,
        minHeight: "100vh",
        bgcolor: theme.sidebar.background,
        color: theme.sidebar.color,
        display: "flex",
        flexDirection: "column",
        // overflow: hidden clips label text during the collapse transition.
        // NOTE: a box-shadow on this element would also be clipped; use
        // filter: drop-shadow() instead if a shadow is ever added.
        overflow: "hidden",
        transition: "width 0.2s ease",
      })}
    >
```

- [ ] **Step 4: Update the header Stack to show chevron toggle**

Current header Stack (lines 80–100):
```js
      <Stack
        sx={(theme) => ({
          height: theme.appBar.height,
          px: 5,
          justifyContent: "center",
          bgcolor: theme.sidebar.header.background,
          color: theme.sidebar.header.color,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        })}
      >
        <Typography
          variant="h6"
          sx={(theme) => ({
            color: theme.sidebar.header.brand,
            fontWeight: 600,
            letterSpacing: 0.2,
          })}
        >
          Vistamar Management
        </Typography>
      </Stack>
```

Replace with:
```js
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={collapsed ? "center" : "space-between"}
        sx={(theme) => ({
          height: theme.appBar.height,
          px: collapsed ? 0 : 5,
          bgcolor: theme.sidebar.header.background,
          color: theme.sidebar.header.color,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        })}
      >
        {!collapsed && (
          <Typography
            variant="h6"
            sx={(theme) => ({
              color: theme.sidebar.header.brand,
              fontWeight: 600,
              letterSpacing: 0.2,
              whiteSpace: "nowrap",
            })}
          >
            Vistamar Management
          </Typography>
        )}
        <IconButton
          onClick={() => setCollapsed((c) => !c)}
          size="small"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          sx={{ color: "rgba(255,255,255,0.6)", "&:hover": { color: "#fff" } }}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </IconButton>
      </Stack>
```

- [ ] **Step 5: Update TOP_LEVEL nav items to hide labels when collapsed**

Current nav item render (lines 103–118):
```js
        {TOP_LEVEL.map(({ to, label, icon: Icon }) => (
          <ListItemButton
            key={to}
            component={NavLink}
            to={to}
            sx={navItemSx}
          >
            <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
              <Icon size={18} strokeWidth={2} />
            </ListItemIcon>
            <ListItemText
              primary={label}
              primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
            />
          </ListItemButton>
        ))}
```

Replace with:
```js
        {TOP_LEVEL.map(({ to, label, icon: Icon }) => (
          <ListItemButton
            key={to}
            component={NavLink}
            to={to}
            onClick={() => collapsed && setCollapsed(false)}
            sx={navItemSx}
          >
            <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
              <Icon size={18} strokeWidth={2} />
            </ListItemIcon>
            {!collapsed && (
              <ListItemText
                primary={label}
                primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
              />
            )}
          </ListItemButton>
        ))}
```

- [ ] **Step 6: Update Settings group click handler and hide label when collapsed**

Current Settings `ListItemButton` (lines 122–139):
```js
        <ListItemButton
          onClick={() => setSettingsOpen((o) => !o)}
          sx={(theme) => ({
            ...navItemSx(theme),
            // Highlight the parent when a child is the current route.
            ...(isOnSettingsChild && {
              color: "#FFFFFF",
            }),
          })}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
            <Settings size={18} strokeWidth={2} />
          </ListItemIcon>
          <ListItemText
            primary="Settings"
            primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
          />
        </ListItemButton>
```

Replace with:
```js
        <ListItemButton
          onClick={() => {
            if (collapsed) {
              // Expand sidebar AND open settings children so the user
              // reaches Settings on a single tap.
              setCollapsed(false);
              setSettingsOpen(true);
            } else {
              setSettingsOpen((o) => !o);
            }
          }}
          sx={(theme) => ({
            ...navItemSx(theme),
            ...(isOnSettingsChild && {
              color: "#FFFFFF",
            }),
          })}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
            <Settings size={18} strokeWidth={2} />
          </ListItemIcon>
          {!collapsed && (
            <ListItemText
              primary="Settings"
              primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
            />
          )}
        </ListItemButton>
```

- [ ] **Step 7: Update Settings children Collapse guard**

Current (line 141):
```js
        <Collapse in={settingsOpen} timeout="auto" unmountOnExit>
```

Replace with:
```js
        <Collapse in={settingsOpen && !collapsed} timeout="auto" unmountOnExit>
```

- [ ] **Step 8: Run tests**

```bash
npx vitest run
```
Expected: 80 passed.

- [ ] **Step 9: Start dev server and verify visually**

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. Check:
- [ ] Desktop: sidebar starts expanded (240px), brand + labels visible, `ChevronLeft` in header
- [ ] Click `ChevronLeft` → sidebar slides to 52px icon-only rail, `ChevronRight` visible
- [ ] Click `ChevronRight` → sidebar expands back, labels reappear
- [ ] Click Settings icon while collapsed → sidebar expands AND Settings children appear
- [ ] Click a nav icon while collapsed → sidebar expands AND navigates
- [ ] Click Settings while expanded → children toggle open/closed as before (regression check)
- [ ] Click Settings while expanded, then collapse, then click Settings icon → sidebar expands AND Settings children are visible immediately
- [ ] Narrow browser window below 600px → sidebar starts collapsed on first visit (clear `localStorage` key `vm-sidebar-collapsed` first to test the default). **Note:** `useMediaQuery` may return `false` on the very first render before resolving the actual viewport; if so, mobile users may see the sidebar briefly expanded before collapsing on a true first visit with no localStorage. This is an accepted `useMediaQuery` browser limitation.
- [ ] Refresh page → collapsed/expanded state is remembered

- [ ] **Step 10: Commit**

```bash
git add src/components/Sidebar.jsx
git commit -m "feat(sidebar): collapsible icon-rail with chevron toggle, mobile-default collapsed"
```
