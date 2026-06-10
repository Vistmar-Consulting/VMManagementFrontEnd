# New Item Org Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disabled "New item" button (when org filter = "All") with an always-enabled button that opens an org picker modal — single-tap on an org creates the item and scopes the board to that org.

**Architecture:** All changes are in `src/pages/TaskBoard.jsx`. Add `orgPickerOpen` state, update `handleAddItem` to accept an explicit `orgId` param, add the modal JSX, and remove the disabled/tooltip gate on the button.

**Tech Stack:** React 18, MUI 5 Dialog/Button, Firebase Firestore (runTransaction — unchanged), `getContrastText` from `../theme/pillColors.js` (already imported).

**Spec:** `docs/superpowers/specs/2026-06-10-new-item-org-picker-design.md`

---

### Task 1: Update `handleAddItem` to accept an explicit `orgId` param

**Files:**
- Modify: `src/pages/TaskBoard.jsx:486–524`

Current signature reads `orgFilter` from closure. New signature takes `orgId` directly.

- [ ] **Step 1: Update the function signature and body**

Replace lines 486–524:

```js
// BEFORE
const handleAddItem = async () => {
  // Fail loud rather than silent-return — the "New item" button is
  // disabled in the "all orgs" state, so reaching here means the gate
  // was bypassed (programmatic call, future keyboard shortcut, etc.).
  if (orgFilter === "all") {
    throw new Error("handleAddItem requires a specific org filter — pick a Client chip first.");
  }
  const orgRef = doc(db, "organizations", orgFilter);
  const newItemRef = doc(collection(db, "items"));
  const order = nextTopLevelOrder();
  await runTransaction(db, async (tx) => {
    const orgSnap = await tx.get(orgRef);
    const next = orgSnap.data()?.nextItemNumber ?? 1;
    tx.set(newItemRef, {
      organizationId: orgFilter,
      ...
    });
    tx.update(orgRef, { nextItemNumber: next + 1 });
  });
};

// AFTER
const handleAddItem = async (orgId) => {
  const orgRef = doc(db, "organizations", orgId);
  const newItemRef = doc(collection(db, "items"));
  const order = nextTopLevelOrder();
  await runTransaction(db, async (tx) => {
    const orgSnap = await tx.get(orgRef);
    const next = orgSnap.data()?.nextItemNumber ?? 1;
    tx.set(newItemRef, {
      organizationId: orgId,
      parentId: null,
      hasChildren: false,
      type: "task",
      title: "",
      description: "",
      statusId: 1,
      priorityId: null,
      categoryId: null,
      tagIds: [],
      onHold: false,
      dueDate: null,
      completedAt: null,
      assigneeIds: [],
      itemNumber: next,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      order,
    });
    tx.update(orgRef, { nextItemNumber: next + 1 });
  });
};
```

Key changes: parameter `orgId` replaces closure read of `orgFilter`; remove the `if (orgFilter === "all") throw` guard; replace both uses of `orgFilter` inside the body with `orgId`.

- [ ] **Step 2: Run vitest to confirm no regressions**

```bash
npx vitest run
```

Expected: all existing tests pass (they don't test TaskBoard — this confirms nothing upstream broke).

- [ ] **Step 3: Commit**

```bash
git add src/pages/TaskBoard.jsx
git commit -m "refactor(task-board): handleAddItem accepts explicit orgId param"
```

---

### Task 2: Add org picker modal

**Files:**
- Modify: `src/pages/TaskBoard.jsx` — add state + modal JSX

- [ ] **Step 1: Add `orgPickerOpen` state**

After the existing `useState` declarations (around line 130), add:

```js
const [orgPickerOpen, setOrgPickerOpen] = useState(false);
```

- [ ] **Step 2: Add the sorted orgs list used by the modal**

The existing board chips already sort orgs with `[...orgs].sort(...)`. The modal needs the same list. Add a memoized sorted list near the other `useMemo` calls (or just inline the sort in the JSX — it's a cheap operation on a tiny array):

```js
const sortedOrgs = useMemo(
  () => [...(orgs || [])].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
  [orgs],
);
```

- [ ] **Step 3: Add the modal handler**

Add this handler near the other `handle*` functions:

```js
const handleOrgPickerSelect = async (orgId) => {
  try {
    await handleAddItem(orgId);
    setOrgFilter(orgId);
    setOrgPickerOpen(false);
  } catch (err) {
    setOrgPickerOpen(false);
    throw err;
  }
};
```

- [ ] **Step 4: Add the modal JSX**

Place this `Dialog` anywhere inside the component's `return` (e.g. just before the final closing `</Stack>`):

```jsx
{/* Org picker — opens when "New item" is clicked */}
<Dialog
  open={orgPickerOpen}
  onClose={() => setOrgPickerOpen(false)}
  maxWidth="xs"
  fullWidth
>
  <DialogTitle>Create item for…</DialogTitle>
  <DialogContent>
    <Stack spacing={1} sx={{ pt: 0.5 }}>
      {sortedOrgs.length === 0 ? (
        <Button disabled fullWidth>No organizations</Button>
      ) : (
        sortedOrgs.map((org) => {
          const selected = orgFilter === org.id;
          return (
            <Button
              key={org.id}
              fullWidth
              variant={selected ? "contained" : "outlined"}
              onClick={() => handleOrgPickerSelect(org.id)}
              sx={selected && org.accentColor ? {
                bgcolor: org.accentColor,
                color: getContrastText(org.accentColor),
                "&:hover": { bgcolor: org.accentColor, filter: "brightness(0.92)" },
              } : {}}
            >
              {org.name}
            </Button>
          );
        })
      )}
    </Stack>
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setOrgPickerOpen(false)}>Cancel</Button>
  </DialogActions>
</Dialog>
```

- [ ] **Step 5: Run vitest**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/TaskBoard.jsx
git commit -m "feat(task-board): add org picker modal for new item creation"
```

---

### Task 3: Update "New item" button — remove disabled gate and tooltip

**Files:**
- Modify: `src/pages/TaskBoard.jsx:779–792`

- [ ] **Step 1: Replace the button + tooltip block**

Current code (lines 779–792):

```jsx
<Tooltip
  title={orgFilter === "all" ? "Pick an organization filter to add an item to" : `Add item to ${orgs.find((o) => o.id === orgFilter)?.name || orgFilter}`}
>
  <span>
    <Button
      variant="contained"
      startIcon={<AddIcon />}
      onClick={handleAddItem}
      disabled={orgFilter === "all" || !isAdmin}
    >
      New item
    </Button>
  </span>
</Tooltip>
```

Replace with:

```jsx
<Button
  variant="contained"
  startIcon={<AddIcon />}
  onClick={() => setOrgPickerOpen(true)}
  disabled={!isAdmin}
>
  New item
</Button>
```

Changes: remove `Tooltip` wrapper + `<span>`, remove `orgFilter === "all"` from `disabled`, change `onClick` to open the modal.

- [ ] **Step 2: Run vitest**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Verify in browser**

Start dev server: `npm run dev`

Test cases:
1. **"All" filter active** → click "New item" → modal opens with no org pre-selected → tap an org → modal closes, board scopes to that org, new blank item appears at bottom.
2. **Specific org active (e.g. Total Vision)** → click "New item" → modal opens with Total Vision button filled/highlighted → tap a different org → modal closes, board scopes to the new org, blank item appears.
3. **Tap same org that's already selected** → item created, orgFilter unchanged, modal closes.
4. **Click backdrop or Cancel** → modal closes, no item created, orgFilter unchanged.
5. **Non-admin user** → "New item" button is disabled (same as today).

- [ ] **Step 5: Commit**

```bash
git add src/pages/TaskBoard.jsx
git commit -m "feat(task-board): open org picker on New item click, remove disabled gate"
```

---

### Task 4: Push and deploy

- [ ] **Step 1: Push to origin/dev**

```bash
git push origin main:dev
```

- [ ] **Step 2: Deploy to Vercel**

```bash
vercel deploy --prod
```

- [ ] **Step 3: Smoke-test on prod**

Open `vm-management-front-end.vercel.app`, navigate to Project Board, repeat the 5 verification cases from Task 3 Step 4 against production.
