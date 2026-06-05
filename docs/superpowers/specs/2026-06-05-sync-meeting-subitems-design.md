# Sync Meeting — Subitem Creation

**Date:** 2026-06-05
**Status:** Approved for implementation

## Overview

Sync Meeting's AI pass can currently only propose top-level board items (`parentId: null`). This spec adds the ability to propose subitems nested one level under either an existing top-level board item or another item proposed in the same run. The user reviews and approves/edits the nesting in the review modal before applying.

## Scope & Constraints

- **Single depth only.** A subitem may nest under a top-level item. A subitem may not itself be a parent. Enforced in the prompt, validation, and apply.
- **Existing parents:** any top-level item already on the board (from `existingTasks`).
- **Intra-run parents:** any create proposed in the same run that has no `parentRef` of its own.
- No changes to moves or notes — those continue to target top-level items only.
- No changes to the Firestore data model — `parentId` and `hasChildren` already exist on `items`.

---

## 1. AI Schema & Prompt — `api/ai/prepare.js`

### Schema change

Add one optional string field to the creates item schema in `buildSchema()`:

```js
creates: {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      title:      { type: "string" },
      topicIndex: { type: "integer" },
      note:       { type: "string" },
      parentRef:  { type: "string" },   // NEW — optional
    },
    required: ["title", "topicIndex", "note"],  // parentRef intentionally not required
  },
},
```

### Prompt change

Append to the `### boardChanges.creates` section of `buildSystem()`:

```
**Optional: `parentRef`** — set when the new task is a subitem of an existing board item
OR of another task being proposed in this same run.
- To nest under an **existing** board item: set `parentRef` to that item's `itemId`
  (from the task list below).
- To nest under a **newly proposed** task in this run: set `parentRef` to `"new:N"`
  where N is the 0-based index of the parent create in this `creates` array
  (e.g. `"new:0"` nests under the first proposed task).
- A subitem may only nest one level deep — never set `parentRef` on a task whose
  intended parent itself has a `parentRef`.
- Leave `parentRef` empty or omit it for top-level tasks.
```

---

## 2. Apply Logic — `src/lib/aiAgenda.js` (`applyUnified`)

### Pre-transaction: allocate doc refs up front

Before entering the Firestore transaction, allocate all create doc refs:

```js
const createDocRefs = acceptedCreates.map(() => doc(collection(db, "items")));
// createDocRefs[i] is the Firestore ref for acceptedCreates[i]
```

This allows forward-reference resolution regardless of array order.

### Pre-pass: identify which creates become parents

```js
const parentCreateIdxs = new Set();
acceptedCreates.forEach(({ create }, i) => {
  const ref = create.parentRef || "";
  if (ref.startsWith("new:")) {
    const n = parseInt(ref.slice(4), 10);
    if (!isNaN(n)) parentCreateIdxs.add(n);  // absolute index into acceptedCreates
  }
});
```

Note: `parentRef: "new:N"` uses N as the index into the **full** `creates` array from the proposal. `applyUnified` maps those to `acceptedCreates` positions via the `createIdxs` mapping.

### Per-create: resolve parentRef → parentId

```js
acceptedCreates.forEach(({ idx, create }, pos) => {
  const ref = create.parentRef || "";
  let parentId = null;

  if (ref.startsWith("new:")) {
    const n = parseInt(ref.slice(4), 10);
    // n is the index into the original proposal creates array;
    // find which accepted position maps to that original index
    const targetPos = acceptedCreates.findIndex((x) => x.idx === n);
    if (targetPos >= 0) parentId = createDocRefs[targetPos].id;
  } else if (ref) {
    parentId = ref;  // existing Firestore item ID
  }

  tx.set(createDocRefs[pos], {
    ...itemFields,
    parentId,
    hasChildren: parentCreateIdxs.has(pos),  // true if another accepted create references this one
  });
});
```

### Post-creates: update existing-item parents

Collect all `parentRef` values that are existing itemIds (non-empty, not `"new:N"`). For each unique one, issue a `tx.update` setting `hasChildren: true`:

```js
const existingParentIds = new Set(
  acceptedCreates
    .map(({ create }) => create.parentRef || "")
    .filter((ref) => ref && !ref.startsWith("new:"))
);
existingParentIds.forEach((id) => {
  tx.update(doc(db, "items", id), { hasChildren: true, updatedAt: serverTimestamp() });
});
```

---

## 3. Validation — `src/lib/syncMeeting.js` (`validateProposal`)

Add three rejection rules inside the existing creates loop, after the topic-ownership check:

```js
const ref = c.parentRef || "";
if (ref) {
  if (ref.startsWith("new:")) {
    const n = parseInt(ref.slice(4), 10);
    if (isNaN(n) || n < 0 || n >= creates.length) {
      rejectedCreates.push({ ...c, reason: "parentRef new:N index out of range" }); continue;
    }
    if (n === idx) {  // idx = position of c in creates array
      rejectedCreates.push({ ...c, reason: "parentRef self-reference" }); continue;
    }
    const targetParent = creates[n];
    if (targetParent?.parentRef) {
      rejectedCreates.push({ ...c, reason: "parentRef would exceed single nesting depth" }); continue;
    }
  } else {
    if (!knownItemIds.has(ref)) {
      rejectedCreates.push({ ...c, reason: "parentRef itemId not found on board" }); continue;
    }
  }
}
```

`idx` is the loop index (the 0-based position of `c` in `creates`). `knownItemIds` is the existing set from `existingTasks`.

`existingTasks` retains its current `!it.parentId` filter — only top-level existing items are valid parents.

---

## 4. Review Modal — `src/components/SyncMeetingDialog.jsx`

### Parent display

Each create row shows a **Parent** line when `c.parentRef` is set, below the Topic line:

```jsx
{c.parentRef && (() => {
  const label = c.parentRef.startsWith("new:")
    ? (() => {
        const n = parseInt(c.parentRef.slice(4), 10);
        const parentCreate = creates[n];
        return parentCreate ? `${parentCreate.title} (new)` : `new task #${n}`;
      })()
    : itemsById.get(c.parentRef)?.title || c.parentRef;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
      Parent: {label}
    </Typography>
  );
})()}
```

### Parent edit dropdown

A **Parent** `Select` added to the inline controls row (after Assignee):

```jsx
<FormControl size="small" sx={{ minWidth: 180 }}>
  <InputLabel>Parent</InputLabel>
  <Select
    label="Parent"
    value={c.parentRef || ""}
    onChange={(e) => setCreateField(i, "parentRef", e.target.value)}
    disabled={!selCreates.has(i)}
  >
    <MenuItem value=""><em>None (top-level)</em></MenuItem>
    {/* Existing top-level items */}
    {(items || [])
      .filter((it) => !it.parentId)
      .map((it) => (
        <MenuItem key={it.id} value={it.id}>{it.title}</MenuItem>
      ))}
    {/* Other creates in this run that are themselves top-level */}
    {creates.map((other, j) => {
      if (j === i) return null;           // skip self
      if (other.parentRef) return null;   // skip creates that are already subitems
      return (
        <MenuItem key={`new:${j}`} value={`new:${j}`}>
          {other.title} (new)
        </MenuItem>
      );
    })}
  </Select>
</FormControl>
```

### Visual indentation

Creates with a non-empty `parentRef` render with `pl: 3` on the outer `Box` and slightly lighter title weight, signalling nesting without reordering the list.

### Section header

`New tasks → AI Gen` → `New tasks & subitems → AI Gen`

---

## 5. Accepted Schema Change to `accepted` Object

The `accepted` object passed from the dialog to `applyUnified` carries `promotions` keyed by create index. No change needed — `parentRef` lives on the create itself (in the proposal), not in promotions.

---

## Data Flow Summary

```
AI output
  creates[i].parentRef = ""         → top-level (parentId: null)
  creates[i].parentRef = "abc123"   → subitem under existing item "abc123"
                                       + tx.update "abc123" hasChildren=true
  creates[i].parentRef = "new:2"    → subitem under creates[2] in this run
                                       + creates[2] written with hasChildren=true

validateProposal (on receipt + at apply)
  parentRef itemId not in existingTasks     → rejected
  parentRef "new:N" out of range            → rejected
  parentRef self-reference                  → rejected
  parentRef target already has a parentRef  → rejected (depth guard)

Review modal
  User sees "Parent: {title}" per row
  User can change/clear via Parent dropdown
  Subitems render indented (pl:3)
```

---

## Files Changed

| File | Change |
|---|---|
| `api/ai/prepare.js` | Add `parentRef` to `buildSchema()` creates; add prompt instructions |
| `src/lib/aiAgenda.js` | Pre-allocate doc refs; pre-pass for parent creates; resolve `parentRef` → `parentId`; post-creates `hasChildren` updates on existing parents |
| `src/lib/syncMeeting.js` | Three new rejection rules in `validateProposal` creates loop |
| `src/components/SyncMeetingDialog.jsx` | Parent display line; Parent dropdown control; indent style; section header update |
| `src/lib/__tests__/syncMeeting.test.js` | Tests for all three new validation rules |
