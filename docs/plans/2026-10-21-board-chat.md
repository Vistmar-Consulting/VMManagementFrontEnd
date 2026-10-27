# Board Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat panel on the Task Board where the user talks to the latest Sonnet about the board. Claude answers questions, filters the board (including an exact-ID "AI filter") and proposes task/subtask writes that apply only after the user confirms them in a modal. A cost tracker shows the cost per reply and per conversation.

**Architecture:** A stateless `/api/ai/chat` route on the existing `api/ai/dispatch.js` runs one model call per request. The browser owns the tool loop: read tools run against the in-memory board plus Firestore, the filter tool sets board state, and `propose_changes` opens a modal whose Apply runs a single Firestore transaction through a new shared writer (`src/lib/itemWrites.js`), which the Task Board's own create/update/delete handlers move onto too.

**Tech Stack:** React 18 + MUI 5, Firebase Web SDK 11 (Firestore), Vercel serverless (Node, ESM), `@anthropic-ai/sdk` 0.100.1, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-21-board-chat-design.md`

**Conventions (from CLAUDE.md):** functional components + hooks; camelCase fields everywhere; no `console.log`; no commented-out code; tests in `__tests__/` beside the code; commit with explicit pathspecs (never `git add -A`). Run tests **serially** with `npx vitest run <path>`. Never run a build and the full suite at the same time, because parallel sessions slow down. Never read `.env*` files.

**Commit trailer for every commit:**
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/itemWrites.js` | create | The one writer for items: blank-item shape, order keys, create (top/sub), update, cascade delete, `applyChangeSet` transaction. |
| `src/lib/__tests__/itemWrites.test.js` | create | Characterization of today's handler writes + `applyChangeSet`. |
| `src/pages/TaskBoard.jsx` | modify | Handlers call `itemWrites`; AI-filter state + chip; Board Chat button + panel; `applyBoardFilter`. |
| `src/lib/boardFilters.js` | modify | `buildItemMatcher` gains optional `idSet`. |
| `src/lib/__tests__/boardFilters.test.js` | modify | `idSet` tests. |
| `api/ai/_handlers/chatModels.js` | create | Pick + memoize the newest `claude-sonnet-*`. |
| `api/ai/_handlers/chatPricing.js` | create | Price table + `costUsd`. |
| `api/ai/_handlers/chatTools.js` | create | System prompt + tool schemas. |
| `api/ai/_handlers/chat.js` | create | The route handler. |
| `api/ai/dispatch.js` | modify | Register `chat`. |
| `api/__tests__/chat.test.js` | create | Models, pricing, handler. |
| `src/lib/boardChat/snapshot.js` | create | Board → compact context text + `seen` map. |
| `src/lib/boardChat/proposal.js` | create | Validate/normalize ops, diffs, staleness, completedAt rule, change set. |
| `src/lib/boardChat/tools.js` | create | Browser-side read tools. |
| `src/lib/boardChat/api.js` | create | `postChat` fetch wrapper. |
| `src/lib/boardChat/conversation.js` | create | The per-turn tool loop + cost accumulation. |
| `src/lib/boardChat/__tests__/*.test.js` | create | Unit tests for the five modules above. |
| `src/components/BoardChatChangesModal.jsx` | create | The confirm-changes modal. |
| `src/components/BoardChatPanel.jsx` | create | The chat drawer. |
| `src/components/__tests__/BoardChatChangesModal.test.jsx` | create | Modal behavior. |

---

### Task 1: `itemWrites.js` — characterize and extract the board's writes

**Files:**
- Create: `src/lib/itemWrites.js`
- Test: `src/lib/__tests__/itemWrites.test.js`

The expected documents below are copied field for field from `TaskBoard.jsx` `handleAddItem` (lines 464–496), `handleAddSubitem` (512–558), `handleUpdate` (305–307) and `handleConfirmDelete` (318–331). That is today's behavior, and the extraction must keep it.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/itemWrites.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const writes = [];
let docsById = {};
let idSeq = 0;

vi.mock("../../firebase.js", () => ({ db: { name: "db" } }));
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ collection: name }),
  doc: (a, b, c) => {
    if (a && a.collection && b === undefined) return { id: `new${++idSeq}`, path: `${a.collection}/new${idSeq}` };
    return { id: c, path: `${b}/${c}` };
  },
  serverTimestamp: () => "TS",
  updateDoc: async (ref, data) => { writes.push(["update", ref.path, data]); },
  writeBatch: () => ({
    delete: (ref) => writes.push(["delete", ref.path]),
    commit: async () => {},
  }),
  runTransaction: async (_db, fn) => fn({
    get: async (ref) => ({ exists: () => ref.path in docsById, data: () => docsById[ref.path] }),
    set: (ref, data) => writes.push(["set", ref.path, data]),
    update: (ref, data) => writes.push(["update", ref.path, data]),
    delete: (ref) => writes.push(["delete", ref.path]),
  }),
}));

const W = await import("../itemWrites.js");

beforeEach(() => { writes.length = 0; docsById = {}; idSeq = 0; });

const BLANK = {
  hasChildren: false, type: "task", title: "", description: "", statusId: 1,
  priorityId: null, categoryId: null, tagIds: [], dueDate: null, completedAt: null,
  assigneeIds: [], createdBy: "u1", createdAt: "TS", updatedAt: "TS",
};

describe("itemWrites — today's board writes", () => {
  it("createTopLevelItem allocates the org counter and writes a blank task", async () => {
    docsById["organizations/unio"] = { nextItemNumber: 7 };
    const ref = W.newItemRef();
    await W.createTopLevelItem({ ref, orgId: "unio", uid: "u1", order: "a5" });
    expect(writes).toEqual([
      ["set", "items/new1", { ...BLANK, organizationId: "unio", parentId: null, itemNumber: 7, order: "a5" }],
      ["update", "organizations/unio", { nextItemNumber: 8 }],
    ]);
  });

  it("createSubitem allocates the parent counter and marks hasChildren", async () => {
    docsById["items/p1"] = { nextSubitemNumber: 3 };
    const ref = W.newItemRef();
    await W.createSubitem({ ref, parent: { id: "p1", organizationId: "unio" }, uid: "u1", order: "a1" });
    expect(writes).toEqual([
      ["set", "items/new1", { ...BLANK, organizationId: "unio", parentId: "p1", itemNumber: 3, order: "a1" }],
      ["update", "items/p1", { nextSubitemNumber: 4, hasChildren: true, updatedAt: "TS" }],
    ]);
  });

  it("counters default to 1 when missing", async () => {
    docsById["organizations/unio"] = {};
    await W.createTopLevelItem({ ref: W.newItemRef(), orgId: "unio", uid: "u1", order: "a0" });
    expect(writes[0][2].itemNumber).toBe(1);
    expect(writes[1][2]).toEqual({ nextItemNumber: 2 });
  });

  it("updateItem stamps updatedAt only", async () => {
    await W.updateItem("i1", { statusId: 5 });
    expect(writes).toEqual([["update", "items/i1", { statusId: 5, updatedAt: "TS" }]]);
  });

  it("deleteItemCascade deletes subitems then the item in one batch", async () => {
    await W.deleteItemCascade("p1", ["s1", "s2"]);
    expect(writes).toEqual([["delete", "items/s1"], ["delete", "items/s2"], ["delete", "items/p1"]]);
  });

  it("order helpers append after the last key", () => {
    const items = [
      { id: "a", parentId: null, order: "a0" },
      { id: "b", parentId: null, order: "a1" },
      { id: "c", parentId: "a", order: "a0" },
    ];
    expect(W.nextTopLevelOrder(items) > "a1").toBe(true);
    expect(W.nextSubitemOrder(items, "a") > "a0").toBe(true);
    expect(W.nextSubitemOrder(items, "b")).toBe("a0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/itemWrites.test.js`
Expected: FAIL — `Failed to resolve import "../itemWrites.js"`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/lib/itemWrites.js
//
// The one writer for items/{itemId}. The Task Board's add / add-subitem /
// update / delete handlers and Board Chat's Apply all go through here, so
// counters (organizations.nextItemNumber, parent.nextSubitemNumber),
// hasChildren and the delete cascade stay identical everywhere.
import { collection, doc, runTransaction, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "../firebase.js";

function orderAfterLast(siblings) {
  const last = siblings.map((i) => i.order).filter(Boolean).sort().pop() || null;
  return generateKeyBetween(last, null);
}

// Rank for a new item: placed after the current last sibling.
export function nextTopLevelOrder(allItems) {
  return orderAfterLast(allItems.filter((i) => i.parentId == null));
}

export function nextSubitemOrder(allItems, parentId) {
  return orderAfterLast(allItems.filter((i) => i.parentId === parentId));
}

export function blankItem({ organizationId, parentId, itemNumber, uid, order, fields = {} }) {
  return {
    organizationId,
    parentId,
    hasChildren: false,
    type: "task",
    title: "",
    description: "",
    statusId: 1,
    priorityId: null,
    categoryId: null,
    tagIds: [],
    dueDate: null,
    completedAt: null,
    assigneeIds: [],
    itemNumber,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    order,
    ...fields,
  };
}

export function newItemRef() {
  return doc(collection(db, "items"));
}

// Transaction pulls the next item number from the org doc and bumps it, so
// two people adding at once can't get the same I-N.
export async function createTopLevelItem({ ref, orgId, uid, order }) {
  const orgRef = doc(db, "organizations", orgId);
  await runTransaction(db, async (tx) => {
    const orgSnap = await tx.get(orgRef);
    const next = orgSnap.data()?.nextItemNumber ?? 1;
    tx.set(ref, blankItem({ organizationId: orgId, parentId: null, itemNumber: next, uid, order }));
    tx.update(orgRef, { nextItemNumber: next + 1 });
  });
}

// SI-N is per parent. Reading the parent in the transaction also makes the
// hasChildren update race-safe.
export async function createSubitem({ ref, parent, uid, order }) {
  const parentRef = doc(db, "items", parent.id);
  await runTransaction(db, async (tx) => {
    const parentSnap = await tx.get(parentRef);
    const next = parentSnap.data()?.nextSubitemNumber ?? 1;
    tx.set(ref, blankItem({ organizationId: parent.organizationId, parentId: parent.id, itemNumber: next, uid, order }));
    tx.update(parentRef, { nextSubitemNumber: next + 1, hasChildren: true, updatedAt: serverTimestamp() });
  });
}

export function updateItem(itemId, patch) {
  return updateDoc(doc(db, "items", itemId), { ...patch, updatedAt: serverTimestamp() });
}

// Parent + all children commit together so a Firestore hiccup can't leave
// subitems orphaned.
export async function deleteItemCascade(itemId, subitemIds = []) {
  const batch = writeBatch(db);
  subitemIds.forEach((id) => batch.delete(doc(db, "items", id)));
  batch.delete(doc(db, "items", itemId));
  await batch.commit();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/itemWrites.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/itemWrites.js src/lib/__tests__/itemWrites.test.js
git commit -m "feat(items): shared item writer with characterization tests"
```

---

### Task 2: `applyChangeSet` — one transaction for a reviewed change set

**Files:**
- Modify: `src/lib/itemWrites.js` (append)
- Test: `src/lib/__tests__/itemWrites.test.js` (append)

The input ops come from `toChangeSet` (Task 7):
- `{ kind: "create", tempId, orgId, parentId | null, parentTempId | null, fields }`
- `{ kind: "update", itemId, patch }`
- `{ kind: "delete", itemId, cascadeIds }`

A create with a `parentTempId` always comes after its parent's create.

- [ ] **Step 1: Write the failing test** (append to the same file)

```js
describe("applyChangeSet", () => {
  const allItems = [
    { id: "p1", parentId: null, order: "a0", organizationId: "unio" },
    { id: "s1", parentId: "p1", order: "a0", organizationId: "unio" },
  ];

  it("creates a project with two subtasks, numbering each correctly", async () => {
    docsById["organizations/unio"] = { nextItemNumber: 4 };
    const results = await W.applyChangeSet([
      { kind: "create", tempId: "t1", orgId: "unio", parentId: null, parentTempId: null, fields: { title: "Appt data", createdVia: "board-chat" } },
      { kind: "create", tempId: "t2", orgId: "unio", parentId: null, parentTempId: "t1", fields: { title: "Schema", createdVia: "board-chat" } },
      { kind: "create", tempId: "t3", orgId: "unio", parentId: null, parentTempId: "t1", fields: { title: "Import", createdVia: "board-chat" } },
    ], { uid: "u1", allItems });

    const sets = writes.filter((w) => w[0] === "set");
    expect(sets.map((s) => [s[1], s[2].title, s[2].itemNumber, s[2].parentId])).toEqual([
      ["items/new1", "Appt data", 4, null],
      ["items/new2", "Schema", 1, "new1"],
      ["items/new3", "Import", 2, "new1"],
    ]);
    expect(sets[0][2].hasChildren).toBe(true);
    expect(sets[0][2].nextSubitemNumber).toBe(3);
    expect(sets[1][2].order < sets[2][2].order).toBe(true);
    expect(writes).toContainEqual(["update", "organizations/unio", { nextItemNumber: 5 }]);
    expect(results).toEqual([
      { tempId: "t1", itemId: "new1", ref: "I-4" },
      { tempId: "t2", itemId: "new2", ref: "SI-1" },
      { tempId: "t3", itemId: "new3", ref: "SI-2" },
    ]);
  });

  it("adds a subtask under an existing parent using its counter", async () => {
    docsById["items/p1"] = { nextSubitemNumber: 2 };
    const results = await W.applyChangeSet([
      { kind: "create", tempId: "t1", orgId: "unio", parentId: "p1", parentTempId: null, fields: { title: "New sub" } },
    ], { uid: "u1", allItems });
    expect(writes).toContainEqual(["update", "items/p1", { nextSubitemNumber: 3, hasChildren: true, updatedAt: "TS" }]);
    expect(results[0].ref).toBe("SI-2");
  });

  it("applies updates and cascade deletes", async () => {
    docsById["items/p1"] = {};
    docsById["items/x9"] = {};
    await W.applyChangeSet([
      { kind: "update", itemId: "x9", patch: { statusId: 5, completedAt: "NOW" } },
      { kind: "delete", itemId: "p1", cascadeIds: ["s1"] },
    ], { uid: "u1", allItems });
    expect(writes).toEqual([
      ["update", "items/x9", { statusId: 5, completedAt: "NOW", updatedAt: "TS" }],
      ["delete", "items/s1"],
      ["delete", "items/p1"],
    ]);
  });

  it("refuses the whole set when a target no longer exists", async () => {
    await expect(W.applyChangeSet([
      { kind: "update", itemId: "gone", patch: { title: "x" } },
    ], { uid: "u1", allItems })).rejects.toThrow("gone no longer exists");
    expect(writes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/itemWrites.test.js`
Expected: FAIL — `W.applyChangeSet is not a function`.

- [ ] **Step 3: Write the minimal implementation** (append to `src/lib/itemWrites.js`)

```js
const unique = (arr) => [...new Set(arr)];

// Board Chat Apply: every accepted op in ONE transaction — all reads first
// (Firestore requires it), then all writes. A missing target aborts the set.
// Returns [{ tempId, itemId, ref }] for the creates.
export async function applyChangeSet(ops, { uid, allItems }) {
  const creates = ops.filter((o) => o.kind === "create");
  const refs = new Map(creates.map((c) => [c.tempId, newItemRef()]));
  const childCountByTemp = new Map();
  for (const c of creates) {
    if (c.parentTempId) childCountByTemp.set(c.parentTempId, (childCountByTemp.get(c.parentTempId) || 0) + 1);
  }

  return runTransaction(db, async (tx) => {
    const orgIds = unique(creates.filter((c) => !c.parentId && !c.parentTempId).map((c) => c.orgId));
    const parentIds = unique(creates.filter((c) => c.parentId).map((c) => c.parentId));
    const targetIds = unique(ops.filter((o) => o.kind !== "create").map((o) => o.itemId));

    const orgSnaps = new Map();
    for (const id of orgIds) orgSnaps.set(id, await tx.get(doc(db, "organizations", id)));
    const parentSnaps = new Map();
    for (const id of parentIds) parentSnaps.set(id, await tx.get(doc(db, "items", id)));
    for (const id of [...parentIds, ...targetIds]) {
      const snap = parentSnaps.get(id) || await tx.get(doc(db, "items", id));
      if (!snap.exists()) throw new Error(`Item ${id} no longer exists`);
    }

    const nextOrgNum = new Map(orgIds.map((id) => [id, orgSnaps.get(id).data()?.nextItemNumber ?? 1]));
    const nextSubNum = new Map(parentIds.map((id) => [id, parentSnaps.get(id).data()?.nextSubitemNumber ?? 1]));
    let lastTop = null;
    const lastSub = new Map();
    const results = [];

    for (const c of creates) {
      const ref = refs.get(c.tempId);
      if (!c.parentId && !c.parentTempId) {
        const n = nextOrgNum.get(c.orgId);
        nextOrgNum.set(c.orgId, n + 1);
        const order = lastTop
          ? generateKeyBetween(lastTop, null)
          : nextTopLevelOrder(allItems);
        lastTop = order;
        const kids = childCountByTemp.get(c.tempId) || 0;
        const fields = kids ? { ...c.fields, hasChildren: true, nextSubitemNumber: kids + 1 } : c.fields;
        tx.set(ref, blankItem({ organizationId: c.orgId, parentId: null, itemNumber: n, uid, order, fields }));
        results.push({ tempId: c.tempId, itemId: ref.id, ref: `I-${n}` });
      } else {
        const parentId = c.parentId || refs.get(c.parentTempId).id;
        const n = nextSubNum.get(parentId) ?? 1;
        nextSubNum.set(parentId, n + 1);
        const order = lastSub.has(parentId)
          ? generateKeyBetween(lastSub.get(parentId), null)
          : nextSubitemOrder(allItems, parentId);
        lastSub.set(parentId, order);
        tx.set(ref, blankItem({ organizationId: c.orgId, parentId, itemNumber: n, uid, order, fields: c.fields }));
        results.push({ tempId: c.tempId, itemId: ref.id, ref: `SI-${n}` });
      }
    }

    for (const id of orgIds) tx.update(doc(db, "organizations", id), { nextItemNumber: nextOrgNum.get(id) });
    for (const id of parentIds) {
      tx.update(doc(db, "items", id), { nextSubitemNumber: nextSubNum.get(id), hasChildren: true, updatedAt: serverTimestamp() });
    }
    for (const o of ops) {
      if (o.kind === "update") tx.update(doc(db, "items", o.itemId), { ...o.patch, updatedAt: serverTimestamp() });
      if (o.kind === "delete") {
        (o.cascadeIds || []).forEach((id) => tx.delete(doc(db, "items", id)));
        tx.delete(doc(db, "items", o.itemId));
      }
    }
    return results;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/itemWrites.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/itemWrites.js src/lib/__tests__/itemWrites.test.js
git commit -m "feat(items): applyChangeSet — reviewed change set in one transaction"
```

---

### Task 3: Move the Task Board onto `itemWrites`

**Files:**
- Modify: `src/pages/TaskBoard.jsx` — imports (13–23), `handleUpdate` (305–307), `handleConfirmDelete` (318–331), order helpers (437–448), `handleAddItem` (464–496), `handleAddSubitem` (512–558)

- [ ] **Step 1: Replace the handlers**

In the `firebase/firestore` import, keep only what the remaining code still uses. The category/tag CRUD still uses `addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch`. `runTransaction` and the `generateKeyBetween` import move out. After the edit, check with `grep -n "runTransaction\|generateKeyBetween" src/pages/TaskBoard.jsx`; it should return nothing. Add:

```js
import {
  createSubitem,
  createTopLevelItem,
  deleteItemCascade,
  newItemRef,
  nextSubitemOrder,
  nextTopLevelOrder,
  updateItem,
} from "../lib/itemWrites.js";
```

Replace `handleUpdate`:

```js
  const handleUpdate = (itemId, patch) => updateItem(itemId, patch);
```

Replace the body of `handleConfirmDelete` (keep the guard and `setDeleteConfirm(null)`):

```js
  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    const { item, isSubitem } = deleteConfirm;
    const subIds = isSubitem ? [] : (subitemsByParent[item.id] || []).map((s) => s.id);
    await deleteItemCascade(item.id, subIds);
    setDeleteConfirm(null);
  };
```

Delete the local `nextTopLevelOrder` / `nextSubitemOrder` definitions. Replace `handleAddItem`:

```js
  const handleAddItem = async (orgId) => {
    const ref = newItemRef();
    setNewItemId(ref.id);
    await createTopLevelItem({ ref, orgId, uid: user.uid, order: nextTopLevelOrder(allItems) });
  };
```

In `handleAddSubitem`, keep the `addingSubitemRef` guard and the `setRowsExpanded(...)` line. Replace everything from `const newItemRef = doc(...)` through the end of the `runTransaction` call with:

```js
      const ref = newItemRef();
      setNewItemId(ref.id);
      await createSubitem({ ref, parent: parentItem, uid: user.uid, order: nextSubitemOrder(allItems, parentItem.id) });
```

- [ ] **Step 2: Run the board + writer tests**

Run: `npx vitest run src/pages/__tests__/TaskBoard.expandAll.test.jsx src/lib/__tests__/itemWrites.test.js`
Expected: PASS (all).

- [ ] **Step 3: Build**

Run: `npx vite build 2>&1 | tail -5`
Expected: `✓ built in …`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/TaskBoard.jsx
git commit -m "refactor(board): Task Board writes go through itemWrites"
```

---

### Task 4: AI filter — `idSet` in `buildItemMatcher`

**Files:**
- Modify: `src/lib/boardFilters.js:3`
- Test: `src/lib/__tests__/boardFilters.test.js` (append)

- [ ] **Step 1: Write the failing test** (append)

```js
describe("buildItemMatcher idSet (AI filter)", () => {
  const items = [
    { id: "a", title: "Appointment import", statusId: 1 },
    { id: "b", title: "Appointment schema", statusId: 5 },
    { id: "c", title: "Unrelated", statusId: 1 },
  ];
  it("keeps only ids in the set", () => {
    const m = buildItemMatcher({ idSet: new Set(["a", "b"]) });
    expect(items.filter(m).map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("ANDs with column filters", () => {
    const m = buildItemMatcher({ idSet: new Set(["a", "b"]), columnFilters: { statusId: [1] } });
    expect(items.filter(m).map((i) => i.id)).toEqual(["a"]);
  });
  it("no idSet means no id restriction", () => {
    expect(items.filter(buildItemMatcher({})).length).toBe(3);
  });
});
```

If `buildItemMatcher` isn't already imported at the top of the test file, add `import { buildItemMatcher } from "../boardFilters.js";`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/boardFilters.test.js`
Expected: FAIL — the first new test returns all three ids.

- [ ] **Step 3: Implement**

```js
// Task Board search + column-filter predicate. Values within one column are
// ORed; every active column, the title search and the AI filter (idSet: the
// exact items Board Chat picked) are ANDed together.
export function buildItemMatcher({ titleSearch = "", columnFilters = {}, idSet = null }) {
  const q = titleSearch.trim().toLowerCase();
  const activeCols = Object.entries(columnFilters).filter(([, v]) => v && v.length > 0);
  return (item) => {
    if (idSet && !idSet.has(item.id)) return false;
```

(The rest of the function is unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/boardFilters.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boardFilters.js src/lib/__tests__/boardFilters.test.js
git commit -m "feat(board): AI filter id set in buildItemMatcher"
```

---

### Task 5: Server — model resolution, pricing, tools, `/api/ai/chat`

**Files:**
- Create: `api/ai/_handlers/chatModels.js`, `api/ai/_handlers/chatPricing.js`, `api/ai/_handlers/chatTools.js`, `api/ai/_handlers/chat.js`
- Modify: `api/ai/dispatch.js`
- Test: `api/__tests__/chat.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/__tests__/chat.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
const MODELS = [
  { id: "claude-opus-5-5", created_at: "2026-09-01T00:00:00Z" },
  { id: "claude-sonnet-5", created_at: "2026-05-01T00:00:00Z" },
  { id: "claude-sonnet-5-5", created_at: "2026-08-01T00:00:00Z" },
];

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class Anthropic {
    constructor() {
      this.messages = { create };
      this.models = { list: () => (async function* () { yield* MODELS; })() };
    }
  }
  Anthropic.APIError = APIError;
  Anthropic.RateLimitError = RateLimitError;
  Anthropic.BadRequestError = BadRequestError;
  return { default: Anthropic };
});
vi.mock("../meetings/_lib/cors.js", () => ({ applyCors: () => false }));
vi.mock("../meetings/_lib/auth.js", () => ({ requireAuth: async () => true }));

const { pickLatestSonnet, resetModelCache } = await import("../ai/_handlers/chatModels.js");
const { costUsd } = await import("../ai/_handlers/chatPricing.js");
const { default: chat } = await import("../ai/_handlers/chat.js");
const { TOOLS } = await import("../ai/_handlers/chatTools.js");

function fakeRes() {
  const res = { statusCode: 0, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const req = (body) => ({ method: "POST", headers: {}, body });

beforeEach(() => {
  create.mockReset();
  resetModelCache();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("pickLatestSonnet", () => {
  it("picks the newest claude-sonnet-* by created_at", () => {
    expect(pickLatestSonnet(MODELS)).toBe("claude-sonnet-5-5");
  });
  it("throws when there is no Sonnet", () => {
    expect(() => pickLatestSonnet([{ id: "claude-opus-5-5", created_at: "2026-01-01" }])).toThrow("no Sonnet");
  });
});

describe("costUsd", () => {
  it("prices a known model", () => {
    const c = costUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 });
    expect(c).toBeCloseTo(2 + 1 + 0.2, 6);
  });
  it("returns null for an unknown model", () => {
    expect(costUsd("claude-sonnet-9", { input_tokens: 1 })).toBeNull();
  });
});

describe("TOOLS", () => {
  it("every tool is strict with a closed schema", () => {
    for (const t of TOOLS) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });
});

describe("POST /api/ai/chat", () => {
  it("runs one call on the latest Sonnet and returns content + cost", async () => {
    create.mockResolvedValue({
      model: "claude-sonnet-5-5", stop_reason: "end_turn",
      content: [{ type: "text", text: "Hi" }],
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const res = fakeRes();
    await chat(req({ messages: [{ role: "user", content: "hi" }] }), res);
    expect(res.statusCode).toBe(200);
    expect(create.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
    expect(create.mock.calls[0][0].tool_choice).toEqual({ type: "auto" });
    expect(res.body.content).toEqual([{ type: "text", text: "Hi" }]);
    expect(res.body.costUsd).toBeCloseTo(0.003, 6);
  });

  it("400s without messages", async () => {
    const res = fakeRes();
    await chat(req({}), res);
    expect(res.statusCode).toBe(400);
  });

  it("reports a refusal as 502 and still returns its cost", async () => {
    create.mockResolvedValue({
      model: "claude-sonnet-5-5", stop_reason: "refusal", stop_details: { category: "cyber" },
      content: [], usage: { input_tokens: 1000, output_tokens: 0 },
    });
    const res = fakeRes();
    await chat(req({ messages: [{ role: "user", content: "x" }] }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/declined/);
    expect(res.body.costUsd).toBeCloseTo(0.002, 6);
  });

  it("passes an API 400 through verbatim", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    create.mockRejectedValue(new Anthropic.BadRequestError(400, "tool_choice not supported"));
    const res = fakeRes();
    await chat(req({ messages: [{ role: "user", content: "x" }] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("tool_choice not supported");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run api/__tests__/chat.test.js`
Expected: FAIL — `Failed to resolve import "../ai/_handlers/chatModels.js"`.

- [ ] **Step 3: Write `chatModels.js`**

```js
// api/ai/_handlers/chatModels.js
//
// Board Chat always runs the newest Sonnet the API serves, so it upgrades with
// no code change (Andy, 2026-10-21). Resolved from the Models API, memoized
// per warm serverless instance. No hard-coded fallback: if the list fails,
// the request fails loudly.
const TTL_MS = 60 * 60 * 1000;
let cached = null;

export function pickLatestSonnet(models) {
  const sonnets = models.filter((m) => typeof m.id === "string" && m.id.startsWith("claude-sonnet-"));
  if (sonnets.length === 0) throw new Error("Models API returned no Sonnet models");
  sonnets.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return sonnets[0].id;
}

export async function resolveLatestSonnet(client, now = Date.now()) {
  if (cached && now - cached.at < TTL_MS) return cached.id;
  const models = [];
  for await (const m of client.models.list()) models.push(m);
  const id = pickLatestSonnet(models);
  cached = { id, at: now };
  return id;
}

export function resetModelCache() {
  cached = null;
}
```

- [ ] **Step 4: Write `chatPricing.js`**

```js
// api/ai/_handlers/chatPricing.js
//
// USD per million tokens, Anthropic first-party rates (claude-api skill price
// table, cached 2026-10-06). cacheWrite = 5-minute cache write (1.25x input).
// A model missing here prices as null and the panel shows "unpriced" — when
// the latest Sonnet changes, add its row.
export const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

export function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  return (
    (usage.input_tokens || 0) * p.input
    + (usage.output_tokens || 0) * p.output
    + (usage.cache_creation_input_tokens || 0) * p.cacheWrite
    + (usage.cache_read_input_tokens || 0) * p.cacheRead
  ) / 1_000_000;
}
```

- [ ] **Step 5: Write `chatTools.js`**

```js
// api/ai/_handlers/chatTools.js
//
// Board Chat system prompt + tool schemas. The tools EXECUTE in the browser
// (src/lib/boardChat/tools.js, BoardChatPanel); only their schemas live here.
// Every tool is strict: closed objects, optional fields omitted when unused.

export const SYSTEM_PROMPT = `You are Board Chat, the assistant on Vistamar Consulting's internal Task Board. You help the signed-in team member understand and update the board.

The first message contains BOARD CONTEXT: who the user is, the current time and timezone, members, organizations, categories, tags, statuses, and every non-archived task and subtask. "I" / "me" / "my" means the user named there. Item ids are in the first column; refer to items in replies by ref and title (e.g. "I-12 Appointment import"), never by raw id.

Reading:
- Answer from BOARD CONTEXT when it is enough. Call get_item for an item's description, subtasks or recent comments. Call search_items to find archived items or match description text.
- Call list_meetings for questions about meetings. Dates are YYYY-MM-DD in the user's timezone.
- If the data does not answer the question, say what is missing. Never guess a status, owner or date.

Filtering:
- When the user asks to see, show, list or filter items on the board, call set_board_filter. Use columnFilters when a column filter expresses the request exactly. Otherwise pass aiFilter with the exact ids of the tasks and subtasks in question and a 2-4 word label. Use clear: true to reset.

Changing the board:
- Every create, update or delete goes through ONE propose_changes call per request, listing every op. The user reviews it in a modal and may untick ops. Nothing is changed until its result says "applied".
- Never say a change was made unless the propose_changes result lists it as applied. Report declined or unticked ops plainly.
- Use only existing members, organizations, categories and tags (by id). Allowed statusId values: 1 Assigned, 2 In Progress, 9 Blocked, 4 Review, 5 Done, 7 Archive.
- A subtask's parent is a top-level item (parentRef = its id, or the tempId of a create earlier in the same call). Subtasks cannot have subtasks.
- If it is unclear which items the user means, ask before proposing.

Style: plain text, short. Simple "- " lists are fine; no tables, no headings.`;

const FIELDS = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    statusId: { type: "integer", enum: [1, 2, 9, 4, 5, 7] },
    assigneeIds: { type: "array", items: { type: "string" } },
    dueDate: { type: "string", description: "YYYY-MM-DD" },
    priorityId: { type: "integer", enum: [1, 2, 3, 4] },
    categoryId: { type: "string" },
    tagIds: { type: "array", items: { type: "string" } },
  },
};

export const TOOLS = [
  {
    name: "get_item",
    description: "Full detail for one item: description, subtasks, and its 5 most recent comments.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "search_items",
    description: "Keyword search over item titles and descriptions. Every word must match. Returns up to 50 items and the total match count.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        query: { type: "string" },
        includeArchived: { type: "boolean" },
      },
      required: ["query", "includeArchived"],
    },
  },
  {
    name: "list_meetings",
    description: "Team meetings between two dates (inclusive), with start/end times and attendee emails.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "set_board_filter",
    description: "Change what the Task Board shows. Fields you omit keep their current value. clear: true first resets every filter.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        clear: { type: "boolean" },
        orgId: { type: "string", description: "An organization id, or \"all\"." },
        titleSearch: { type: "string" },
        columnFilters: {
          type: "object", additionalProperties: false,
          properties: {
            statusId: { type: "array", items: { type: "integer" } },
            assigneeIds: { type: "array", items: { type: "string" } },
            priorityId: { type: "array", items: { type: "integer" } },
            categoryId: { type: "array", items: { type: "string" } },
            tagIds: { type: "array", items: { type: "string" } },
          },
        },
        aiFilter: {
          type: "object", additionalProperties: false,
          properties: {
            label: { type: "string" },
            itemIds: { type: "array", items: { type: "string" } },
          },
          required: ["label", "itemIds"],
        },
      },
      required: ["clear"],
    },
  },
  {
    name: "propose_changes",
    description: "Propose creates, updates and deletes. The user confirms in a modal; the result says which ops were applied.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        summary: { type: "string" },
        ops: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              op: { type: "string", enum: ["create", "update", "delete"] },
              reason: { type: "string" },
              tempId: { type: "string", description: "create only: a short id other ops can use as parentRef." },
              itemId: { type: "string", description: "update/delete only." },
              orgId: { type: "string", description: "create of a top-level item only." },
              parentRef: { type: "string", description: "create of a subtask only: parent item id or an earlier create's tempId." },
              fields: FIELDS,
              clear: { type: "array", items: { type: "string", enum: ["dueDate", "priorityId", "categoryId"] } },
            },
            required: ["op", "reason"],
          },
        },
      },
      required: ["summary", "ops"],
    },
  },
];
```

- [ ] **Step 6: Write `chat.js`**

```js
// api/ai/_handlers/chat.js
//
// Board Chat — ONE model call per request. The browser owns the tool loop: it
// runs the tools, appends tool_result blocks and POSTs again. Stateless; the
// browser sends the full append-only history every call (thinking blocks
// included, unchanged — required for preserved thinking on current models).
import Anthropic from "@anthropic-ai/sdk";
import { applyCors } from "../../meetings/_lib/cors.js";
import { requireAuth } from "../../meetings/_lib/auth.js";
import { resolveLatestSonnet } from "./chatModels.js";
import { costUsd } from "./chatPricing.js";
import { SYSTEM_PROMPT, TOOLS } from "./chatTools.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing required field: messages" });
  }

  const client = new Anthropic({ apiKey });
  let model;
  try {
    model = await resolveLatestSonnet(client);
  } catch (err) {
    return res.status(502).json({ error: `Could not resolve the latest Sonnet model: ${err.message}` });
  }

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });
    const cost = costUsd(message.model, message.usage);

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category;
      return res.status(502).json({
        error: `The model declined this request${category ? ` (${category})` : ""}.`,
        model: message.model,
        costUsd: cost,
      });
    }
    if (message.stop_reason === "max_tokens") {
      return res.status(502).json({ error: "The reply was cut off (token limit).", model: message.model, costUsd: cost });
    }
    return res.status(200).json({
      content: message.content,
      stopReason: message.stop_reason,
      model: message.model,
      usage: message.usage,
      costUsd: cost,
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Rate limited by the Anthropic API — try again in a minute." });
    }
    if (err instanceof Anthropic.BadRequestError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Anthropic API error ${err.status}: ${err.message}` });
    }
    return res.status(500).json({ error: err.message });
  }
}
```

- [ ] **Step 7: Register the route** in `api/ai/dispatch.js`

```js
import chat from "./_handlers/chat.js";
import generate from "./_handlers/generate.js";
import prepare from "./_handlers/prepare.js";
import refine from "./_handlers/refine.js";
```

```js
const ROUTES = { chat, generate, prepare, refine };
```

**Known risk — strict schema size.** Across the strict tools there are about 23 optional parameters. A limit on optional parameters in strict schemas was mentioned in review but couldn't be confirmed in the skill docs. The first real call (Task 11) exercises it. If the API returns a 400 about schema complexity, the panel shows it verbatim. The fix is then to drop `strict` from `set_board_filter` and `propose_changes`, whose inputs `applyBoardFilter` and `proposal.js` already validate fully. That is a real fix, not a mask. Record whichever applies in the session context.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run api/__tests__/chat.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 9: Commit**

```bash
git add api/ai/_handlers/chatModels.js api/ai/_handlers/chatPricing.js api/ai/_handlers/chatTools.js api/ai/_handlers/chat.js api/ai/dispatch.js api/__tests__/chat.test.js
git commit -m "feat(board-chat): /api/ai/chat on latest Sonnet with cost"
```

---

### Task 6: Board snapshot

**Files:**
- Create: `src/lib/boardChat/snapshot.js`
- Test: `src/lib/boardChat/__tests__/snapshot.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/boardChat/__tests__/snapshot.test.js
import { describe, it, expect } from "vitest";
import { buildBoardSnapshot, itemRef, memberName, toMillis, ymd } from "../snapshot.js";

const users = [{ id: "u1", displayName: "Andy Deemer", email: "a@vistamarconsulting.com" }, { id: "u2", firstName: "Scot", lastName: "R", email: "s@x.com" }];
const orgs = [{ id: "unio", name: "Unio" }];
const categories = [{ id: "c1", name: "Data" }];
const tags = [{ id: "t1", name: "hipaa" }];
const items = [
  { id: "p1", itemNumber: 4, title: "Appointment data", organizationId: "unio", parentId: null, statusId: 2, assigneeIds: ["u1"], priorityId: 2, categoryId: "c1", tagIds: ["t1"], dueDate: new Date(2026, 9, 24), updatedAt: new Date(1000) },
  { id: "s1", itemNumber: 1, title: "Import script", organizationId: "unio", parentId: "p1", statusId: 5, assigneeIds: ["u2"], updatedAt: new Date(2000) },
  { id: "z1", itemNumber: 9, title: "Old thing", organizationId: "unio", parentId: null, statusId: 7, updatedAt: new Date(3000) },
];

describe("snapshot helpers", () => {
  it("formats refs, names, dates", () => {
    expect(itemRef(items[0])).toBe("I-4");
    expect(itemRef(items[1])).toBe("SI-1");
    expect(memberName(users[1])).toBe("Scot R");
    expect(ymd(new Date(2026, 9, 24))).toBe("2026-10-24");
    expect(toMillis({ toMillis: () => 5 })).toBe(5);
    expect(toMillis(null)).toBeNull();
  });
});

describe("buildBoardSnapshot", () => {
  const snap = buildBoardSnapshot({ items, users, orgs, categories, tags });
  it("lists live items with readable values and excludes archived", () => {
    expect(snap.text).toContain("p1 | I-4 | Unio | - | In Progress | Andy Deemer | High | Data | hipaa | 2026-10-24 |");
    expect(snap.text).toContain("s1 | SI-1 | Unio | p1 | Done | Scot R |");
    expect(snap.text).not.toContain("Old thing");
  });
  it("lists members with ids for writes", () => {
    expect(snap.text).toContain("u1 | Andy Deemer | a@vistamarconsulting.com");
  });
  it("records what the model saw", () => {
    expect(snap.seen).toEqual({ p1: 1000, s1: 2000 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/boardChat/__tests__/snapshot.test.js`
Expected: FAIL — cannot resolve `../snapshot.js`.

- [ ] **Step 3: Implement**

```js
// src/lib/boardChat/snapshot.js
//
// Board → the compact BOARD CONTEXT text Board Chat sends once per
// conversation, plus `seen`: the updatedAt (ms) of every item the model was
// shown — the staleness baseline for the change modal.
import { STATUS, STATUS_OPTIONS } from "../../constants/itemStatuses.js";
import { PRIORITY_LIST } from "../../constants/itemPriorities.js";
import { tsToDate } from "../../utils/firestoreTime.js";

const STATUS_NAME = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id, s.name]));
const PRIORITY_NAME = Object.fromEntries(PRIORITY_LIST.map((p) => [p.id, p.label]));

export function toMillis(ts) {
  if (!ts) return null;
  if (ts.toMillis) return ts.toMillis();
  const d = tsToDate(ts);
  return d ? d.getTime() : null;
}

export function ymd(ts) {
  const d = tsToDate(ts);
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function itemRef(item) {
  return `${item.parentId ? "SI" : "I"}-${item.itemNumber ?? "?"}`;
}

export function memberName(u) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return (u.displayName || full || u.email || u.id || "").trim();
}

export function statusName(id) {
  return STATUS_NAME[id] || String(id ?? "");
}

export function priorityName(id) {
  return PRIORITY_NAME[id] || "";
}

export function makeLookups({ users, orgs, categories, tags }) {
  const by = (list, label) => new Map(list.map((x) => [x.id, label(x)]));
  const userName = by(users, memberName);
  const orgName = by(orgs, (o) => o.name || o.id);
  const categoryName = by(categories, (c) => c.name || c.id);
  const tagName = by(tags, (t) => t.name || t.id);
  return {
    userName: (id) => userName.get(id) || id,
    orgName: (id) => orgName.get(id) || id,
    categoryName: (id) => categoryName.get(id) || id,
    tagName: (id) => tagName.get(id) || id,
  };
}

export function itemRow(item, L) {
  return [
    item.id,
    itemRef(item),
    L.orgName(item.organizationId),
    item.parentId || "-",
    statusName(item.statusId),
    (item.assigneeIds || []).map(L.userName).join(", "),
    priorityName(item.priorityId),
    item.categoryId ? L.categoryName(item.categoryId) : "",
    (item.tagIds || []).map(L.tagName).join(", "),
    ymd(item.dueDate),
    ymd(item.updatedAt),
    item.title || "(untitled)",
  ].join(" | ");
}

export function buildBoardSnapshot({ items, users, orgs, categories, tags }) {
  const L = makeLookups({ users, orgs, categories, tags });
  const live = items.filter((i) => i.statusId !== STATUS.ARCHIVE);
  const text = [
    "MEMBERS (id | name | email)",
    ...users.map((u) => `${u.id} | ${memberName(u)} | ${u.email || ""}`),
    "",
    "ORGANIZATIONS (id | name)",
    ...orgs.map((o) => `${o.id} | ${o.name || o.id}`),
    "",
    "CATEGORIES (id | name)",
    ...categories.map((c) => `${c.id} | ${c.name || c.id}`),
    "",
    "TAGS (id | name)",
    ...tags.map((t) => `${t.id} | ${t.name || t.id}`),
    "",
    `STATUSES: ${STATUS_OPTIONS.filter((s) => s.id !== 8).map((s) => `${s.id} ${s.name}`).join(", ")}`,
    `PRIORITIES: ${PRIORITY_LIST.map((p) => `${p.id} ${p.label}`).join(", ")}`,
    "",
    "ITEMS, not archived (id | ref | org | parentId | status | assignees | priority | category | tags | due | updated | title)",
    ...live.map((i) => itemRow(i, L)),
  ].join("\n");
  const seen = Object.fromEntries(live.map((i) => [i.id, toMillis(i.updatedAt)]));
  return { text, seen };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/boardChat/__tests__/snapshot.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boardChat/snapshot.js src/lib/boardChat/__tests__/snapshot.test.js
git commit -m "feat(board-chat): board snapshot context"
```

---

### Task 7: Proposal layer — validate, diff, stale, completedAt, change set

**Files:**
- Create: `src/lib/boardChat/proposal.js`
- Test: `src/lib/boardChat/__tests__/proposal.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/boardChat/__tests__/proposal.test.js
import { describe, it, expect } from "vitest";
import { buildReviewRows, toChangeSet } from "../proposal.js";

const NOW = "NOW";
const items = [
  { id: "p1", parentId: null, organizationId: "unio", title: "Appt data", statusId: 2, updatedAt: new Date(1000), assigneeIds: [] },
  { id: "s1", parentId: "p1", organizationId: "unio", title: "Import", statusId: 5, updatedAt: new Date(2000), assigneeIds: [] },
  { id: "s2", parentId: "p1", organizationId: "unio", title: "Schema", statusId: 1, updatedAt: new Date(9000), assigneeIds: [] },
];
const ctx = {
  items,
  orgIds: new Set(["unio"]),
  memberIds: new Set(["u1"]),
  categoryIds: new Set(["c1"]),
  tagIds: new Set(["t1"]),
  seen: { p1: 1000, s1: 2000, s2: 5000 },
  now: NOW,
};

describe("buildReviewRows", () => {
  it("moving to Done stamps completedAt; leaving Done clears it", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "p1", reason: "r", fields: { statusId: 5 } },
      { op: "update", itemId: "s1", reason: "r", fields: { statusId: 2 } },
    ], ctx);
    expect(rows[0].patch).toEqual({ statusId: 5, completedAt: NOW });
    expect(rows[1].patch).toEqual({ statusId: 2, completedAt: null });
    expect(rows[0].diffs).toEqual([{ field: "statusId", before: 2, after: 5 }]);
  });

  it("flags an item changed since the model last saw it", () => {
    const rows = buildReviewRows([{ op: "update", itemId: "s2", reason: "r", fields: { title: "Schema v2" } }], ctx);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].stale).toBe(true);
  });

  it("rejects unknown ids, statuses and members", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "nope", reason: "r", fields: { title: "x" } },
      { op: "update", itemId: "p1", reason: "r", fields: { statusId: 8 } },
      { op: "update", itemId: "p1", reason: "r", fields: { assigneeIds: ["ghost"] } },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([false, false, false]);
    expect(rows[0].error).toMatch(/not found/);
  });

  it("rejects a second op on the same item", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "p1", reason: "r", fields: { title: "x" } },
      { op: "delete", itemId: "p1", reason: "r" },
    ], ctx);
    expect(rows[1].ok).toBe(false);
  });

  it("delete carries the cascade", () => {
    const [row] = buildReviewRows([{ op: "delete", itemId: "p1", reason: "r" }], ctx);
    expect(row.cascadeIds).toEqual(["s1", "s2"]);
  });

  it("creates: top-level needs orgId; subtask inherits parent org; tempId parents resolve", () => {
    const rows = buildReviewRows([
      { op: "create", tempId: "a", orgId: "unio", reason: "r", fields: { title: "Proj", dueDate: "2026-10-30" } },
      { op: "create", tempId: "b", parentRef: "a", reason: "r", fields: { title: "Step 1" } },
      { op: "create", tempId: "c", parentRef: "s1", reason: "r", fields: { title: "Nested" } },
      { op: "create", tempId: "d", reason: "r", fields: { title: "No org" } },
    ], ctx);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].fields.dueDate).toEqual(new Date(2026, 9, 30));
    expect(rows[0].fields.createdVia).toBe("board-chat");
    expect(rows[1]).toMatchObject({ ok: true, orgId: "unio", parentTempId: "a" });
    expect(rows[2].ok).toBe(false);
    expect(rows[3].ok).toBe(false);
  });

  it("clear nulls a field", () => {
    const [row] = buildReviewRows([{ op: "update", itemId: "p1", reason: "r", clear: ["dueDate"] }], { ...ctx, items: [{ ...items[0], dueDate: new Date(5) }] });
    expect(row.patch).toEqual({ dueDate: null });
  });
});

describe("toChangeSet", () => {
  it("keeps checked rows and drops children of an unchecked parent create", () => {
    const rows = buildReviewRows([
      { op: "create", tempId: "a", orgId: "unio", reason: "r", fields: { title: "Proj" } },
      { op: "create", tempId: "b", parentRef: "a", reason: "r", fields: { title: "Step" } },
      { op: "update", itemId: "p1", reason: "r", fields: { title: "Renamed" } },
    ], ctx);
    const { ops, skipped } = toChangeSet(rows, new Set([1, 2]));
    expect(ops).toEqual([{ kind: "update", itemId: "p1", patch: { title: "Renamed" } }]);
    expect(skipped).toEqual([{ index: 1, reason: "its parent create was not applied" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/boardChat/__tests__/proposal.test.js`
Expected: FAIL — cannot resolve `../proposal.js`.

- [ ] **Step 3: Implement**

```js
// src/lib/boardChat/proposal.js
//
// Turns a propose_changes call into review rows for the change modal, then
// the accepted rows into a change set for itemWrites.applyChangeSet. Pure.
//
// Rules: one op per item; only existing members/orgs/categories/tags; status
// in the allowed set (never AI Gen); subtasks only under top-level items.
// Moving to Done stamps completedAt and leaving Done clears it — Board Chat
// only (the board's manual edits are unchanged).
import { STATUS } from "../../constants/itemStatuses.js";
import { toMillis } from "./snapshot.js";

export const ALLOWED_STATUS_IDS = [1, 2, 9, 4, 5, 7];
const PRIORITY_IDS = [1, 2, 3, 4];

export function parseDueDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) throw new Error(`Bad dueDate "${s}" (want YYYY-MM-DD)`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function normalizeFields(fields = {}, ctx) {
  const out = {};
  if (fields.title !== undefined) {
    if (!fields.title.trim()) throw new Error("Title cannot be empty");
    out.title = fields.title.trim();
  }
  if (fields.description !== undefined) out.description = fields.description;
  if (fields.statusId !== undefined) {
    if (!ALLOWED_STATUS_IDS.includes(fields.statusId)) throw new Error(`Status ${fields.statusId} is not allowed`);
    out.statusId = fields.statusId;
  }
  if (fields.assigneeIds !== undefined) {
    const bad = fields.assigneeIds.filter((id) => !ctx.memberIds.has(id));
    if (bad.length) throw new Error(`Unknown member ${bad.join(", ")}`);
    out.assigneeIds = fields.assigneeIds;
  }
  if (fields.dueDate !== undefined) out.dueDate = parseDueDate(fields.dueDate);
  if (fields.priorityId !== undefined) {
    if (!PRIORITY_IDS.includes(fields.priorityId)) throw new Error(`Priority ${fields.priorityId} is not allowed`);
    out.priorityId = fields.priorityId;
  }
  if (fields.categoryId !== undefined) {
    if (!ctx.categoryIds.has(fields.categoryId)) throw new Error(`Unknown category ${fields.categoryId}`);
    out.categoryId = fields.categoryId;
  }
  if (fields.tagIds !== undefined) {
    const bad = fields.tagIds.filter((id) => !ctx.tagIds.has(id));
    if (bad.length) throw new Error(`Unknown tag ${bad.join(", ")}`);
    out.tagIds = fields.tagIds;
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  || (a instanceof Date || b instanceof Date ? toMillis(a) === toMillis(b) : false);

function buildRow(op, index, ctx, itemsById, childrenOf, tempCreates, touched) {
  const base = { index, op: op.op, reason: op.reason, ok: true, error: null, stale: false };

  if (op.op === "create") {
    const fields = { ...normalizeFields(op.fields, ctx), createdVia: "board-chat" };
    if (!fields.title) throw new Error("A new item needs a title");
    if (fields.statusId === STATUS.DONE) fields.completedAt = ctx.now;
    if (op.tempId && tempCreates.has(op.tempId)) throw new Error(`Duplicate tempId ${op.tempId}`);
    let row;
    if (op.parentRef) {
      const parentItem = itemsById.get(op.parentRef);
      const parentTemp = tempCreates.get(op.parentRef);
      if (parentItem) {
        if (parentItem.parentId) throw new Error("Subtasks cannot have subtasks");
        row = { ...base, tempId: op.tempId || `op${index}`, orgId: parentItem.organizationId, parentId: parentItem.id, parentTempId: null, fields };
      } else if (parentTemp) {
        if (parentTemp.parentId || parentTemp.parentTempId) throw new Error("Subtasks cannot have subtasks");
        row = { ...base, tempId: op.tempId || `op${index}`, orgId: parentTemp.orgId, parentId: null, parentTempId: parentTemp.tempId, fields };
      } else {
        throw new Error(`Parent ${op.parentRef} not found`);
      }
    } else {
      if (!ctx.orgIds.has(op.orgId)) throw new Error(`Organization ${op.orgId || "(none)"} not found`);
      row = { ...base, tempId: op.tempId || `op${index}`, orgId: op.orgId, parentId: null, parentTempId: null, fields };
    }
    tempCreates.set(row.tempId, row);
    return row;
  }

  const item = itemsById.get(op.itemId);
  if (!item) throw new Error(`Item ${op.itemId} not found`);
  if (touched.has(item.id)) throw new Error(`${op.itemId} already has a change in this proposal`);
  touched.add(item.id);
  const seen = ctx.seen[item.id];
  const stale = seen == null || (toMillis(item.updatedAt) ?? 0) > seen;

  if (op.op === "delete") {
    return { ...base, stale, itemId: item.id, cascadeIds: (childrenOf.get(item.id) || []).map((c) => c.id) };
  }

  const patch = normalizeFields(op.fields, ctx);
  for (const f of op.clear || []) patch[f] = null;
  if (patch.statusId !== undefined && patch.statusId !== item.statusId) {
    if (patch.statusId === STATUS.DONE) patch.completedAt = ctx.now;
    else if (item.statusId === STATUS.DONE) patch.completedAt = null;
  }
  const diffs = Object.keys(patch)
    .filter((f) => f !== "completedAt" && !same(item[f], patch[f]))
    .map((f) => ({ field: f, before: item[f] ?? null, after: patch[f] }));
  if (diffs.length === 0) throw new Error("No change from the current values");
  return { ...base, stale, itemId: item.id, patch, diffs };
}

export function buildReviewRows(ops, ctx) {
  const itemsById = new Map(ctx.items.map((i) => [i.id, i]));
  const childrenOf = new Map();
  for (const i of ctx.items) {
    if (i.parentId) childrenOf.set(i.parentId, [...(childrenOf.get(i.parentId) || []), i]);
  }
  const tempCreates = new Map();
  const touched = new Set();
  return ops.map((op, index) => {
    try {
      return buildRow(op, index, ctx, itemsById, childrenOf, tempCreates, touched);
    } catch (err) {
      return { index, op: op.op, reason: op.reason, itemId: op.itemId, ok: false, error: err.message, stale: false };
    }
  });
}

// Accepted rows → applyChangeSet ops. A create whose tempId parent was not
// accepted is skipped and reported.
export function toChangeSet(rows, checked) {
  const ops = [];
  const skipped = [];
  const acceptedTemps = new Set();
  for (const r of rows) {
    if (!r.ok || !checked.has(r.index)) continue;
    if (r.op === "create") {
      if (r.parentTempId && !acceptedTemps.has(r.parentTempId)) {
        skipped.push({ index: r.index, reason: "its parent create was not applied" });
        continue;
      }
      acceptedTemps.add(r.tempId);
      ops.push({ kind: "create", tempId: r.tempId, orgId: r.orgId, parentId: r.parentId, parentTempId: r.parentTempId, fields: r.fields });
    } else if (r.op === "update") {
      ops.push({ kind: "update", itemId: r.itemId, patch: r.patch });
    } else {
      ops.push({ kind: "delete", itemId: r.itemId, cascadeIds: r.cascadeIds });
    }
  }
  return { ops, skipped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/boardChat/__tests__/proposal.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boardChat/proposal.js src/lib/boardChat/__tests__/proposal.test.js
git commit -m "feat(board-chat): proposal validation, diffs, staleness, change set"
```

---

### Task 8: Read tools, API client, conversation loop

**Files:**
- Create: `src/lib/boardChat/tools.js`, `src/lib/boardChat/api.js`, `src/lib/boardChat/conversation.js`
- Test: `src/lib/boardChat/__tests__/tools.test.js`, `src/lib/boardChat/__tests__/conversation.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/boardChat/__tests__/tools.test.js
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: () => ({}), query: () => ({}), orderBy: () => ({}), limit: () => ({}),
  getDocs: async () => ({ docs: [{ data: () => ({ authorId: "u1", body: "Done with import", createdAt: new Date(2026, 9, 20) }) }] }),
}));
const listMeetings = vi.fn();
vi.mock("../../meetingsApi.js", () => ({ listMeetings: (...a) => listMeetings(...a) }));

const { runReadTool } = await import("../tools.js");

const items = [
  { id: "p1", parentId: null, itemNumber: 4, title: "Appointment data", description: "Load into db", statusId: 2, organizationId: "unio", updatedAt: new Date(1000) },
  { id: "s1", parentId: "p1", itemNumber: 1, title: "Import", statusId: 5, organizationId: "unio", updatedAt: new Date(2000) },
  { id: "z1", parentId: null, itemNumber: 9, title: "Appointment archive", statusId: 7, organizationId: "unio", updatedAt: new Date(3000) },
];
const ctx = {
  items,
  lookups: { userName: (id) => id, orgName: (id) => id, categoryName: (id) => id, tagName: (id) => id },
};

describe("runReadTool", () => {
  it("get_item returns detail, subtasks, comments and seen", async () => {
    const out = await runReadTool("get_item", { itemId: "p1" }, ctx);
    expect(out.result.description).toBe("Load into db");
    expect(out.result.subtasks).toHaveLength(1);
    expect(out.result.recentComments[0].body).toBe("Done with import");
    expect(out.seen).toEqual({ p1: 1000, s1: 2000 });
  });

  it("get_item throws for an unknown id", async () => {
    await expect(runReadTool("get_item", { itemId: "x" }, ctx)).rejects.toThrow("No item");
  });

  it("search_items matches every word and respects includeArchived", async () => {
    const live = await runReadTool("search_items", { query: "appointment", includeArchived: false }, ctx);
    expect(live.result.total).toBe(1);
    const all = await runReadTool("search_items", { query: "appointment", includeArchived: true }, ctx);
    expect(all.result.total).toBe(2);
  });

  it("list_meetings trims the API shape", async () => {
    listMeetings.mockResolvedValue({ meetings: [{ title: "BMD sync", date: "2026-10-21T17:00:00Z", end_date: "2026-10-21T17:30:00Z", attendees: [{ email: "a@x.com" }], event_id: "e" }] });
    const out = await runReadTool("list_meetings", { startDate: "2026-10-21", endDate: "2026-10-21" }, ctx);
    expect(out.result.meetings).toEqual([{ title: "BMD sync", start: "2026-10-21T17:00:00Z", end: "2026-10-21T17:30:00Z", attendees: ["a@x.com"] }]);
    const arg = listMeetings.mock.calls[0][0];
    expect(new Date(arg.start).getDate()).toBe(21);
  });
});
```

```js
// src/lib/boardChat/__tests__/conversation.test.js
import { describe, it, expect, vi } from "vitest";
import { MAX_CALLS_PER_TURN, formatUsd, runTurn } from "../conversation.js";

const user = { role: "user", content: "hi" };

describe("runTurn", () => {
  it("loops through a tool call and sums cost", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0.01, content: [{ type: "tool_use", id: "t1", name: "get_item", input: { itemId: "p1" } }] })
      .mockResolvedValueOnce({ stopReason: "end_turn", costUsd: 0.02, content: [{ type: "text", text: "Done" }] });
    const executeTool = vi.fn().mockResolvedValue({ result: { ok: 1 }, step: "Read I-4" });
    const out = await runTurn({ messages: [user], post, executeTool });
    expect(out.done).toBe(true);
    expect(out.turn.costUsd).toBeCloseTo(0.03, 6);
    expect(out.turn.steps).toEqual(["Read I-4"]);
    expect(out.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"ok\":1}" }] });
    expect(out.messages[3].content[0].text).toBe("Done");
  });

  it("returns a tool failure to the model as is_error", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0, content: [{ type: "tool_use", id: "t1", name: "get_item", input: {} }] })
      .mockResolvedValueOnce({ stopReason: "end_turn", costUsd: 0, content: [] });
    const out = await runTurn({ messages: [user], post, executeTool: async () => { throw new Error("No item x"); } });
    expect(out.messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "t1", content: "No item x", is_error: true });
  });

  it("marks unpriced when a call has no cost", async () => {
    const post = vi.fn().mockResolvedValue({ stopReason: "end_turn", costUsd: null, content: [] });
    const out = await runTurn({ messages: [user], post, executeTool: vi.fn() });
    expect(out.turn.unpriced).toBe(true);
  });

  it("stops at the call cap", async () => {
    const post = vi.fn().mockResolvedValue({ stopReason: "tool_use", costUsd: 0, content: [{ type: "tool_use", id: "t", name: "x", input: {} }] });
    const out = await runTurn({ messages: [user], post, executeTool: async () => ({ result: {}, step: "x" }) });
    expect(out.done).toBe(false);
    expect(post).toHaveBeenCalledTimes(MAX_CALLS_PER_TURN);
  });

  it("an API error carries the messages so far, for Retry, and its cost", async () => {
    const err = Object.assign(new Error("boom"), { costUsd: 0.004, model: "m" });
    const post = vi.fn().mockRejectedValue(err);
    await expect(runTurn({ messages: [user], post, executeTool: vi.fn() })).rejects.toMatchObject({ messages: [user], turn: { costUsd: 0.004 } });
  });
});

describe("formatUsd", () => {
  it("shows 4 decimals under a cent, 2 above", () => {
    expect(formatUsd(0.00412)).toBe("$0.0041");
    expect(formatUsd(0.5)).toBe("$0.50");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/boardChat/__tests__/tools.test.js src/lib/boardChat/__tests__/conversation.test.js`
Expected: FAIL — cannot resolve `../tools.js` / `../conversation.js`.

- [ ] **Step 3: Implement `tools.js`**

```js
// src/lib/boardChat/tools.js
//
// Board Chat read tools, executed in the browser. Each returns
// { result, seen } — `seen` refreshes the staleness baseline for every item
// the model was just shown.
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase.js";
import { listMeetings } from "../meetingsApi.js";
import { STATUS } from "../../constants/itemStatuses.js";
import { itemRef, priorityName, statusName, toMillis, ymd } from "./snapshot.js";

const SEARCH_LIMIT = 50;

function brief(item, L) {
  return {
    id: item.id,
    ref: itemRef(item),
    title: item.title || "(untitled)",
    org: L.orgName(item.organizationId),
    parentId: item.parentId || null,
    status: statusName(item.statusId),
    assignees: (item.assigneeIds || []).map(L.userName),
    priority: priorityName(item.priorityId),
    category: item.categoryId ? L.categoryName(item.categoryId) : "",
    tags: (item.tagIds || []).map(L.tagName),
    due: ymd(item.dueDate),
    updated: ymd(item.updatedAt),
  };
}

function dayBounds(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  return {
    start: new Date(sy, sm - 1, sd, 0, 0, 0).toISOString(),
    end: new Date(ey, em - 1, ed, 23, 59, 59).toISOString(),
  };
}

export async function runReadTool(name, input, { items, lookups: L }) {
  if (name === "get_item") {
    const item = items.find((i) => i.id === input.itemId);
    if (!item) throw new Error(`No item with id ${input.itemId}`);
    const subs = items.filter((i) => i.parentId === item.id);
    const snap = await getDocs(query(collection(db, "items", item.id, "comments"), orderBy("createdAt", "desc"), limit(5)));
    const recentComments = snap.docs.map((d) => {
      const c = d.data();
      return { author: L.userName(c.authorId), body: c.body, date: ymd(c.createdAt) };
    });
    const seen = { [item.id]: toMillis(item.updatedAt) };
    subs.forEach((s) => { seen[s.id] = toMillis(s.updatedAt); });
    return {
      result: { ...brief(item, L), description: item.description || "", subtasks: subs.map((s) => brief(s, L)), recentComments },
      seen,
    };
  }

  if (name === "search_items") {
    const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = items.filter((i) => {
      if (!input.includeArchived && i.statusId === STATUS.ARCHIVE) return false;
      const text = `${i.title || ""} ${i.description || ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const shown = matches.slice(0, SEARCH_LIMIT);
    return {
      result: { total: matches.length, shown: shown.length, items: shown.map((i) => brief(i, L)) },
      seen: Object.fromEntries(shown.map((i) => [i.id, toMillis(i.updatedAt)])),
    };
  }

  if (name === "list_meetings") {
    const data = await listMeetings(dayBounds(input.startDate, input.endDate));
    const meetings = (data.meetings || []).map((m) => ({
      title: m.title || "(untitled)",
      start: m.date,
      end: m.end_date,
      attendees: (m.attendees || []).map((a) => a.email).filter(Boolean),
    }));
    return { result: { meetings }, seen: {} };
  }

  throw new Error(`Unknown tool ${name}`);
}
```

- [ ] **Step 4: Implement `api.js`**

```js
// src/lib/boardChat/api.js
import { auth } from "../../firebase.js";

// POST /api/ai/chat. Errors carry costUsd/model when the server billed the
// call anyway (refusal, cut-off), so the cost tracker stays honest.
export async function postChat(messages) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { costUsd: data.costUsd, model: data.model });
  }
  return data;
}
```

- [ ] **Step 5: Implement `conversation.js`**

```js
// src/lib/boardChat/conversation.js
//
// One user turn: POST, run any tool calls, POST again — until the model ends
// its turn or the call cap is hit. History is append-only: assistant content
// goes back exactly as received (thinking blocks included).
export const MAX_CALLS_PER_TURN = 10;

export function formatUsd(n) {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function addCost(turn, costUsd, billed) {
  if (typeof costUsd === "number") turn.costUsd += costUsd;
  else if (billed) turn.unpriced = true;
}

export async function runTurn({ messages: start, post, executeTool, onUpdate }) {
  let messages = start;
  const turn = { costUsd: 0, unpriced: false, steps: [] };
  for (let call = 0; call < MAX_CALLS_PER_TURN; call++) {
    let data;
    try {
      data = await post(messages);
    } catch (err) {
      addCost(turn, err.costUsd, Boolean(err.model));
      throw Object.assign(err, { messages, turn });
    }
    addCost(turn, data.costUsd, true);
    messages = [...messages, { role: "assistant", content: data.content }];
    onUpdate?.({ messages, turn });
    if (data.stopReason !== "tool_use") return { messages, turn, done: true };

    const results = [];
    for (const use of data.content.filter((b) => b.type === "tool_use")) {
      try {
        const out = await executeTool(use.name, use.input);
        turn.steps.push(out.step);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.result) });
      } catch (err) {
        turn.steps.push(`${use.name} failed`);
        results.push({ type: "tool_result", tool_use_id: use.id, content: err.message, is_error: true });
      }
    }
    messages = [...messages, { role: "user", content: results }];
    onUpdate?.({ messages, turn });
  }
  return { messages, turn, done: false };
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/lib/boardChat/__tests__/tools.test.js src/lib/boardChat/__tests__/conversation.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boardChat/tools.js src/lib/boardChat/api.js src/lib/boardChat/conversation.js src/lib/boardChat/__tests__/tools.test.js src/lib/boardChat/__tests__/conversation.test.js
git commit -m "feat(board-chat): read tools, API client, turn loop"
```

---

### Task 9: Change modal

**Files:**
- Create: `src/components/BoardChatChangesModal.jsx`
- Test: `src/components/__tests__/BoardChatChangesModal.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/__tests__/BoardChatChangesModal.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BoardChatChangesModal from "../BoardChatChangesModal.jsx";

const L = { userName: (id) => id, orgName: (id) => id, categoryName: (id) => id, tagName: (id) => id };
const itemLabel = (id) => ({ p1: "I-4 Appt data", s2: "SI-2 Schema" }[id] || id);
const rows = [
  { index: 0, op: "update", ok: true, stale: false, itemId: "p1", reason: "finished", patch: { statusId: 5 }, diffs: [{ field: "statusId", before: 2, after: 5 }] },
  { index: 1, op: "update", ok: true, stale: true, itemId: "s2", reason: "rename", patch: { title: "B" }, diffs: [{ field: "title", before: "A", after: "B" }] },
  { index: 2, op: "delete", ok: false, error: "Item x not found", itemId: "x", reason: "r" },
];

describe("BoardChatChangesModal", () => {
  it("shows diffs, unticks stale and invalid rows, applies the ticked ones", () => {
    const onApply = vi.fn();
    render(<BoardChatChangesModal open summary="Close out appt data" rows={rows} lookups={L} itemLabel={itemLabel} onApply={onApply} onCancel={vi.fn()} />);
    expect(screen.getByText("In Progress → Done")).toBeTruthy();
    expect(screen.getByText(/changed since Claude last read it/i)).toBeTruthy();
    expect(screen.getByText("Item x not found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(onApply).toHaveBeenCalledWith(new Set([0]));
  });

  it("re-ticking a stale row includes it", () => {
    const onApply = vi.fn();
    render(<BoardChatChangesModal open summary="s" rows={rows} lookups={L} itemLabel={itemLabel} onApply={onApply} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "SI-2 Schema" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 2 changes" }));
    expect(onApply).toHaveBeenCalledWith(new Set([0, 1]));
  });

  it("shows an apply error", () => {
    render(<BoardChatChangesModal open summary="s" rows={rows} lookups={L} itemLabel={itemLabel} onApply={vi.fn()} onCancel={vi.fn()} error="Item p1 no longer exists" />);
    expect(screen.getByText("Item p1 no longer exists")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/BoardChatChangesModal.test.jsx`
Expected: FAIL — cannot resolve `../BoardChatChangesModal.jsx`.

- [ ] **Step 3: Implement**

```jsx
// src/components/BoardChatChangesModal.jsx
//
// Board Chat's confirm step: every proposed create / update / delete, one row
// each with a checkbox. Invalid ops can't be ticked; ops on items changed
// since Claude last read them start unticked. Nothing writes until Apply.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { priorityName, statusName, ymd } from "../lib/boardChat/snapshot.js";

const FIELD_LABEL = {
  title: "Title", description: "Description", statusId: "Status", assigneeIds: "Assigned",
  dueDate: "Due", priorityId: "Priority", categoryId: "Category", tagIds: "Tags",
};

function formatValue(field, value, L) {
  if (value == null || (Array.isArray(value) && value.length === 0)) return "—";
  if (field === "statusId") return statusName(value);
  if (field === "priorityId") return priorityName(value);
  if (field === "assigneeIds") return value.map(L.userName).join(", ");
  if (field === "categoryId") return L.categoryName(value);
  if (field === "tagIds") return value.map(L.tagName).join(", ");
  if (field === "dueDate") return ymd(value);
  return String(value);
}

const GROUPS = [
  { op: "create", label: "Create" },
  { op: "update", label: "Update" },
  { op: "delete", label: "Delete" },
];

export default function BoardChatChangesModal({ open, summary, rows, lookups: L, itemLabel, onApply, onCancel, applying = false, error = null }) {
  const [checked, setChecked] = useState(() => new Set(rows.filter((r) => r.ok && !r.stale).map((r) => r.index)));
  const toggle = (i) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const rowTitle = (r) => {
    if (r.op === "create") return `${r.parentId || r.parentTempId ? "Subtask" : "Task"}: ${r.fields?.title || "(untitled)"}`;
    return itemLabel(r.itemId);
  };

  const count = checked.size;
  return (
    <Dialog open={open} onClose={applying ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Review changes</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>{summary}</Typography>
        {GROUPS.map((g) => {
          const groupRows = rows.filter((r) => r.op === g.op);
          if (groupRows.length === 0) return null;
          return (
            <Box key={g.op} sx={{ mb: 2 }}>
              <Typography variant="overline" color={g.op === "delete" ? "error" : "text.secondary"}>{g.label}</Typography>
              <Stack spacing={1}>
                {groupRows.map((r) => (
                  <Stack key={r.index} direction="row" spacing={1} alignItems="flex-start">
                    <Checkbox
                      size="small"
                      checked={checked.has(r.index)}
                      disabled={!r.ok || applying}
                      onChange={() => toggle(r.index)}
                      inputProps={{ "aria-label": rowTitle(r) }}
                      sx={{ p: 0.5 }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: g.op === "delete" ? "error.main" : "text.primary" }}>
                        {rowTitle(r)}
                      </Typography>
                      {r.ok && r.op === "update" && r.diffs.map((d) => (
                        <Typography key={d.field} variant="caption" component="div" color="text.secondary">
                          {FIELD_LABEL[d.field]}: <span>{`${formatValue(d.field, d.before, L)} → ${formatValue(d.field, d.after, L)}`}</span>
                        </Typography>
                      ))}
                      {r.ok && r.op === "create" && (
                        <Typography variant="caption" component="div" color="text.secondary">
                          {L.orgName(r.orgId)}
                          {r.fields.assigneeIds?.length ? ` · ${formatValue("assigneeIds", r.fields.assigneeIds, L)}` : ""}
                          {r.fields.dueDate ? ` · due ${ymd(r.fields.dueDate)}` : ""}
                        </Typography>
                      )}
                      {r.ok && r.op === "delete" && r.cascadeIds.length > 0 && (
                        <Typography variant="caption" component="div" color="error">
                          Also deletes {r.cascadeIds.length} subtask{r.cascadeIds.length === 1 ? "" : "s"}
                        </Typography>
                      )}
                      {r.reason && (
                        <Typography variant="caption" component="div" color="text.disabled">{r.reason}</Typography>
                      )}
                      {r.stale && (
                        <Typography variant="caption" component="div" color="warning.main">
                          Changed since Claude last read it — tick to apply anyway.
                        </Typography>
                      )}
                      {!r.ok && (
                        <Typography variant="caption" component="div" color="error">{r.error}</Typography>
                      )}
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
          );
        })}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={applying}>Cancel</Button>
        <Button variant="contained" disabled={count === 0 || applying} onClick={() => onApply(checked)}>
          {`Apply ${count} change${count === 1 ? "" : "s"}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

The diff text is one string (`In Progress → Done`), so the test's `getByText` finds it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/BoardChatChangesModal.test.jsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/BoardChatChangesModal.jsx src/components/__tests__/BoardChatChangesModal.test.jsx
git commit -m "feat(board-chat): change review modal"
```

---

### Task 10: Chat panel + Task Board wiring

**Files:**
- Create: `src/components/BoardChatPanel.jsx`
- Modify: `src/pages/TaskBoard.jsx`

- [ ] **Step 1: Write `BoardChatPanel.jsx`**

```jsx
// src/components/BoardChatPanel.jsx
//
// Board Chat drawer. Holds the conversation in memory (cleared by New chat or
// reload). The board snapshot goes in the first message; tools run here.
// propose_changes opens BoardChatChangesModal and waits for Apply / Cancel.
import { useEffect, useRef, useState } from "react";
import { serverTimestamp } from "firebase/firestore";
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close as CloseIcon, Send as SendIcon } from "@mui/icons-material";
import BoardChatChangesModal from "./BoardChatChangesModal.jsx";
import { applyChangeSet } from "../lib/itemWrites.js";
import { postChat } from "../lib/boardChat/api.js";
import { formatUsd, runTurn } from "../lib/boardChat/conversation.js";
import { buildReviewRows, toChangeSet } from "../lib/boardChat/proposal.js";
import { buildBoardSnapshot, itemRef, makeLookups, memberName, toMillis } from "../lib/boardChat/snapshot.js";
import { runReadTool } from "../lib/boardChat/tools.js";
import appTheme from "../theme/index.js";

export const PANEL_WIDTH = 420;
// The drawer sits below the app bar. Read from the app theme module, not the
// sx theme arg, so the panel renders under any ThemeProvider (tests use a
// plain createTheme()).
const TOP = appTheme.appBar.height;

const STEP_LABEL = {
  get_item: (input, ctx) => `Read ${ctx.label(input.itemId)}`,
  search_items: (input) => `Searched "${input.query}"`,
  list_meetings: (input) => `Checked meetings ${input.startDate}${input.endDate !== input.startDate ? ` – ${input.endDate}` : ""}`,
};

function contextBlock(snapshotText, user, users) {
  const me = users.find((u) => u.id === user.uid);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    "BOARD CONTEXT",
    `User: ${me ? memberName(me) : user.email} (id ${user.uid})`,
    `Now: ${new Date().toString()} (timezone ${tz})`,
    "",
    snapshotText,
  ].join("\n");
}

const textOf = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n") : "");

export default function BoardChatPanel({ open, onClose, items, users, orgs, categories, tags, user, onApplyFilter }) {
  const [history, setHistory] = useState([]);
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(null);
  const [pending, setPending] = useState(null);
  const seenRef = useRef({});
  const pendingSeenRef = useRef(new Set());
  const listRef = useRef(null);

  const lookups = makeLookups({ users, orgs, categories, tags });
  const itemLabel = (id) => {
    const it = items.find((i) => i.id === id);
    return it ? `${itemRef(it)} ${it.title || "(untitled)"}` : id;
  };
  const total = entries.reduce((s, e) => s + (e.costUsd || 0), 0);
  const anyUnpriced = entries.some((e) => e.unpriced);

  // Applied writes get server timestamps; once the snapshot listener delivers
  // them, they become what the model "saw" (its own changes aren't stale).
  useEffect(() => {
    if (pendingSeenRef.current.size === 0) return;
    for (const id of [...pendingSeenRef.current]) {
      const it = items.find((i) => i.id === id);
      const ms = it ? toMillis(it.updatedAt) : null;
      if (!it || ms != null) {
        if (ms != null) seenRef.current[id] = ms;
        pendingSeenRef.current.delete(id);
      }
    }
  }, [items]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, busy]);

  const proposeChanges = (toolInput) => new Promise((resolve, reject) => {
    const rows = buildReviewRows(toolInput.ops, {
      items,
      orgIds: new Set(orgs.map((o) => o.id)),
      memberIds: new Set(users.map((u) => u.id)),
      categoryIds: new Set(categories.map((c) => c.id)),
      tagIds: new Set(tags.map((t) => t.id)),
      seen: seenRef.current,
      now: serverTimestamp(),
    });
    setPending({ summary: toolInput.summary, rows, resolve, reject, applying: false, error: null });
  });

  const handleApply = async (checked) => {
    const { rows, resolve } = pending;
    const { ops, skipped } = toChangeSet(rows, checked);
    setPending((p) => ({ ...p, applying: true, error: null }));
    try {
      const created = await applyChangeSet(ops, { uid: user.uid, allItems: items });
      // Everything whose updatedAt this Apply bumps: updated items, new items,
      // and existing parents that gained a subtask.
      [
        ...ops.filter((o) => o.kind === "update").map((o) => o.itemId),
        ...ops.filter((o) => o.kind === "create" && o.parentId).map((o) => o.parentId),
        ...created.map((c) => c.itemId),
      ].forEach((id) => pendingSeenRef.current.add(id));
      const createdByTemp = new Map(created.map((c) => [c.tempId, c]));
      // Applied = exactly the rows that went into the change set: valid,
      // ticked, not skipped. Reported to the model by row index so a rejected
      // op on the same item can never be reported as applied.
      const skippedIdx = new Set(skipped.map((s) => s.index));
      const isApplied = (r) => r.ok && checked.has(r.index) && !skippedIdx.has(r.index);
      const applied = rows.filter(isApplied).map((r) => {
        if (r.op === "create") return { index: r.index, op: "create", title: r.fields.title, ...createdByTemp.get(r.tempId) };
        if (r.op === "delete") return { index: r.index, op: "delete", item: itemLabel(r.itemId), alsoDeletedSubtasks: r.cascadeIds.length };
        const { completedAt, ...newValues } = r.patch;
        return { index: r.index, op: "update", item: itemLabel(r.itemId), newValues, ...(completedAt !== undefined ? { completedAt: completedAt === null ? "cleared" : "now" } : {}) };
      });
      const declined = rows.filter((r) => !isApplied(r))
        .map((r) => ({ index: r.index, op: r.op, why: r.error || skipped.find((s) => s.index === r.index)?.reason || "unticked by the user" }));
      setPending(null);
      resolve({ result: { applied, declined }, step: `Applied ${applied.length} change${applied.length === 1 ? "" : "s"}` });
    } catch (err) {
      setPending((p) => ({ ...p, applying: false, error: err.message }));
    }
  };

  const handleCancel = () => {
    const { resolve, reject, error } = pending;
    setPending(null);
    if (error) reject(new Error(`Apply failed: ${error}`));
    else resolve({ result: { applied: [], declined: "all — the user cancelled the review" }, step: "Changes cancelled" });
  };

  const executeTool = async (name, toolInput) => {
    if (name === "propose_changes") return proposeChanges(toolInput);
    if (name === "set_board_filter") {
      const result = onApplyFilter(toolInput);
      return { result, step: toolInput.aiFilter ? `Filtered board: ${toolInput.aiFilter.label} (${toolInput.aiFilter.itemIds.length})` : "Filtered board" };
    }
    const out = await runReadTool(name, toolInput, { items, lookups });
    Object.assign(seenRef.current, out.seen);
    return { result: out.result, step: STEP_LABEL[name](toolInput, { label: itemLabel }) };
  };

  const runFrom = async (messages, entryIndex) => {
    setBusy(true);
    setRetry(null);
    const update = ({ messages: m, turn }) => {
      const lastAssistant = [...m].reverse().find((x) => x.role === "assistant");
      setEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, reply: textOf(lastAssistant?.content), steps: [...turn.steps], costUsd: (e.baseCost || 0) + turn.costUsd, unpriced: e.unpriced || turn.unpriced } : e)));
    };
    try {
      const out = await runTurn({ messages, post: postChat, executeTool, onUpdate: update });
      setHistory(out.messages);
      if (!out.done) setEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, notice: "Stopped after 10 steps — ask again to continue." } : e)));
    } catch (err) {
      setHistory(err.messages);
      setEntries((prev) => prev.map((e, i) => (i === entryIndex
        ? { ...e, error: err.message, baseCost: (e.baseCost || 0) + (err.turn?.costUsd || 0), costUsd: (e.baseCost || 0) + (err.turn?.costUsd || 0), unpriced: e.unpriced || err.turn?.unpriced }
        : e)));
      setRetry({ messages: err.messages, entryIndex });
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    let content = text;
    if (history.length === 0) {
      const snap = buildBoardSnapshot({ items, users, orgs, categories, tags });
      seenRef.current = { ...snap.seen };
      content = [{ type: "text", text: contextBlock(snap.text, user, users) }, { type: "text", text }];
    }
    const entryIndex = entries.length;
    setEntries((prev) => [...prev, { user: text, reply: "", steps: [], costUsd: 0 }]);
    runFrom([...history, { role: "user", content }], entryIndex);
  };

  const newChat = () => {
    setHistory([]);
    setEntries([]);
    setRetry(null);
    seenRef.current = {};
  };

  return (
    <Drawer
      anchor="right"
      variant="persistent"
      open={open}
      PaperProps={{ sx: { width: PANEL_WIDTH, top: TOP, height: `calc(100% - ${TOP}px)` } }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Board Chat</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }} aria-label="Conversation cost">
          {formatUsd(total)}{anyUnpriced ? " + unpriced" : ""}
        </Typography>
        <Button size="small" onClick={newChat} disabled={busy}>New chat</Button>
        <IconButton size="small" onClick={onClose} aria-label="Close Board Chat"><CloseIcon fontSize="small" /></IconButton>
      </Stack>

      <Box ref={listRef} sx={{ flexGrow: 1, overflowY: "auto", px: 2, py: 1.5 }}>
        {entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Ask about tasks, owners and meetings, filter the board, or ask for changes — you confirm every change before it's made.
          </Typography>
        )}
        {entries.map((e, i) => (
          <Box key={i} sx={{ mb: 2 }}>
            <Box sx={{ ml: 4, p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{e.user}</Typography>
            </Box>
            {e.steps.length > 0 && (
              <Typography variant="caption" component="div" color="text.disabled" sx={{ mt: 0.5 }}>{e.steps.join(" · ")}</Typography>
            )}
            {e.reply && <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: "pre-wrap" }}>{e.reply}</Typography>}
            {e.notice && <Alert severity="warning" sx={{ mt: 1 }}>{e.notice}</Alert>}
            {e.error && (
              <Alert severity="error" sx={{ mt: 1 }} action={retry?.entryIndex === i && !busy ? <Button size="small" onClick={() => runFrom(retry.messages, i)}>Retry</Button> : null}>
                {e.error}
              </Alert>
            )}
            {(e.costUsd > 0 || e.unpriced) && (
              <Typography variant="caption" component="div" color="text.disabled" sx={{ textAlign: "right" }}>
                {formatUsd(e.costUsd)}{e.unpriced ? " + unpriced" : ""}
              </Typography>
            )}
          </Box>
        ))}
        {busy && <Typography variant="caption" color="text.secondary">Thinking…</Typography>}
      </Box>

      <Stack direction="row" spacing={1} sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={5}
          placeholder="Ask Board Chat…"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } }}
          disabled={busy}
        />
        <IconButton onClick={send} disabled={busy || !input.trim()} aria-label="Send"><SendIcon /></IconButton>
      </Stack>

      {pending && (
        <BoardChatChangesModal
          open
          summary={pending.summary}
          rows={pending.rows}
          lookups={lookups}
          itemLabel={itemLabel}
          applying={pending.applying}
          error={pending.error}
          onApply={handleApply}
          onCancel={handleCancel}
        />
      )}
    </Drawer>
  );
}
```

- [ ] **Step 2: Wire into `TaskBoard.jsx`**

Imports:

```js
import { AutoAwesome as AutoAwesomeIcon } from "@mui/icons-material";
import BoardChatPanel, { PANEL_WIDTH } from "../components/BoardChatPanel.jsx";
```

(Add `AutoAwesome as AutoAwesomeIcon` inside the existing `@mui/icons-material` import block rather than as a second import.)

State, next to the other filter state (~line 125):

```js
  // Board Chat AI filter: { label, ids: Set } — the exact items Claude picked.
  const [aiFilter, setAiFilter] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
```

Matcher (line 142):

```js
  const matchesSearchAndColumns = useMemo(
    () => buildItemMatcher({ titleSearch, columnFilters, idSet: aiFilter?.ids }),
    [titleSearch, columnFilters, aiFilter],
  );
```

`hasAnyFilter` (line 170) adds `|| Boolean(aiFilter)` and `aiFilter` to its deps. The expansion block (lines 233–247) adds `aiFilter` as a 4th tracked filter: `filters: [scorecardFilter, titleSearch, columnFilters, aiFilter]` in both places, and `|| expansion.filters[3] !== aiFilter` in `filtersChanged`.

`applyBoardFilter`, after `handleFilterChange`:

```js
  // Board Chat's set_board_filter. Validates ids so a bad call errors back to
  // the model instead of silently showing nothing.
  const FILTERABLE = ["statusId", "assigneeIds", "priorityId", "categoryId", "tagIds"];
  const applyBoardFilter = ({ clear, orgId, titleSearch: search, columnFilters: cols, aiFilter: ai }) => {
    if (orgId && orgId !== "all" && !orgs.some((o) => o.id === orgId)) throw new Error(`Unknown organization ${orgId}`);
    if (ai) {
      const known = new Set(allItems.map((i) => i.id));
      const bad = ai.itemIds.filter((id) => !known.has(id));
      if (bad.length) throw new Error(`Unknown item ids ${bad.join(", ")}`);
    }
    if (clear) {
      setOrgFilter("all");
      setColumnFilters({});
      setTitleSearch("");
      setScorecardFilter(null);
      setAiFilter(null);
    }
    if (orgId) setOrgFilter(orgId);
    if (search !== undefined) setTitleSearch(search);
    if (cols) {
      setColumnFilters(Object.fromEntries(Object.entries(cols).filter(([k, v]) => FILTERABLE.includes(k) && v.length > 0)));
    }
    if (ai) setAiFilter({ label: ai.label, ids: new Set(ai.itemIds) });
    return { applied: true, aiFilterCount: ai ? ai.itemIds.length : null };
  };
```

Root `<Stack spacing={4}>`: leave room for the drawer, and wrap the return in a fragment so the panel renders **outside** the Stack. Otherwise the Stack's spacing adds a gap for the drawer's docked element.

```jsx
  return (
    <>
    <Stack spacing={4} sx={{ pr: chatOpen ? { md: `${PANEL_WIDTH}px` } : 0, transition: "padding 0.2s" }}>
```

Header: put a Board Chat button before "New item":

```jsx
        <Stack direction="row" spacing={1}>
          <Button variant={chatOpen ? "contained" : "outlined"} startIcon={<AutoAwesomeIcon />} onClick={() => setChatOpen((v) => !v)}>
            Board Chat
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOrgPickerOpen(true)}
          >
            New item
          </Button>
        </Stack>
```

Right after the search `TextField`, the AI filter chip:

```jsx
      {aiFilter && (
        <Box>
          <Chip
            color="secondary"
            label={`AI: ${aiFilter.label} (${aiFilter.ids.size})`}
            onDelete={() => setAiFilter(null)}
          />
        </Box>
      )}
```

After the page's closing `</Stack>`, close the fragment with the panel inside it:

```jsx
    </Stack>
      <BoardChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        items={allItems}
        users={users}
        orgs={orgs}
        categories={categories}
        tags={tags}
        user={user}
        onApplyFilter={applyBoardFilter}
      />
    </>
  );
```

(That replaces the existing final `</Stack>\n  );`.)

- [ ] **Step 3: Run the board-related tests**

Run: `npx vitest run src/pages/__tests__/TaskBoard.expandAll.test.jsx src/components/__tests__/BoardChatChangesModal.test.jsx`
Expected: PASS.

- [ ] **Step 4: Full suite, then build (serially)**

Run: `npx vitest run 2>&1 | tail -6`
Expected: every file passes.

Then run: `npx vite build 2>&1 | tail -5`
Expected: `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
git add src/components/BoardChatPanel.jsx src/pages/TaskBoard.jsx
git commit -m "feat(board-chat): chat panel, AI filter chip, board wiring"
```

---

### Task 11: Browser verification (paid — ask first) and session update

**This step spends Anthropic credit.** Before starting, tell Andy what will run, against what, and the estimated cost. Estimate: 4 questions × ~3 model calls on Sonnet 5.5 with a cached ~10K-token snapshot is roughly **$0.05–$0.25 total**. Wait for his yes.

UI verification follows the CLAUDE.md hard gate and memory: agent-browser with its dedicated profile on `localhost:5173`. The dev server must be on 5173, or SSO fails with origin_mismatch. `/api/*` proxies to the deployed backend, so `/api/ai/chat` only exists there after deploy. **Local verification of the chat therefore needs this branch deployed first** (push `HEAD:dev` per the push workflow, after code review). If the dev server renders blank (the v0.4.18 gotcha), use `npx vite build && npx vite preview --port 5173`.

- [ ] **Step 1: Request code review** (`superpowers:requesting-code-review`) and address the findings.
- [ ] **Step 2: Ask Andy to approve the push to `origin/dev` and the paid verification run** (one message: what, against what, cost).
- [ ] **Step 3: On approval, push** — `git pull --rebase origin dev`, then `git push origin HEAD:dev`. Wait for the Vercel deploy.
- [ ] **Step 4: Drive the deployed site** with agent-browser. Board Chat:
  1. "What do I need to get done today, and which meetings do I need them done before?" → answer cites tasks + meetings; steps line shows "Checked meetings".
  2. "Show me all tasks for everyone related to appointment data" → AI chip appears with a count, and the table narrows to those items.
  3. "Move <one real test task> to Review" → modal shows Status before → after; Apply; row updates; chat says applied. Then ask to move it back and Apply. Leave production data as it was.
  4. Cancel a proposal → chat reports nothing changed.
  5. Header total equals the sum of the per-reply costs.
  Screenshots go to the session scratchpad, never the repo.
- [ ] **Step 5: Update `dev/sessions/v0_4_19_Andrew_BOARD_CHAT/context.md`** with: what shipped, verification results (actual costs observed), and anything not verified. Commit:

```bash
git add dev/sessions/v0_4_19_Andrew_BOARD_CHAT/context.md
git commit -m "docs(session): v0.4.19 Board Chat verification"
```
