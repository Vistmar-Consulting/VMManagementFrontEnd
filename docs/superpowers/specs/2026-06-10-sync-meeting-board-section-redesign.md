# Sync Meeting — Board Section Redesign

**Date:** 2026-06-10
**Status:** Approved
**Scope:** `SyncMeetingDialog` review step — board changes section only

---

## 1. Problem

The board-changes section in the Sync Meeting review step uses MUI form controls (TextFields, Selects) that feel foreign compared to every other part of the app. Category and tags on proposed creates are not editable at all. The goal is a single consistent look-and-feel: proposed creates render like MiniProjectBoard rows, with all fields interactive.

---

## 2. Approved Design

### 2.1 Creates → "New Items" group

Replaces the flat form-field list. Uses a MiniProjectBoard-style blue group header (`NEW ITEMS (N)`). Each proposed create renders as a `ProposedBoardRow`:

**Row 1 — main line:**
`[checkbox]  [title — inline editable]  [status pill ▾]  [assignee avatar(s)]  [parent badge if subitem]`

**Row 2 — metadata line (indented to title):**
`[category pill]  ·  [● tag1]  [● tag2]  ...`

**Row 3 — AI note (indented to title):**
`dimmed italic text — always visible, not collapsible`

- Unchecked row: entire row greys out (opacity 0.5, fields non-interactive)
- Subitem: indented 18px, parent badge shows resolved parent title
- Rejected creates: shown only in the existing warning banner (not as rows)

### 2.2 Moves → "Status Updates" group

Replaces the flat checkbox list. Uses an orange group header (`STATUS UPDATES (N)`).

Each move row:
`[checkbox]  [item title]  [current status pill]  →  [proposed status pill]`

**Status pill resolution:**
- Current-status pill: `STATUS_BY_ID[itemsById.get(m.itemId)?.statusId]` — keyed by id.
- Proposed-status pill: `m.toStatus` is a **string name** (e.g. `"Done"`) not an id — the AI emits status names. Use a name-keyed map.
- Both maps built locally in the render (neither exported from `itemStatuses.js`):
  ```js
  const STATUS_BY_ID   = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id,   s]));
  const STATUS_BY_NAME = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.name, s]));
  ```
- Pills use `getPillBg` / `getTextColor` from `src/theme/pillColors.js`.

No other change to move logic. Dropped moves stay banner-only.

### 2.3 Notes section

**Unchanged.** Stays as the existing checkbox list below moves.

### 2.4 Field interaction model

All interactive fields use the same **interaction patterns** as TaskBoardRow (click to open MUI Menu, checkmarks). Category and tag **visuals** follow the confirmed design (Andy approved in design review — explicitly different from TaskBoardRow's non-compact dot+text for both):

| Field | Interaction | Visual |
|---|---|---|
| Title | Click → TextField inline edit; blur or Enter saves | same as TaskBoardRow |
| Status | Click pill → MUI Menu, STATUS_OPTIONS | colored pill, same as TaskBoardRow |
| Assignee | Click avatar/dash → MUI Menu, multi-select | avatar circles, same as TaskBoardRow |
| Category | Click pill → MUI Menu, single-select | **bordered pill** (colored bg + border + text) |
| Tags | Click dot-text area → MUI Menu, multi-select | **colored dot (8px) + plain text, no border** |

Category uses a bordered pill — consistent with how topic categories appear in SyncMeetingDialog's existing topic-categorization section. Tags use dot+text — matching the main project board column style.

Empty states: `+ category` placeholder pill (grey border); `+ tags` placeholder text. The `·` separator between category and tags is **omitted** when both are in their empty-placeholder state; shown otherwise.

---

## 3. Component: `ProposedBoardRow`

**New file:** `src/components/ProposedBoardRow.jsx`

No Firestore writes. All mutations go through two callbacks:
- `onUpdateCreate(idx, field, value)` — edits `proposal.boardChanges.creates[idx]` title only
- `onUpdatePromotion(idx, patch)` — merges into `promotions[idx]` (statusId, assigneeIds, categoryId, tagIds)

**Props:**

```js
ProposedBoardRow({
  create,           // proposal.boardChanges.creates[idx]
  idx,              // index in creates array
  isChecked,        // selCreates.has(idx)
  onToggle,         // () => toggle create
  promotion,        // promotions[idx] || {}
  onUpdateCreate,   // (idx, field, value) => void — title only
  onUpdatePromotion,// (idx, patch) => void
  itemsById,        // Map<id, item> of existing items (for parent label resolution)
  creates,          // full creates array (for new:N parent label)
  users,            // for assignee menu
  categories,       // full category objects { id, name, color, slug } — pass _categories prop from dialog
  tags,             // full tag objects { id, name, color } — pass _tags prop from dialog
})
```

**Data source for `categories` and `tags`:** Pass the dialog's `_categories` and `_tags` props directly — these are the full Firestore objects that include `id` and `color`. Do **not** use `catCtx.categories` or `catCtx.tagVocab` — those are stripped versions (no `color`, no `id`) built for the AI prompt payload and cannot drive colored UI rendering.

**Internal state:** title edit mode (`editingTitle`, `titleValue`), and four MUI Menu anchors (status, assignee, category, tags).

**AI note (Row 3) is read-only.** `create.note` is displayed as dimmed italic text. It is informational only — not editable from the row. `onUpdateCreate` is used for the title field only; `note` is never mutated from the review UI.

---

## 4. State Changes in `SyncMeetingDialog`

### 4.1 Promotions shape

Expanded from `{ statusId, assigneeIds? }` to:

```js
{
  statusId: number,
  assigneeIds?: string[],
  categoryId?: string | null,
  tagIds?: string[],
}
```

### 4.2 Promotion initialisation in `applyValidation`

When building `initPromotions` for accepted creates, also seed `categoryId` and `tagIds` via `inheritKeysForCreate`. Add `topicsById` immediately before the `creates.forEach` loop (it is only used there):

```js
const topicsById = Object.fromEntries((prop.topics || []).map((t) => [t.topicId, t]));
creates.forEach((c, i) => {
  if (accepted.has(c)) {
    const assigneeIds = inferAssigneeIds(c.note, users);
    const { categoryId, tagIds } = inheritKeysForCreate(c, topicsById);
    initPromotions[i] = {
      statusId: AI_GEN_STATUS,
      ...(assigneeIds.length ? { assigneeIds } : {}),
      categoryId: categoryId ?? null,
      tagIds: tagIds ?? [],
    };
  }
});
```

`initPromotions` is always populated for every accepted create, so `promotions[idx]` is always defined for the creates that reach `applyUnified`. The override guard in Section 5 (`promo?.categoryId !== undefined`) is therefore safe.

### 4.3 New setter helper

Replace `setPromoStatus` / `setPromoAssignees` with a single generic setter:

```js
const updatePromotion = (idx, patch) =>
  setPromotions((prev) => ({ ...prev, [idx]: { ...(prev[idx] || {}), ...patch } }));
```

The old `setPromoStatus` had special handling for `statusId === ""` (stripped the key). That clear-case is **intentionally dropped** — the `ProposedBoardRow` status menu always selects from `STATUS_OPTIONS` which always has a value; an empty statusId is never passed.

The existing `setCreateField` stays for title edits. It is not used for `note` (read-only in the new design).

### 4.4 Removed UI elements

The following are removed from `SyncMeetingDialog` (replaced by `ProposedBoardRow`):
- `AI_GEN_OPTION` / `PROMOTE_STATUSES` constants (status list moves into `ProposedBoardRow`)
- `setPromoStatus` / `setPromoAssignees` functions
- The entire creates form-field block (TextField title, Description TextField, Status Select, Assignee Select, Parent Select)

**Parent Select is intentionally dropped.** `parentRef` is display-only in the new design. Editing it from the review UI is out of scope — see Section 8.

`setCreateField` stays (used by `ProposedBoardRow` via `onUpdateCreate`).

---

## 5. Change to `applyUnified` (`src/lib/aiAgenda.js`)

`topicsById` is already built in `applyUnified` before the creates loop. Replace the `inheritKeysForCreate` line to prefer promotion values:

```js
// Before (line ~615):
const { categoryId, tagIds } = inheritKeysForCreate(create, topicsById);

// After:
const inherited = inheritKeysForCreate(create, topicsById);
const categoryId = promo?.categoryId !== undefined ? promo.categoryId : inherited.categoryId;
const tagIds = promo?.tagIds !== undefined ? promo.tagIds : inherited.tagIds;
```

No other changes to `applyUnified`.

---

## 6. Files Changed

| File | Change |
|---|---|
| `src/components/ProposedBoardRow.jsx` | **NEW** — proposed create row component |
| `src/components/SyncMeetingDialog.jsx` | Replace creates + moves sections; expand promotions init |
| `src/lib/aiAgenda.js` | `applyUnified` prefers `promo.categoryId` / `promo.tagIds` |

`src/lib/syncMeeting.js` — no changes.

---

## 7. Out of Scope

- Notes section redesign (stays as-is)
- Due date on proposed creates
- Priority on proposed creates
- "Add subtask" from the review UI (creates are AI-defined)
- `parentRef` editing from the review UI — parent badge is display-only; AI-assigned parent applies as-is
- Master Touch Base board section (deferred)

---

## 8. Verification

After deploy, run Sync Meeting on any client meeting (non-master):

1. Review step shows "New Items" group with board-style rows — no TextFields/Selects visible
2. Click title → edits inline; blur saves to proposal state
3. Click status pill → menu opens; selecting changes pill color
4. Click assignee area → menu opens; selecting toggles avatar
5. Click category pill → menu opens; selecting updates pill
6. Click tag area → menu opens; selecting adds/removes dot+text tags
7. Uncheck a row → row greys out, fields non-interactive
8. Apply → new items on the board have the edited title, status, assignee, category, tags
9. `create.note` stored as the item's `description` field in Firestore (unchanged behavior)
10. Status Updates group shows pill → arrow → pill rows; checkboxes work
11. Notes section unchanged
