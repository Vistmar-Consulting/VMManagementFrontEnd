# Sync Meeting Subitem Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Sync Meeting AI pass to propose subitems nested one level under existing board items or other newly proposed items in the same run, with full user review/edit in the modal before apply.

**Architecture:** Add optional `parentRef` string to the AI creates schema (`""` = top-level, `"{itemId}"` = existing parent, `"new:N"` = 0-based index into the current run's creates). `validateProposal` gains four new rejection rules + a second-pass for forward refs. `applyUnified` pre-allocates doc refs, resolves `parentRef` → `parentId`, and marks parents `hasChildren: true`. The review modal shows a Parent display line and an editable Parent dropdown.

**Tech Stack:** React 18 + MUI 5, Firestore (Firebase Web SDK 11), Anthropic structured outputs, Vitest

**Spec:** `docs/superpowers/specs/2026-06-05-sync-meeting-subitems-design.md`

---

## File Map

| File | What changes |
|---|---|
| `api/ai/prepare.js` | Add `parentRef` to `buildSchema()` creates; add prompt instructions |
| `src/lib/syncMeeting.js` | Refactor creates loop; add `rejectedIdxs`; four validation rules + second-pass |
| `src/lib/__tests__/syncMeeting.test.js` | 8 new tests for parentRef validation |
| `src/lib/aiAgenda.js` | Pre-allocate doc refs; pre-pass; resolve `parentRef`; post-creates `hasChildren` writes |
| `src/components/SyncMeetingDialog.jsx` | Parent display chip; Parent dropdown; indent; section header |

---

## Task 1: AI Schema — add `parentRef` to creates

**Files:**
- Modify: `api/ai/prepare.js:64-75` (creates schema properties)
- Modify: `api/ai/prepare.js:200-203` (boardChanges.creates prompt section)

- [ ] **Step 1: Add `parentRef` to the creates schema in `buildSchema()`**

  In `api/ai/prepare.js`, the creates schema at lines 64–75 currently has `properties: { title, topicIndex, note }` and `required: ["title", "topicIndex", "note"]`. Add `parentRef` to properties only — intentionally NOT to `required`:

  ```js
  properties: {
    title:      { type: "string" },
    topicIndex: { type: "integer" },
    note:       { type: "string" },
    parentRef:  { type: "string" },   // optional — "" or omitted = top-level
  },
  required: ["title", "topicIndex", "note"],
  ```

- [ ] **Step 2: Add `parentRef` instructions to the prompt in `buildSystem()`**

  In `api/ai/prepare.js`, find the `### boardChanges.creates — NEW tasks` block (around line 200). After the existing `topicIndex` CRITICAL instruction (line 203), append:

  ```js
  `- OPTIONAL: set \`parentRef\` when this task is a subitem.
    - Nest under an **existing** board item: set \`parentRef\` to that item's \`itemId\` (from the task list below).
    - Nest under a **newly proposed** task in this run: set \`parentRef\` to \`"new:N"\` where N is the 0-based index of the parent create in this \`creates\` array (e.g. \`"new:0"\` nests under the first proposed task).
    - One level deep only — never set \`parentRef\` on a task whose intended parent itself has a \`parentRef\`.
    - Leave \`parentRef\` empty or omit for top-level tasks.`
  ```

  The append goes between the `topicIndex` line and the blank line before `### boardChanges.moves`.

- [ ] **Step 3: Commit**

  ```bash
  git add api/ai/prepare.js
  git commit -m "feat(sync-meeting): add parentRef to AI creates schema and prompt"
  ```

---

## Task 2: Tests for `validateProposal` parentRef rules

**Files:**
- Modify: `src/lib/__tests__/syncMeeting.test.js`

Write ALL tests before touching `syncMeeting.js`. They will fail until Task 3.

- [ ] **Step 1: Add a new `describe("validateProposal — parentRef")` block**

  Open `src/lib/__tests__/syncMeeting.test.js`. After the existing `validateProposal` describe block, add:

  ```js
  describe("validateProposal — parentRef", () => {
    const existingTasks = [
      { id: "item-A", title: "Existing top-level" },
      { id: "item-B", title: "Another existing" },
    ];
    const withIds = mintTopicIds([{ name: "Topic", categoryIds: ["web"], tagIds: [] }]);

    function mkCreate(title, parentRef = "") {
      return { title, topicId: "t0", note: "", ...(parentRef ? { parentRef } : {}) };
    }

    it("accepts a create with no parentRef (top-level)", () => {
      const r = validateProposal({
        topics: withIds,
        boardChanges: { creates: [mkCreate("Task A")], moves: [], notes: [] },
        existingTasks,
      });
      expect(r.rejectedCreates).toHaveLength(0);
      expect(r.acceptedCreates).toHaveLength(1);
    });

    it("accepts a create whose parentRef is an existing board item", () => {
      const r = validateProposal({
        topics: withIds,
        boardChanges: { creates: [mkCreate("Sub", "item-A")], moves: [], notes: [] },
        existingTasks,
      });
      expect(r.rejectedCreates).toHaveLength(0);
      expect(r.acceptedCreates).toHaveLength(1);
    });

    it("rejects a create whose parentRef itemId is not on the board", () => {
      const r = validateProposal({
        topics: withIds,
        boardChanges: { creates: [mkCreate("Sub", "item-ghost")], moves: [], notes: [] },
        existingTasks,
      });
      expect(r.rejectedCreates).toHaveLength(1);
      expect(r.rejectedCreates[0].reason).toMatch(/parentRef itemId not found/i);
    });

    it("accepts a create with parentRef new:0 pointing to a valid top-level create", () => {
      const r = validateProposal({
        topics: withIds,
        boardChanges: {
          creates: [mkCreate("Parent task"), mkCreate("Child task", "new:0")],
          moves: [], notes: [],
        },
        existingTasks,
      });
      expect(r.rejectedCreates).toHaveLength(0);
      expect(r.acceptedCreates).toHaveLength(2);
    });

    it("rejects parentRef new:N when N is out of range", () => {
      const r = validateProposal({
        topics: withIds,
        boardChanges: { creates: [mkCreate("Only", "new:5")], moves: [], notes: [] },
        existingTasks,
      });
      expect(r.rejectedCreates).toHaveLength(1);
      expect(r.rejectedCreates[0].reason).toMatch(/out of range/i);
    });

    it("rejects parentRef self-reference (new:N where N = own index)", () => {
      const r = validateProposal({
        topics: withIds,
        boardChanges: { creates: [mkCreate("Self", "new:0")], moves: [], notes: [] },
        existingTasks,
      });
      expect(r.rejectedCreates).toHaveLength(1);
      expect(r.rejectedCreates[0].reason).toMatch(/self-reference/i);
    });

    it("rejects parentRef that would exceed single nesting depth", () => {
      // creates[1] has parentRef "new:0", so creates[2] cannot use "new:1"
      const r = validateProposal({
        topics: withIds,
        boardChanges: {
          creates: [
            mkCreate("Top"),
            mkCreate("Mid", "new:0"),
            mkCreate("Bottom", "new:1"),   // parent (creates[1]) has a parentRef → reject
          ],
          moves: [], notes: [],
        },
        existingTasks,
      });
      expect(r.rejectedCreates).toHaveLength(1);
      expect(r.rejectedCreates[0].title).toBe("Bottom");
      expect(r.rejectedCreates[0].reason).toMatch(/nesting depth/i);
    });

    it("second-pass rejects a subitem whose intra-run parent was itself rejected (forward ref)", () => {
      // creates[0] references creates[1] as parent (forward ref)
      // creates[1] has an invalid topicId → rejected in main pass
      // creates[0] should be rejected in second pass
      const r = validateProposal({
        topics: withIds,
        boardChanges: {
          creates: [
            mkCreate("Child forward", "new:1"),   // forward ref to creates[1]
            { title: "Parent bad topic", topicId: "t-gone", note: "" },  // will be rejected (bad topicId)
          ],
          moves: [], notes: [],
        },
        existingTasks,
      });
      // creates[1] rejected (bad topic), creates[0] rejected (target rejected)
      expect(r.rejectedCreates).toHaveLength(2);
      const childRejection = r.rejectedCreates.find((c) => c.title === "Child forward");
      expect(childRejection?.reason).toMatch(/target was rejected/i);
    });
  });
  ```

- [ ] **Step 2: Run tests — confirm all 8 new tests fail**

  ```bash
  cd /Users/andrewdeemer/Vistamar_Consulting/VMManagementFrontEnd
  npm test -- --reporter=verbose src/lib/__tests__/syncMeeting.test.js
  ```

  Expected: existing tests pass, 8 new tests fail (some with "not a function" or unexpected acceptance).

- [ ] **Step 3: Commit the failing tests**

  ```bash
  git add src/lib/__tests__/syncMeeting.test.js
  git commit -m "test(sync-meeting): failing tests for parentRef validation rules"
  ```

---

## Task 3: Implement `validateProposal` parentRef rules

**Files:**
- Modify: `src/lib/syncMeeting.js:23-57`

The current creates loop is `for (const c of boardChanges?.creates || [])` with `acceptedCreates.push(c)` after the topic check (line 33). This task replaces it.

- [ ] **Step 1: Replace the creates loop with the indexed form + new rules**

  Replace lines 28–33 of `src/lib/syncMeeting.js`:

  ```js
  // BEFORE (lines 28-33):
  const acceptedCreates = [];
  const rejectedCreates = [];
  for (const c of boardChanges?.creates || []) {
    const t = byId[c.topicId];
    if (!t) { rejectedCreates.push({ ...c, reason: "owning topic no longer in proposal" }); continue; }
    acceptedCreates.push(c);
  }
  ```

  With:

  ```js
  const acceptedCreates = [];
  const rejectedCreates = [];
  const rejectedIdxs = new Set();
  const creates = boardChanges?.creates || [];
  for (let idx = 0; idx < creates.length; idx++) {
    const c = creates[idx];
    const t = byId[c.topicId];
    if (!t) {
      rejectedCreates.push({ ...c, reason: "owning topic no longer in proposal" });
      rejectedIdxs.add(idx);
      continue;
    }
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
        // Forward refs (n > idx) are handled by second-pass below.
      } else {
        if (!knownItemIds.has(parentRef)) {
          rejectedCreates.push({ ...c, reason: "parentRef itemId not found on board" });
          rejectedIdxs.add(idx); continue;
        }
      }
    }
    acceptedCreates.push(c);
  }

  // Second pass: reject any accepted create whose intra-run parent was itself rejected
  // (catches forward references that couldn't be checked in the main loop).
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
  acceptedCreates.length = 0;
  stillAccepted.forEach((c) => acceptedCreates.push(c));
  // hasRejections in the return statement is computed after this point, so it
  // correctly counts second-pass rejections too. Do not hoist it above this block.
  ```

- [ ] **Step 2: Run all tests — confirm 8 new tests pass, 0 regressions**

  ```bash
  npm test -- --reporter=verbose src/lib/__tests__/syncMeeting.test.js
  ```

  Expected: all tests pass (including the 8 new ones and all 8 existing ones).

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/syncMeeting.js
  git commit -m "feat(sync-meeting): validateProposal parentRef rules + second-pass cleanup"
  ```

---

## Task 4: `applyUnified` — resolve parentRef at apply time

**Files:**
- Modify: `src/lib/aiAgenda.js:567-604` (the creates forEach block)

- [ ] **Step 1: Pre-allocate create doc refs before the transaction**

  In `applyUnified`, find the line `let order = null;` (currently around line 572, just before `acceptedCreates.forEach`). Insert the pre-allocation BEFORE `runTransaction` (search for where `await runTransaction(db, async (tx) => {` starts — it's earlier). Actually, the pre-allocation must go OUTSIDE the transaction body. Find the line `const createOrgs = acceptedCreates.map(...)` (around line 498) and add after it:

  ```js
  // Pre-allocate doc refs so "new:N" forward-references can resolve before
  // their target create is written. Remove the per-create ref allocation inside
  // the creates forEach — that is replaced by createDocRefs[pos] below.
  const createDocRefs = acceptedCreates.map(() => doc(collection(db, "items")));
  ```

- [ ] **Step 2: Pre-pass — identify which accepted positions become parents**

  After the `createDocRefs` line, add:

  ```js
  // Build set of accepted positions (0-based index into acceptedCreates) that
  // will be someone's parent, so we can write hasChildren=true for them.
  const parentCreateIdxs = new Set();
  acceptedCreates.forEach(({ create }, pos) => {
    const ref = create.parentRef || "";
    if (ref.startsWith("new:")) {
      const n = parseInt(ref.slice(4), 10);
      const targetPos = acceptedCreates.findIndex((x) => x.idx === n);
      if (targetPos >= 0) parentCreateIdxs.add(targetPos);
    }
  });
  ```

- [ ] **Step 3: Replace the creates forEach body inside the transaction**

  Find the creates `forEach` inside the transaction (lines 573–604). It currently starts `acceptedCreates.forEach(({ idx, create }) => {` and contains `const ref = doc(collection(db, "items"))`. Replace the entire forEach with:

  ```js
  acceptedCreates.forEach(({ idx, create }, pos) => {
    const org = orgOfCreate(create);
    const promo = promotions[idx];
    const statusId = promo?.statusId ?? AI_GEN_STATUS;
    const assigneeIds = Array.isArray(promo?.assigneeIds) ? promo.assigneeIds : [];
    const { categoryId, tagIds } = inheritKeysForCreate(create, topicsById);
    let num = orgNum.get(org) ?? 1;
    order = generateKeyBetween(order, null);

    // Resolve parentRef → parentId.
    const rawRef = create.parentRef || "";
    let parentId = null;
    if (rawRef.startsWith("new:")) {
      const n = parseInt(rawRef.slice(4), 10);
      const targetPos = acceptedCreates.findIndex((x) => x.idx === n);
      if (targetPos >= 0) parentId = createDocRefs[targetPos].id;
    } else if (rawRef) {
      parentId = rawRef;  // existing Firestore item ID
    }

    tx.set(createDocRefs[pos], {
      organizationId: org,
      parentId,
      hasChildren: parentCreateIdxs.has(pos),
      type: "task",
      title: String(create.title || ""),
      description: String(create.note || ""),
      statusId,
      priorityId: null,
      categoryId,
      tagIds,
      onHold: false,
      dueDate: null,
      completedAt: null,
      assigneeIds,
      itemNumber: num,
      createdBy: uid || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      order,
    });
    orgNum.set(org, num + 1);
  });
  ```

- [ ] **Step 4: Add a pre-apply guard for unchecked parents**

  The dialog lets users uncheck individual creates before applying. If a user checks a child create but unchecks its `"new:N"` parent, the child's `parentRef` still points at an original proposal index that is no longer in `acceptedCreates`. The backstop `validateProposal` in `applyUnified` receives a compacted array where `"new:N"` indices no longer correspond to the original proposal indices, so it would fire a misleading "self-reference" error. Add an explicit, clear guard immediately before the `runTransaction` call:

  ```js
  // Guard: reject any accepted create whose "new:N" parent (a) wasn't accepted,
  // or (b) is itself a subitem — enforces single depth even if the user edited
  // parentRef fields in an order that bypassed the dropdown filter.
  for (const { create } of acceptedCreates) {
    const ref = create.parentRef || "";
    if (ref.startsWith("new:")) {
      const n = parseInt(ref.slice(4), 10);
      const parentEntry = acceptedCreates.find((x) => x.idx === n);
      if (!parentEntry) {
        throw new Error(
          `Task "${create.title}" is marked as a subitem but its parent task was not selected. Uncheck it or choose a different parent.`
        );
      }
      if (parentEntry.create.parentRef) {
        throw new Error(
          `Task "${create.title}" cannot be a subitem of "${parentEntry.create.title}" because that task is itself a subitem. Only one level of nesting is allowed.`
        );
      }
    }
  }
  ```

- [ ] **Step 5: Add post-creates `hasChildren` updates for existing-item parents**

  Immediately after the creates `forEach` closing `});` (before the moves forEach), add:

  ```js
  // Mark any existing items that become parents of a newly created subitem.
  const existingParentIds = new Set(
    acceptedCreates
      .map(({ create }) => create.parentRef || "")
      .filter((ref) => ref && !ref.startsWith("new:"))
  );
  existingParentIds.forEach((id) => {
    tx.update(doc(db, "items", id), { hasChildren: true, updatedAt: serverTimestamp() });
  });
  ```

- [ ] **Step 6: Run the full test suite to check for regressions**

  ```bash
  npm test
  ```

  Expected: all tests pass. (There are no unit tests for `applyUnified` — it hits Firestore directly — so this is a smoke check of the pure helpers.)

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/aiAgenda.js
  git commit -m "feat(sync-meeting): applyUnified resolves parentRef to parentId + hasChildren writes"
  ```

---

## Task 5: Review Modal — Parent display + dropdown + indent

**Files:**
- Modify: `src/components/SyncMeetingDialog.jsx`

The creates render section (inside `step === "review"`) currently renders each create row with title TextField, topic caption, description TextField, Status Select, and Assignee Select. This task adds the Parent display, Parent dropdown, and visual indent.

- [ ] **Step 1: Add Parent display line after the Topic caption**

  Find the Topic caption line (currently):
  ```jsx
  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
    Topic: {topicName}
  </Typography>
  ```

  Insert directly after it:
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
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        Parent: {label}
      </Typography>
    );
  })()}
  ```

  `creates[n].title` reads from the live proposal state, so it auto-updates if the parent's title field is edited.

  > **Depth enforcement note:** `validateProposal` is only re-run at receipt and after Refine — not on every user edit. Single-depth is enforced in the UI by the Parent dropdown filters: create[j] only appears as a parent option when `!other.parentRef`, and existing items are filtered to `!it.parentId`. This prevents creating invalid depth via the dropdown. If a user unchecks an accepted parent create after assigning a child to it, `applyUnified` will throw a clear error (from Task 4 Step 4) rather than silently writing a top-level item.

- [ ] **Step 2: Add Parent dropdown to the controls row**

  The controls `<Stack direction="row" spacing={1}>` currently holds Status and Assignee selects. Add the Parent select after Assignee:

  ```jsx
  <FormControl size="small" sx={{ minWidth: 180 }}>
    <InputLabel id={`parent-${i}`}>Parent</InputLabel>
    <Select
      labelId={`parent-${i}`}
      label="Parent"
      value={c.parentRef || ""}
      onChange={(e) => setCreateField(i, "parentRef", e.target.value)}
      disabled={!selCreates.has(i)}
    >
      <MenuItem value=""><em>None (top-level)</em></MenuItem>
      {(items || [])
        .filter((it) => !it.parentId)
        .map((it) => (
          <MenuItem key={it.id} value={it.id}>{it.title}</MenuItem>
        ))}
      {creates.map((other, j) => {
        if (j === i) return null;         // skip self
        if (other.parentRef) return null; // skip creates already assigned as subitems
        return (
          <MenuItem key={`new:${j}`} value={`new:${j}`}>
            {other.title} (new)
          </MenuItem>
        );
      })}
    </Select>
  </FormControl>
  ```

- [ ] **Step 3: Add left indent for subitem rows**

  The outer `<Box>` that wraps the checkbox and content for each create currently has:
  ```jsx
  <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75 }}>
  ```

  Add conditional left padding for subitems:
  ```jsx
  <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75, pl: c.parentRef ? 3 : 0 }}>
  ```

- [ ] **Step 4: Update the section header**

  Find:
  ```jsx
  <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>New tasks → AI Gen</Typography>
  ```

  Replace with:
  ```jsx
  <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>New tasks &amp; subitems → AI Gen</Typography>
  ```

- [ ] **Step 5: Run the test suite**

  ```bash
  npm test
  ```

  Expected: all tests still pass.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/SyncMeetingDialog.jsx
  git commit -m "feat(sync-meeting): Parent display, dropdown, and indent in review modal"
  ```

---

## Task 6: Verify end-to-end in the app

Since `applyUnified` writes to Firestore and can't be unit-tested easily, verify manually via the dev server.

- [ ] **Step 1: Start the dev server**

  ```bash
  npm run dev
  ```

- [ ] **Step 2: Open an agenda and trigger Sync Meeting**

  Navigate to any agenda on `http://localhost:5173`. Click the AI sync button. Generate a proposal.

- [ ] **Step 3: In the review modal, manually set a `parentRef` on one create**

  Use the Parent dropdown to assign one new task under an existing board item. Verify:
  - The "Parent: {title}" line appears
  - The row indents (pl:3)
  - The Status/Assignee dropdowns remain functional

- [ ] **Step 4: Apply and verify on the Project Board**

  Click Apply. Navigate to the Project Board. Verify:
  - The subitem appears nested under the parent
  - The parent shows `hasChildren` behavior (expand arrow visible)
  - The subitem has correct title, status, assignee

- [ ] **Step 5: Commit nothing** — verification only, no code changes.

---

## Task 7: Push

- [ ] **Step 1: Final test run**

  ```bash
  npm test
  ```

  Expected: all tests pass.

- [ ] **Step 2: Push to origin/dev**

  ```bash
  git push origin main:dev
  ```
