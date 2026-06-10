# Spec: New Item Org Picker

**Date:** 2026-06-10  
**Feature:** Always-available "New item" button with org picker modal  
**Status:** Approved

---

## Problem

The "New item" button on the Project Board is disabled when the org filter is set to "All", with a tooltip telling the user to pick an org chip first. This is friction — admins who are reviewing the full board shouldn't have to change their view just to create an item.

---

## Behaviour

### Button

- "New item" button is **never disabled** for admins (remove `orgFilter === "all"` disable gate).
- Clicking always opens the org picker modal, regardless of current `orgFilter` state.
- The `isAdmin` gate is preserved — non-admins still cannot create items.

### Org Picker Modal

- Small `Dialog` (no fullscreen, no scroll needed — org count is small).
- Title: **"Create item for…"**
- Body: one `Button` per org, sorted by `org.sortOrder` (ascending; missing sortOrder falls to end).
- Each button styled with the org's `accentColor` background (white or dark contrast text, same `getContrastText` logic used on the board chips). Width: full-width of the dialog content area.
- If `orgFilter` is already set to a specific org when the modal opens, that org's button is visually pre-selected (e.g. filled/contained variant; others outlined). "All" state → no pre-selection.
- Single tap on an org button:
  1. Sets `orgFilter` to that org's id (board scopes to that org after close).
  2. Calls `handleAddItem(orgId)` (creates blank item).
  3. Closes the modal.
- "Cancel" / dismiss (backdrop click or Escape) closes without creating anything; `orgFilter` unchanged.

### `handleAddItem` signature change

```js
// Before
const handleAddItem = async () => { ... }

// After
const handleAddItem = async (orgId) => { ... }
```

- `orgId` is the Firestore organization doc id (e.g. `"total-vision"`).
- The function uses `orgId` directly — no longer reads `orgFilter` state.
- Remove the `if (orgFilter === "all") throw ...` guard; the modal guarantees a valid org is always passed.
- All Firestore writes (item doc + `nextItemNumber` increment on org doc) are unchanged.

---

## Scope

- **Only `src/pages/TaskBoard.jsx`** — no other files change.
- Subitem creation (`handleAddSubitem`) is unchanged — subitems always inherit their parent's org.
- KanbanBoard has no "New item" button; no change needed.
- Tooltip on the button is removed (it was the disabled-state hint; no longer needed).

---

## Data / State

| What | How |
|---|---|
| Modal open/close | Local `useState` boolean `orgPickerOpen` |
| Org list | Already loaded: `useCollection("organizations")` |
| Org sort | `[...orgs].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))` — same pattern used for the board chips |
| Pre-selection | `orgFilter !== "all"` → highlight matching org button |
| orgFilter sync | `setOrgFilter(orgId)` called alongside create, so board view stays consistent with the newly created item |

---

## Out of Scope

- No title or description field in the modal — item is created blank (same as today).
- No "create for all orgs" option — every item must have exactly one org.
- No changes to KanbanBoard, MiniProjectBoard, or AgendaDetail.
