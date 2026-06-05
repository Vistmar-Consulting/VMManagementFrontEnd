# Sync Meeting — Subitem Creation

**Date:** 2026-06-05
**Status:** Approved for implementation

## Overview

Sync Meeting's AI pass can currently only propose top-level board items (`parentId: null`). This spec adds the ability to propose subitems nested one level under either an existing top-level board item or another item proposed in the same run. The user reviews and approves/edits the nesting in the review modal before applying.

## Scope & Constraints

- **Single depth only.** A subitem may nest under a top-level item. A subitem may not itself be a parent. Enforced in the prompt, validation, and apply.
- **Existing parents:** any top-level item already on the board (from `existingTasks`). The `existingTasks` list already filters `!it.parentId`, so any `parentRef` pointing to a subitem's Firestore ID will fail the `knownItemIds` check and be rejected — the `!it.parentId` filter implicitly enforces this.
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

**Replace** the existing per-create `const ref = doc(collection(db, "items"))` allocation inside the creates loop with a single pre-allocation before the transaction. This is required so that `"new:N"` forward-references can resolve to a doc ID before the target create is written.

```js
// Before runTransaction(...)
const createDocRefs = acceptedCreates.map(() => doc(collection(db, "items")));
// createDocRefs[pos] is the Firestore ref for acceptedCreates[pos]
// The existing per-create `const ref = doc(...)` inside the loop MUST be removed.
```

### Pre-pass: identify which accepted creates become parents

Run this before the transaction body. `"new:N"` in `parentRef` uses N as the index into the **full** proposal `creates` array (same index space as `create.idx`). We need accepted-position space (`pos`) for the `hasChildren` write, so we resolve the mapping here.

```js
const parentCreateIdxs = new Set(); // accepted positions that will be parents
acceptedCreates.forEach(({ create }, pos) => {
  const ref = create.parentRef || "";
  if (ref.startsWith("new:")) {
    const n = parseInt(ref.slice(4), 10);
    // n is an original proposal index; find its accepted position
    const targetPos = acceptedCreates.findIndex((x) => x.idx === n);
    if (targetPos >= 0) parentCreateIdxs.add(targetPos);
  }
});
```

### Per-create: resolve parentRef → parentId

Inside the transaction, replace the existing `tx.set(ref, { ... parentId: null, hasChildren: false ... })` with:

```js
acceptedCreates.forEach(({ idx, create }, pos) => {
  const ref = create.parentRef || "";
  let parentId = null;

  if (ref.startsWith("new:")) {
    const n = parseInt(ref.slice(4), 10);
    // n is a proposal index; map to accepted position to get the pre-allocated ref
    const targetPos = acceptedCreates.findIndex((x) => x.idx === n);
    if (targetPos >= 0) parentId = createDocRefs[targetPos].id;
    // If targetPos === -1 the parent was not accepted (user unchecked it or it was
    // rejected by validation). This should not reach here — validateProposal guards
    // it — but if it does, parentId stays null (silent top-level fallback).
  } else if (ref) {
    parentId = ref;  // existing Firestore item ID
  }

  tx.set(createDocRefs[pos], {
    ...itemFields,             // all existing fields unchanged
    parentId,                  // null = top-level; string = subitem
    hasChildren: parentCreateIdxs.has(pos),  // true if this create is a parent of another accepted create
  });
});
```

### Post-creates: update existing-item parents

After the creates loop, collect all `parentRef` values pointing to existing Firestore item IDs and mark them `hasChildren: true`. These are pure writes (no read needed — `hasChildren` is set unconditionally).

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

### Loop refactor required

The current creates loop is `for (const c of boardChanges?.creates || [])`. The new validation rules need both the loop index and random access into the array. **Refactor to:**

```js
const creates = boardChanges?.creates || [];
for (let idx = 0; idx < creates.length; idx++) {
  const c = creates[idx];
  // ... existing topic-ownership check unchanged ...
  // ... new parentRef checks below ...
}
```

### New validation rules

Declare `rejectedIdxs` before the loop — it tracks indices of rejected creates so forward-referencing subitems can be caught in the second pass:

```js
const rejectedIdxs = new Set(); // populated at each rejection below
const creates = boardChanges?.creates || [];
for (let idx = 0; idx < creates.length; idx++) {
  const c = creates[idx];
  // ... existing topic-ownership check ...
  // if rejected: rejectedCreates.push({ ...c, reason }); rejectedIdxs.add(idx); continue;

  const parentRef = c.parentRef || "";
  if (parentRef) {
    if (parentRef.startsWith("new:")) {
      const n = parseInt(parentRef.slice(4), 10);
      if (isNaN(n) || n < 0 || n >= creates.length) {
        rejectedCreates.push({ ...c, reason: "parentRef new:N index out of range" });
        rejectedIdxs.add(idx); continue;
      }
      if (n === idx) {
        rejectedCreates.push({ ...c, reason: "parentRef self-reference" });
        rejectedIdxs.add(idx); continue;
      }
      const targetParent = creates[n];
      if (targetParent?.parentRef) {
        rejectedCreates.push({ ...c, reason: "parentRef would exceed single nesting depth" });
        rejectedIdxs.add(idx); continue;
      }
      // Forward-reference case (n > idx): target not yet processed.
      // Caught by second-pass below.
    } else {
      if (!knownItemIds.has(parentRef)) {
        rejectedCreates.push({ ...c, reason: "parentRef itemId not found on board" });
        rejectedIdxs.add(idx); continue;
      }
    }
  }
  acceptedCreates.push(c);
}
```

**Important — two changes to the existing loop body:**
1. Every existing rejection (including the topic-ownership check) must also call `rejectedIdxs.add(idx)` before `continue`.
2. The existing `acceptedCreates.push(c)` that currently follows the topic check **must be removed**. The single `acceptedCreates.push(c)` at the end of the new loop body (shown above) is the only push point. An additive patch that keeps the old push AND adds the new end-of-loop push will double-push every accepted create.

### Second-pass: reject subitems whose intra-run parent was itself rejected

After the main loop, forward references (`"new:N"` where N > idx at time of processing) may point to a create that was subsequently rejected. Since `rejectedIdxs` is built from real indices (not `indexOf` on spread copies), this works correctly:

```js
const stillAccepted = [];
for (const c of acceptedCreates) {
  const ref = c.parentRef || "";
  if (ref.startsWith("new:")) {
    const n = parseInt(ref.slice(4), 10);
    if (rejectedIdxs.has(n)) {
      rejectedCreates.push({ ...c, reason: "parentRef target was rejected" });
      continue;
    }
  }
  stillAccepted.push(c);
}
// Replace acceptedCreates in place
acceptedCreates.length = 0;
stillAccepted.forEach((c) => acceptedCreates.push(c));
```

> **Scope note:** `validateProposal`'s return value `acceptedCreates` is used by the dialog on receipt to drive the UI selection. `applyUnified` does not consume it — it rebuilds from `createIdxs`. So the second-pass guards the dialog display path. The apply-time re-run of `validateProposal` (called inside `applyUnified`) will also run the second pass, providing a backstop there too.
>
> **`hasRejections` timing:** the existing `return { ..., hasRejections: rejectedCreates.length > 0 || ... }` fires after the second pass, so it correctly counts second-pass rejections too. No change needed — just don't hoist `hasRejections` to a variable above the second-pass block.

`existingTasks` retains its current `!it.parentId` filter — only top-level existing items are valid parents, and the `knownItemIds` check enforces this implicitly.

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

`creates[n].title` reads the live proposal state, so if the user edits the parent task's title field, the label updates immediately.

### Parent edit dropdown

A **Parent** `Select` added to the inline controls row (after Assignee). `value={`new:${j}`}` and the display label both use `slice(4)` → `parseInt`, so the key format is consistent.

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

Creates with a non-empty `parentRef` render with `pl: 3` on the outer `Box` and slightly lighter title style, signalling nesting without reordering the list.

### Section header

`New tasks → AI Gen` → `New tasks & subitems → AI Gen`

---

## 5. Accepted Schema — No Change

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
  parentRef itemId not in existingTasks        → rejected
  parentRef "new:N" out of range               → rejected
  parentRef self-reference                     → rejected
  parentRef target already has a parentRef     → rejected (depth guard)
  parentRef "new:N" where N itself was rejected → rejected (second-pass cleanup)

Review modal
  User sees "Parent: {title}" per row (live — updates if parent title edited)
  User can change/clear via Parent dropdown
  Subitems render indented (pl:3)
```

---

## Files Changed

| File | Change |
|---|---|
| `api/ai/prepare.js` | Add `parentRef` to `buildSchema()` creates; add prompt instructions to `buildSystem()` |
| `src/lib/aiAgenda.js` | Pre-allocate `createDocRefs`; pre-pass `parentCreateIdxs`; resolve `parentRef` → `parentId` per create; post-creates `hasChildren` update on existing parents; remove old per-create `ref` allocation |
| `src/lib/syncMeeting.js` | Refactor creates loop to indexed `for`; four new rejection rules + second-pass cleanup for rejected-parent forward refs |
| `src/components/SyncMeetingDialog.jsx` | Parent display line; Parent dropdown control; indent style; section header update |
| `src/lib/__tests__/syncMeeting.test.js` | Tests covering all new validation rules including second-pass rejected-parent case |
