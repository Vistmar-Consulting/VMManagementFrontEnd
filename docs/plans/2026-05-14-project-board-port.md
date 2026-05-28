# Project Board Port + Firebase Wiring — Implementation Brief

**Author:** Claude (Console session, with Andy)
**Date:** 2026-05-14
**For:** Claude session running in `~/Vistamar_Consulting/VMManagementFrontEnd/`
**Status:** Approved by Andy. Begin work after reading this end-to-end + Q&A pass.

---

## TL;DR

The TaskBoard you currently have at `src/pages/TaskBoard.jsx` is a 158-line Kanban grid. **It's the wrong layout.** Andy spent 30+ hours building a Monday.com-style table in VMConsoleFrontEnd before the spinout. That table is the canonical Project Board he wants here. Every line of it is preserved in `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/`.

Your job:

1. **Port the table** from the archive into Management. ~3100 lines of JSX + helpers across 5 files. Field names translate PascalCase → camelCase. Data layer rewires from Hugo's .NET API + React Query → direct Firestore reads (your existing `useItems` hook) + direct Firestore writes (`addDoc`/`updateDoc`/`deleteDoc`).
2. **Don't delete the Kanban — rename it.** Andy considers it a sidenote/gimmick feature for far-future "alternate view" use. Move `pages/TaskBoard.jsx` → `pages/KanbanBoard.jsx` and `components/ItemCard.jsx` → `components/KanbanCard.jsx`. Mount the Kanban at a secondary route (`/board/kanban`) but **don't link to it in the sidebar** — it's hidden by default.
3. **Do NOT build Mini Project Board.** It's V2. Lives embedded inside Agenda Topic Cards. Agenda doesn't exist yet. Mini Project Board ships when Agenda ships (V2).
4. **Do NOT build Task File Links.** Firebase Storage requires Blaze upgrade — deferred per `dev/DEFERRED.md`. The TaskBoardFileModal component can remain unported until then.
5. **Operational setup:** create a GitHub repo for VMManagementFrontEnd, link a Vercel project to the `dev` branch, push, verify preview deploy. None of those exist yet.

The foundation you've already built (Auth, theme, hooks, security rules, sidebar, layout, Members/Organizations stubs) is **correct and reusable**. Don't rewrite any of it.

---

## Context: Why This Brief Exists

The spec at `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` was written 2026-05-12 during the PM spinout. Section 6 of that spec said "components reused (ported, not copied wholesale): TaskBoardRow, TaskBoardColumnHeader, TaskBoardModal, TaskBoardFileModal." That phrase was too loose. It didn't say **"the Project Board is a TABLE, not a Kanban."** You read "Project Board" → defaulted to the LLM-common interpretation (Trello/Kanban columns). That gap is on the spec writer (me), not you.

This brief closes the gap. It is authoritative over the spec's section 6 phrasing where they conflict.

---

## Sources of Truth — Read These Before Coding

1. **Spec (canonical for V1+V2+V3 architecture):**
   `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`

2. **Archive — the actual Console code, frozen verbatim:**
   `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/`
   - `src/pages/pages/TaskBoard.jsx` (1094 lines) — the `<Table>`-based main board
   - `src/pages/pages/TaskBoardRow.jsx` (1069 lines) — per-item `<TableRow>` with inline editing
   - `src/pages/pages/TaskBoardColumnHeader.jsx` (308 lines) — sortable/filterable column headers
   - `src/pages/pages/TaskBoardModal.jsx` (426 lines) — item detail dialog
   - `src/pages/pages/TaskBoardFileModal.jsx` (171 lines) — file attachment dialog **[V2 — Storage deferred]**
   - `src/pages/pages/pmItems.js` (592 lines) — items shape, reducer, mock data, status/priority enums
   - `src/pages/pages/pmPillColors.js` (24 lines) — pastel pill palette utilities
   - `src/pages/pages/PmAvatar.jsx` — member avatar (overlapping multi-assignee support)
   - `src/pages/pages/pmMembers.js` (144 lines) — members seed + avatar colors
   - `src/hooks/usePmStore.js` (212 lines) — localStorage-backed shared store (old API)
   - `src/hooks/usePmBoardActions.js` (298 lines) — action layer: updateItem, addItem, addSubitem, deleteItem, updateMembers, updateTags, addComment, etc.
   - `src/hooks/usePmApi.js` — Hugo .NET API + React Query layer (**discard — does not apply here**)
   - `src/utils/pmFieldMap.js` — PascalCase ↔ camelCase translator (the principle survives even though we won't reuse the file)

3. **Feature memory — the *why* behind every design decision in the archive:**
   `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/feature_memory/`
   - `Project_Board.md` (169 lines) — full evolution: pills, multi-assignee, comments, archive group, tags, status scorecards
   - `Pastel_Pill_System.md` — `getPillBg` (lighten 72%) + `getTextColor` (darken 45%) formula
   - `Avatar_Color_System.md` — 12-color muted palette + assignment rules
   - `Mini_Project_Board.md` — **READ but DON'T BUILD now — V2 only**
   - `Threaded_Comments.md` — 4-store comment model (item/subitem × top-level/reply)
   - `Task_File_Links.md` — file dialog behavior **[V2 — Storage deferred]**
   - `Topic_Cards.md` — agenda topic cards (V2 context)

**Read order recommendation:** spec section 4 (data model) + section 6 (UI surface) → this brief → `feature_memory/Project_Board.md` → `archive/src/pages/pages/TaskBoard.jsx` end-to-end → `archive/src/pages/pages/TaskBoardRow.jsx` end-to-end. Then start the port.

---

## State of the Repo Right Now

### What's already built (KEEP — do not rewrite)

| Path | Lines | Purpose | Verdict |
|---|---:|---|---|
| `src/firebase.js` | ~35 | Web SDK init, hosted-domain pinned to `vistamarconsulting.com` | ✓ |
| `src/contexts/AuthContext.jsx` | ~150 | Google SSO + client-side `users/{uid}` bootstrap (role, active, avatarColor) + live `onSnapshot` for role changes | ✓ |
| `src/hooks/useCollection.js` | 52 | `onSnapshot` wrapper, returns `{data, loading, error}`, `EMPTY_CONSTRAINTS` to avoid re-subscribes | ✓ |
| `src/hooks/useDoc.js` | ~50 | Single-doc subscription | ✓ |
| `src/hooks/useItems.js` | 16 | `useCollection("items", orderBy("order","asc"))` | ✓ |
| `src/routes.jsx` | 52 | React Router v6 with `<ProtectedRoute requireAdmin>` admin gate | ✓ |
| `src/components/Sidebar.jsx`, `AppTopBar.jsx`, `ProtectedRoute.jsx` | — | Shell | ✓ |
| `src/layouts/SignedInLayout.jsx` | — | Authenticated shell | ✓ |
| `src/theme/*` (palette, typography, components, breakpoints, shadows) | — | MUI theme port | ✓ |
| `src/constants/itemStatuses.js` | 31 | STATUS enum (1=Assigned, 2=In Progress, 4=Review, 5=Done, 7=Archive) matches Console's `pm.Statuses` | ✓ |
| `src/seed/sampleItems.js` | 76 | 11 idempotent samples with `_seedMarker`, uses `fractional-indexing` | ✓ |
| `src/pages/{Members, Organizations, Settings, Profile, Dashboard}.jsx` | — | Stubs only — explicitly say "lands in a later V1 slice" | ✓ (stubs OK) |
| `firestore.rules` | — | Deployed, V1 ruleset per spec §5 | ✓ |
| `firebase.json`, `.firebaserc`, `firestore.indexes.json`, `storage.rules` | — | Firebase config | ✓ |

### What's wrong (RENAME, not delete)

| Path | Lines | Current verdict |
|---|---:|---|
| `src/pages/TaskBoard.jsx` | 158 | Kanban grid — **rename to `src/pages/KanbanBoard.jsx`** |
| `src/components/ItemCard.jsx` | 103 | Kanban card — **rename to `src/components/KanbanCard.jsx`** |

### Firestore state right now

- `organizations/vistamar` — `name: 'Vistamar Consulting'`, `accentColor: '#2c5f7c'`, `type: 'internal'`, `active: true`
- `users/P63r1qyS0vOQ4BovyRit6EwI5sk2` — Andy's doc, `role: 'admin'`, `active: true`, `avatarColor: '#ffaaa5'`
- `items/*` — 11 sample items (all `parentId: null`, `organizationId: 'vistamar'`), status distribution: Assigned ×3 / In Progress ×3 / Review ×2 / Done ×3

**The data shape is already correct.** Your `seed/sampleItems.js` writes camelCase fields (`title`, `statusId`, `parentId`, `hasChildren`, `type`, `organizationId`, `assigneeId`, `dueDate`, `onHold`, `order`, `createdBy`, `createdAt`, `updatedAt`). The port just needs to point the new components at this shape.

---

## The Kanban Decision: Rename, Keep, Hide

Andy's direct words: *"don't delete KanBan boards. But that is a sidenote, gimmick feature that users can use, but way down the line after we've created the fully functional task list."*

**Implementation:**

1. Rename files:
   - `src/pages/TaskBoard.jsx` → `src/pages/KanbanBoard.jsx`
   - `src/components/ItemCard.jsx` → `src/components/KanbanCard.jsx`
   - Update internal imports in `KanbanBoard.jsx` to reference `./KanbanCard.jsx`

2. Add the Kanban route at `/board/kanban` in `src/routes.jsx`:
   ```jsx
   <Route path="/board/kanban" element={<KanbanBoard />} />
   ```

3. **Do NOT add it to the sidebar.** It's reachable only by typing the URL. Far-future, when Andy wants to surface alternate views, the sidebar can grow a "View" toggle. For now, the Kanban is dormant.

4. Mount the new **table-based Project Board** at `/board` (the existing primary route).

Why preserve the Kanban code: it's already wired to the same `useItems()` data layer the table port will use. If Andy ever wants to put a "View: Table | Kanban" toggle on the board page, the Kanban surface is ready. Costs nothing to keep.

---

## V1 Scope — What to Build Now

| Feature | Where it lives | Notes |
|---|---|---|
| **Project Board (table)** | `src/pages/TaskBoard.jsx` (new) | Replaces Kanban at `/board`. Port from archive. |
| **TaskBoardRow** | `src/components/TaskBoardRow.jsx` | Per-item row with inline editing |
| **TaskBoardColumnHeader** | `src/components/TaskBoardColumnHeader.jsx` | Sortable/filterable column headers |
| **TaskBoardModal** | `src/components/TaskBoardModal.jsx` | Item detail dialog with threaded comments |
| **MemberAvatar** | `src/components/MemberAvatar.jsx` | Renamed from `PmAvatar`; supports single + multi (overlapping) |
| **Pill colors** | `src/theme/pillColors.js` | Port `pmPillColors.js` verbatim |
| **Organization filter chip group** | top of TaskBoard | "All / Vistamar / per-client" — `useLocalStorage` persisted |
| **Drag-and-drop reorder** | TaskBoardRow + TaskBoard | Use `react-beautiful-dnd` (already in `package.json`). Recompute `order` via `fractional-indexing` `generateKeyBetween`. |
| **Subitem expand/collapse** | TaskBoardRow | Chevron, indented children rows |
| **Inline title editing** | TaskBoardRow | Click → input → blur/Enter saves, Escape cancels |
| **Status/Priority pill dropdowns** | TaskBoardRow | MUI Menu, pastel bg via `getPillBg`, text via `getTextColor` |
| **Multi-assignee avatars** | TaskBoardRow | Overlapping circles, dropdown with checkmarks |
| **Due-date inline picker** | TaskBoardRow | Hidden DatePicker triggered by click on text |
| **Active / Completed / Archive groups** | TaskBoard | Tinted header bars, expand/collapse, count |
| **Status scorecards** | TaskBoard header | 7 KPIs: Assigned, In Progress, Review, On Hold, Done, Overdue, Due This Wk. Clickable filter. |
| **Threaded comments** | TaskBoardModal + `items/{id}/comments` subcollection | Author-only edit, reply nesting (1 level deep) |
| **Action menu** | TaskBoardRow | Vertical ellipsis, "Delete" option (later: Archive, Move to org) |
| **"+ New Item" / "+ Add subitem"** | TaskBoard / TaskBoardRow | Creates blank row with grey "—" pills, auto-focus title input |

### V1 status lifecycle (already in `constants/itemStatuses.js`)

- 1 = Assigned (default for new items)
- 2 = In Progress
- 4 = Review
- 5 = Done
- 7 = Archive (hidden behind toggle)
- 3 = On Hold — represented as `onHold: boolean` flag, NOT a status
- 6 = Pending, 8 = AI Gen — dropped from V1 surface

### V1 priority enum (add to `constants/itemPriorities.js`)

Port from archive's `pmItems.js`. Pastel pill colors match status pattern. Status_Id and Priority_Id reuse the SQL numeric ID convention so eventual SQL→Firestore migration is a direct numeric copy.

---

## V2 Scope — Do NOT Build Now

| Feature | Why deferred |
|---|---|
| **Mini Project Board** | Embedded inside Agenda Topic Cards. Agenda doesn't exist until V2. Per spec section 2: "V2 — Meetings + Agendas." |
| **Meeting Agendas / Calendar Series / Topics / Attendees** | V2. Backend ports `api/meetings/*` to Firebase Functions (requires Blaze upgrade). |
| **Cloud Functions for meeting scheduler** | V2. Blaze upgrade required. |
| **Tate's recurring meetings migration** | V2 cutover. |
| **`functions/scripts/migrate-from-sql.js`** | Not needed for fresh-start V1. May run later if Andy wants Console's pm.* data imported. |

---

## V3 / Deferred (Don't Build Until Decided)

| Feature | Status |
|---|---|
| **Task File Links** (Firebase Storage) | Deferred per `dev/DEFERRED.md`. Storage was reclassified Blaze-only in late 2025; not worth billing exposure for V1. `TaskBoardFileModal.jsx` from archive remains unported until Blaze. |
| **Migration script from SQL** | V1 ships fresh-start. If Andy wants pm.* import later, write the script then. |
| **Cloud-Function auth-onCreate trigger** | V1 uses client-side bootstrap in `AuthContext`. Replace with Cloud Function on Blaze upgrade. |
| **AI Gen items (Status_Id 8)** | Out of V1. AI agenda drafting is V3 sketch territory. |

---

## The Port — File by File

### 1. `src/theme/pillColors.js` (NEW — port verbatim from archive)

**Source:** `archive/src/pages/pages/pmPillColors.js` (24 lines)
**Target:** `src/theme/pillColors.js`
**Changes:** None. Copy verbatim. Exports `getPillBg(hex)` (lightens 72%) and `getTextColor(hex)` (darkens 45%). Used everywhere a status/priority/category pill renders.

### 2. `src/constants/itemPriorities.js` (NEW)

**Source:** archive `pmItems.js` priority constants
**Target:** `src/constants/itemPriorities.js`
**Shape:**
```js
export const PRIORITY = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
};
export const PRIORITY_LABEL = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };
export const PRIORITY_COLOR = {
  1: "#90caf9",  // light blue
  2: "#fff59d",  // light yellow
  3: "#ffab91",  // light orange
  4: "#ef9a9a",  // light red
};
```
(Verify exact colors against archive `pmItems.js` — port whatever values are there.)

### 3. `src/components/MemberAvatar.jsx` (NEW — port + rename from `PmAvatar`)

**Source:** `archive/src/pages/pages/PmAvatar.jsx`
**Target:** `src/components/MemberAvatar.jsx`
**Changes:**
- Rename component `PmAvatar` → `MemberAvatar`
- Field references: `member.Member_Name` → `member.displayName` (or `firstName + lastName`); `member.Avatar_Color` → `user.avatarColor`
- Accepts `members={[]}` array for multi-assignee overlapping render (port the +N overflow chip)
- Single-assignee fallback: pass `members={[user]}` (array of 1)

### 4. `src/components/TaskBoardModal.jsx` (NEW — port)

**Source:** `archive/src/pages/pages/TaskBoardModal.jsx` (426 lines)
**Target:** `src/components/TaskBoardModal.jsx`
**Changes:**
- Field name translation (see Field Mapping below)
- Threaded comments: rewire to Firestore subcollection `items/{id}/comments` (and `items/{id}/comments/{commentId}/replies` if you keep the 4-store model — see below)
- File attachments: comment out / TODO the file dialog hook (Storage deferred). Keep the modal otherwise intact.

**Comments model decision:** archive used 4 localStorage stores (Item_Comments, Item_Subcomments, Subitem_Comments, Subitem_Subcomments) to mirror the SQL tables. **In Firestore, simplify to 1 subcollection with a `parentCommentId: string | null` field for reply nesting.** Path: `items/{itemId}/comments/{commentId}` with fields `{ authorId, body, parentCommentId, createdAt }`. The 4-store model was a SQL artifact; Firestore subcollections + a parentCommentId field is the natural shape.

### 5. `src/components/TaskBoardColumnHeader.jsx` (NEW — port)

**Source:** `archive/src/pages/pages/TaskBoardColumnHeader.jsx` (308 lines)
**Target:** `src/components/TaskBoardColumnHeader.jsx`
**Changes:**
- Field name translation
- Sort/filter state lives in TaskBoard (lifted state) — no API call to persist sort prefs server-side in V1 (use `useLocalStorage`)
- Search input: client-side filter via `useMemo` over `items.filter(...)`

### 6. `src/components/TaskBoardRow.jsx` (NEW — port, largest file)

**Source:** `archive/src/pages/pages/TaskBoardRow.jsx` (1069 lines)
**Target:** `src/components/TaskBoardRow.jsx`
**Changes:**
- Field name translation EVERYWHERE
- Rip out `usePmBoardActions` action calls. Replace with direct Firestore writes via callback props passed from parent TaskBoard:
  - `onUpdate(itemId, patch)` → `updateDoc(doc(db, "items", itemId), patch)`
  - `onDelete(itemId)` → `deleteDoc(doc(db, "items", itemId))`
  - `onAddSubitem(parentId)` → `addDoc(collection(db, "items"), { parentId, ... })`
- Drag handle: react-beautiful-dnd `<Draggable>` wrapper
- Inline editing patterns survive verbatim (`useState` for local edit value, `useEffect` to sync from props, `onBlur` writes)
- Member assignment dropdown: anchor pattern from archive (use `anchorPosition` not `anchorEl` per the 2026-04-09 bug fix noted in `feature_memory/Mini_Project_Board.md`)
- Priority/Status pill dropdowns: MUI `<Menu>` with pastel bg via `getPillBg`

### 7. `src/pages/TaskBoard.jsx` (NEW — port)

**Source:** `archive/src/pages/pages/TaskBoard.jsx` (1094 lines)
**Target:** `src/pages/TaskBoard.jsx` (replaces the Kanban file you'll rename to `KanbanBoard.jsx`)
**Changes:**
- Field name translation
- Data fetch: replace localStorage / React Query calls with your existing `useItems()` hook
- Drag-end handler: compute new `order` via `generateKeyBetween(prevOrder, nextOrder)` from `fractional-indexing`, write via `updateDoc`
- Org filter chip group: lives at the top of the board. State via `useLocalStorage('vm-board-org-filter', 'all')`. Filters `items` client-side via `useMemo`.
- Group rendering: Active (default expanded), Completed (default collapsed, auto-expands on Done transition), Archive (default collapsed, only renders when items exist)
- Status scorecards: 7 KPIs computed in `useMemo` from items. Clickable → sets a status filter, single-toggle.
- Subitem expand/collapse: pass `expandedItemIds` Set down to rows, toggle via callback

---

## Field Mapping Reference (PascalCase → camelCase)

The archive uses SQL-shaped PascalCase. Firestore uses camelCase per `CLAUDE.md` "Cross-Stack Naming Parity." Translate at every read/write site.

| Archive (SQL/PascalCase) | Management (Firestore/camelCase) | Notes |
|---|---|---|
| `Item_Id` | `id` | Firestore doc ID |
| `Item_Title` | `title` | |
| `Item_Description` | `description` | |
| `Status_Id` | `statusId` | Numeric, 1–7 |
| `Priority_Id` | `priorityId` | Numeric, 1–4 |
| `Parent_Item_Id` | `parentId` | `null` for top-level |
| `Org_Id` | `organizationId` | String slug (`'vistamar'`, `'total-vision'`) |
| `Due_Date` | `dueDate` | Firestore `Timestamp` |
| `Assigned_Member_Ids` (array) | `assigneeIds` (array) | **NOTE: spec said `assigneeId` singular — change to plural array to match Console multi-assignee parity. Update the spec doc accordingly.** |
| `Member_Id` / `User_Id` | `uid` | Matches `users/{uid}` doc ID |
| `Avatar_Color` | `avatarColor` | On `users/{uid}` |
| `Member_Name` | `displayName` (or `firstName + lastName`) | On `users/{uid}` |
| `Org_Name` | `name` | On `organizations/{slug}` |
| `Accent_Color` | `accentColor` | On `organizations/{slug}` |
| `Created_At` / `Updated_At` | `createdAt` / `updatedAt` | `serverTimestamp()` |
| `Created_By` | `createdBy` | UID |
| `Order` | `order` | Fractional rank string (e.g. `"a0"`, `"a1"`) |
| `Tag_Ids` (array) | `tagIds` (array) | If tags ship in V1 — check with Andy |
| `Category_Id` / `Category_Ids` | (skip in V1) | Categories are an Agenda-side concept (V2). For V1 the org tag IS the grouping. |
| `Has_Children` (computed) | `hasChildren` (denormalized) | Maintained by a `onWrite` Cloud Function trigger when Blaze upgrades; for V1 maintain client-side at write time. |
| `Comments` (embedded array) | `items/{id}/comments` (subcollection) | Simplified from 4-store SQL model |
| `Comment_Text` | `body` | |
| `Comment_Author_Member_Id` | `authorId` | UID |
| `Parent_Comment_Id` | `parentCommentId` | For reply nesting |

**Important:** the spec section 4 said `assigneeId: uid | null` (singular). That's wrong for Console parity. Andy's Console board has multi-assignee with overlapping avatars. **Update the spec to `assigneeIds: uid[]`** when you do the port. Note the change in `dev/sessions/.../context.md`.

---

## Data Layer Rewiring

Archive's data layer (Hugo's API + React Query + localStorage) → Management's data layer (Firestore listeners + direct writes).

### Reads — already done, just use the hooks

```jsx
// V1 read pattern — already in place via your useItems hook:
const { data: allItems, loading, error } = useItems();
const { data: orgs } = useCollection("organizations");
const { data: users } = useCollection("users");

// Client-side filters:
const orgFilter = useLocalStorage("vm-board-org-filter", "all");
const visibleItems = useMemo(
  () => allItems.filter((item) =>
    orgFilter === "all" || item.organizationId === orgFilter
  ),
  [allItems, orgFilter]
);
```

### Writes — direct Firestore, no action helper layer

```jsx
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";

// Inline title edit:
await updateDoc(doc(db, "items", itemId), {
  title: newTitle,
  updatedAt: serverTimestamp(),
});

// Status change via pill dropdown:
await updateDoc(doc(db, "items", itemId), {
  statusId: newStatusId,
  updatedAt: serverTimestamp(),
});

// Add subitem:
const newOrder = generateKeyBetween(lastSubitemOrder, null);
await addDoc(collection(db, "items"), {
  organizationId: parentItem.organizationId,
  parentId: parentItem.id,
  hasChildren: false,
  type: "task",
  title: "",
  statusId: STATUS.ASSIGNED,
  priorityId: null,
  onHold: false,
  dueDate: null,
  assigneeIds: [],
  createdBy: user.uid,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  order: newOrder,
});
// Also flip parent's hasChildren if it was false:
if (!parentItem.hasChildren) {
  await updateDoc(doc(db, "items", parentItem.id), { hasChildren: true });
}

// Add top-level comment:
await addDoc(collection(db, "items", itemId, "comments"), {
  authorId: user.uid,
  body: text,
  parentCommentId: null,
  createdAt: serverTimestamp(),
});

// Reply:
await addDoc(collection(db, "items", itemId, "comments"), {
  authorId: user.uid,
  body: text,
  parentCommentId: parentCommentId,
  createdAt: serverTimestamp(),
});

// Drag-end reorder:
const newOrder = generateKeyBetween(prevItem?.order ?? null, nextItem?.order ?? null);
await updateDoc(doc(db, "items", draggedItemId), {
  order: newOrder,
  ...(targetStatusId !== draggedItem.statusId && { statusId: targetStatusId }),
});

// Delete (with optimistic remove from local + Firestore propagation via listener):
await deleteDoc(doc(db, "items", itemId));
// Also flip parent's hasChildren if this was its last subitem.
```

### Optimistic UI

Firestore's local cache + `onSnapshot` already provides optimistic updates — writes appear in the listener stream before the server roundtrip completes. **Don't manually maintain a separate optimistic state layer.** Just write to Firestore and let the listener flow drive the UI.

---

## Behavior Parity Checklist

When the port is "done," every box below must check off. Verify in Playwright against the archive screenshots in `dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/` (current Kanban) AND the original Console screenshots (look at the `_PM_Archive_From_Console_2026-05-12/dev/feature_memory/Project_Board.md` history section).

### Layout
- [ ] Page is a `<TableContainer>` + `<Table sx={{ tableLayout: "fixed" }}>`, NOT a Kanban grid
- [ ] Active group renders first, default expanded
- [ ] Completed group second, default collapsed (auto-expands when item moves to Done)
- [ ] Archive group third, default collapsed, only renders if archived items exist
- [ ] Group headers: tinted bar (5% opacity bg, 3px left border, colored text), expand chevron, count
- [ ] Status scorecards row at top: 7 KPIs (Assigned, In Progress, Review, On Hold, Done, Overdue, Due This Wk). Clickable. Single-select toggle.
- [ ] Organization filter chip group: "All / Vistamar / per-client", `useLocalStorage` persisted

### Row (per-item)
- [ ] Expand chevron (collapsed by default; hover-to-show on empty parents)
- [ ] Indented subitems when parent expanded
- [ ] Inline title editing (click → input → blur/Enter saves)
- [ ] Priority pill dropdown (pastel bg, `<Menu>` with options)
- [ ] Status pill dropdown (pastel bg, `<Menu>` with options)
- [ ] Multi-select assignee avatars (overlapping circles, +N overflow chip, dropdown with checkmarks, `anchorPosition` not `anchorEl`)
- [ ] Due date column: text only, hover underlines, click opens hidden DatePicker
- [ ] Comments column: faded icon (empty) / solid icon with copper count badge (has comments)
- [ ] Action menu: vertical ellipsis last column, appears on row hover, "Delete" option

### Modal (item detail)
- [ ] Opens on row click (not action menu — that's just delete)
- [ ] Title, description, status, priority, assignees, due date all editable
- [ ] Threaded comments: avatar + name + relative timestamp + body
- [ ] Reply nesting (1 level deep)
- [ ] Author-only edit/delete on own comments
- [ ] New comment input at bottom, Enter to send, Shift+Enter for newline

### Drag and Drop
- [ ] Drag row to reorder within status
- [ ] Drag row to a different group (status change)
- [ ] Fractional rank update via `generateKeyBetween`
- [ ] Visual placeholder while dragging
- [ ] Touch + mouse both work

### Empty + Loading States
- [ ] Loading: subtle "Loading..." caption (not a giant spinner)
- [ ] Empty: "No items" italic caption per group
- [ ] Brand-new item: blank title in edit mode with autoFocus

### Real-time
- [ ] Open two browser tabs, edit a title in one → other tab updates within ~1s
- [ ] Move a card via drag → other tab moves it
- [ ] Add a comment → other tab sees it appear

### Org Tag Behavior
- [ ] Every item carries `organizationId`
- [ ] New item inherits the currently selected org filter (if not "All")
- [ ] Org chip in each row matches the item's organizationId, colored via `org.accentColor`

### Kanban Compatibility
- [ ] Old Kanban at `/board/kanban` still renders the same items (same `useItems` data source)
- [ ] Not linked from sidebar — URL-only access

---

## Operational Setup — Do These BEFORE Starting Code

### 1. GitHub repo (does NOT exist yet)

```bash
cd /Users/andrewdeemer/Vistamar_Consulting/VMManagementFrontEnd

# Verify no remote yet (should print nothing)
git remote -v

# Create the repo on GitHub. Two paths:
#   A. gh CLI (preferred if Andy has it auth'd):
gh repo create Vistmar-Consulting/VMManagementFrontEnd \
  --private --source=. --remote=origin \
  --description="Vistamar Management — Project Board, Meetings, Agendas (Firebase-native)"

#   B. Manual: create at github.com/Vistmar-Consulting/VMManagementFrontEnd, then:
git remote add origin git@github.com:Vistmar-Consulting/VMManagementFrontEnd.git
```

**Important:** Confirm the org name with Andy before creating. Console's existing repo is at `github.com/Vistmar-Consulting/VMConsoleFrontEnd` (note the typo: `Vistmar` not `Vistamar` — preserve the typo to match Console's org).

### 2. Push current `main` → `dev`

```bash
# We've been working on `main` locally. Per the push workflow memory,
# remote target is `dev` always. Push `main` content as `dev`:
git push -u origin main:dev

# Verify:
git fetch origin
git branch -r          # should show origin/dev
```

### 3. Vercel project (does NOT exist yet)

```bash
# Login if needed
npx vercel login

# Link this repo to a new Vercel project
npx vercel link

# Configure deployment to use the `dev` branch
# When prompted, accept defaults except:
#   - Production Branch: dev
#   - Framework: Vite (auto-detected)
#   - Root Directory: ./

# Push env vars (Firebase config from .env.local — all are PUBLIC by design, fine to set):
npx vercel env add VITE_FIREBASE_API_KEY production
npx vercel env add VITE_FIREBASE_AUTH_DOMAIN production
npx vercel env add VITE_FIREBASE_PROJECT_ID production
npx vercel env add VITE_FIREBASE_STORAGE_BUCKET production
npx vercel env add VITE_FIREBASE_MESSAGING_SENDER_ID production
npx vercel env add VITE_FIREBASE_APP_ID production
# (also for `preview` env if you want previews to work)

# Trigger first deploy:
npx vercel deploy --prod
```

After this, every `git push origin dev` triggers a preview deploy. Confirm the first preview URL renders the signed-in shell.

### 4. Add the production URL to Firebase Auth's authorized domains

Firebase console → Authentication → Settings → Authorized domains → add `<your-vercel-prod-domain>.vercel.app`. Otherwise Google sign-in will fail with `auth/unauthorized-domain` on the deployed site.

### 5. Confirm push workflow

After steps 1–4 are done, the workflow is:
- Work on local `main` branch
- Commit normally
- `git push origin main:dev` to deploy
- Never push `main`/`stage` on the remote directly

---

## Verification Gate (Before Declaring "Done")

UI verification hard gate per `feedback_self_verify_ui_before_asking.md` memory: **drive the browser yourself before asking Andy to verify.**

1. **`npm run dev` boots cleanly** — no console errors related to the new files
2. **Sign in as Andy via Playwright** — use his existing browser session (it's already authenticated)
3. **Navigate to `/board`** — table renders, not Kanban
4. **All 11 seed items render** — in the correct status groups
5. **Inline-edit a title** → blur → reload page → title persists
6. **Change a status pill** → row moves to new group
7. **Drag a row** within a group → order persists on reload
8. **Drag a row** across groups → status updates AND order updates
9. **Add a subitem** → indents under parent → parent's `hasChildren` flips to true
10. **Add a top-level comment** → appears in modal + count badge appears on row
11. **Reply to a comment** → indents under parent comment
12. **Org filter chip** → only Vistamar items render → switch to "All" → all render
13. **Status scorecard click** → board filters to that status
14. **Navigate to `/board/kanban`** → old Kanban still works, same data
15. **Take screenshot at each major checkpoint**, save to `dev/sessions/.../slice-X-name.png`
16. **Two-tab real-time check** — open `/board` in tab A and tab B, edit in A, confirm B updates within 1s

Only after all 16 boxes check, write the slice summary in `dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/context.md` and ask Andy to do final acceptance.

---

## Open Questions to Confirm with Andy Before Coding

1. **Tags column** — was present in archive Console (added 2026-04-06 per `Project_Board.md`). Include in V1 port or defer? Default recommendation: **defer** (tags require a separate `tags` collection; simpler V1 ships without).
2. **Categories column** — agenda-side concept. Defer to V2 alongside Agenda. Confirm.
3. **Owner column** — distinct from Assignees in Console. Per `feature_memory/Project_Board.md`: "Owner_Member_Id → Assigned_Member_Ids (array)" was a refactor. So Owner went away in Console and was replaced by multi-assignee. Confirm Management V1 follows that pattern (no separate Owner field).
4. **Priority defaults** — new items default to which priority? Recommendation: `null` (grey "—" pill), matches archive's "blank row" pattern.
5. **Multi-assignee maximum** — overlapping avatars get visually cramped beyond ~4. Cap visible at 3 + "+N" chip per archive pattern. Confirm.
6. **Comments author-only edit** — confirm. Spec §5 said author-only on comments; archive had no such guard. **Recommend author-only** for V1 (matches Firestore rule already in place).
7. **Drag-and-drop library** — *originally* `react-beautiful-dnd` for archive parity. Swapped to `@hello-pangea/dnd` post-port (2026-05-27 code review) because Atlassian archived the original in 2022 and it warns under React 18 StrictMode. API is a drop-in fork.

---

## What NOT to Do

- ❌ Don't delete the Kanban code. Rename it. Andy explicitly wants it kept.
- ❌ Don't build Mini Project Board. It's V2.
- ❌ Don't build Task File Links. Storage is deferred.
- ❌ Don't introduce a separate state-management layer (Redux, Zustand, etc.). Firestore + React state is sufficient and matches the spec.
- ❌ Don't add a Cloud Function for `hasChildren` maintenance — V1 maintains it client-side at write time. Cloud Function lands at Blaze upgrade.
- ❌ Don't try to "modernize" the table layout into something else. Andy spent 30+ hours on it. Port it faithfully.
- ❌ Don't refactor `useCollection` / `useDoc` / `useItems`. They work. Build on them.
- ❌ Don't add server-side composite indexes preemptively. Spec says client-side filter for V1 (< 500 items). Add indexes only when a query genuinely needs one.
- ❌ Don't push directly to `origin/main` or `origin/stage`. Push target is `origin/dev` always.
- ❌ Don't skip the UI verification gate. Drive the browser yourself first.

---

## After the Port — Update the Spec

When the port is merged, update the spec doc at `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`:

1. **Section 4 data model:** change `assigneeId: uid | null` → `assigneeIds: uid[]`. Note the multi-assignee model.
2. **Section 6 "Components reused":** explicitly state "Project Board is a Monday.com-style TABLE, not a Kanban. The Kanban surface is kept at `/board/kanban` as a far-future alternate view."
3. **Section 6 add:** Status Scorecards bar, Organization filter chip group, Active/Completed/Archive group rendering pattern.

These spec updates close the gap that allowed the original misinterpretation.

---

## Appendix: Quick Sanity Checks for the Other Claude

Before starting the port, prove you've actually read the archive:

1. **Question:** How many columns does the Console TaskBoard render?
   **Answer:** 14 (verify by reading `archive/src/pages/pages/TaskBoard.jsx` for the `colSpan={14}` usage)

2. **Question:** Which subcollection model do you use for threaded comments?
   **Answer:** Single `items/{id}/comments` subcollection with a `parentCommentId: string | null` field (simplified from archive's 4-store SQL model)

3. **Question:** What library generates the `order` field for drag-reorder?
   **Answer:** `fractional-indexing` `generateKeyBetween(prev, next)` — already a dep in `package.json`

4. **Question:** What field replaced `Owner_Member_Id` in Console?
   **Answer:** `Assigned_Member_Ids` array (multi-assignee). In Management it's `assigneeIds`.

5. **Question:** Where does the Kanban code live after the port?
   **Answer:** `src/pages/KanbanBoard.jsx` + `src/components/KanbanCard.jsx`, mounted at `/board/kanban`, NOT linked in sidebar.

If you can't answer all five from memory after reading the archive, read it again before coding.

---

*End of brief.*
