# Sync Meeting — Board Section Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the form-field create/move sections in `SyncMeetingDialog`'s review step with board-style rows that match `MiniProjectBoard` visually and `TaskBoardRow` interactively, with full inline editing of status, assignee, category, and tags on proposed new items.

**Architecture:** A new `ProposedBoardRow` component handles each proposed create — no Firestore writes, all mutations go through `onUpdateCreate`/`onUpdatePromotion` callbacks. `SyncMeetingDialog` expands its `promotions` state to carry `categoryId`/`tagIds`, seeds them from `inheritKeysForCreate`, and replaces the form-field blocks with a group-header + ProposedBoardRow layout. `applyUnified` in `aiAgenda.js` is updated to prefer promo values over inherited values.

**Tech Stack:** React 18, MUI 5.15, Vitest + @testing-library/react (jsdom), no Firebase in ProposedBoardRow

**Spec:** `docs/superpowers/specs/2026-06-10-sync-meeting-board-section-redesign.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/ProposedBoardRow.jsx` | **CREATE** | Board-style row for a proposed create; local state only |
| `src/components/__tests__/ProposedBoardRow.test.jsx` | **CREATE** | Unit tests for ProposedBoardRow rendering |
| `src/components/SyncMeetingDialog.jsx` | **MODIFY** | Expand promotions, replace creates/moves sections, clean imports |
| `src/lib/aiAgenda.js` | **MODIFY** | `applyUnified` prefers promo.categoryId/promo.tagIds |

---

## Task 1: Create `ProposedBoardRow.jsx` — write tests first

**Files:**
- Create: `src/components/__tests__/ProposedBoardRow.test.jsx`
- Create: `src/components/ProposedBoardRow.jsx`

### Dependency note
`ProposedBoardRow` imports `MemberAvatar` from `./MemberAvatar.jsx`. Before writing the test, verify that component exists:
```bash
ls src/components/MemberAvatar.jsx
```

- [ ] **Step 1.1: Write the failing tests**

Create `src/components/__tests__/ProposedBoardRow.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import ProposedBoardRow from "../ProposedBoardRow.jsx";

const theme = createTheme();

const CAT_WEB = { id: "cat-web", name: "web-dev", color: "#2e7d32", slug: "web-dev" };
const CAT_SEO = { id: "cat-seo", name: "seo", color: "#1565c0", slug: "seo" };
const TAG_GBP  = { id: "tag-gbp",  name: "gbp",  color: "#e65100" };
const TAG_Q3   = { id: "tag-q3",   name: "q3",   color: "#9c27b0" };
const USER_A   = { id: "uid-a", displayName: "Andy",  active: true };
const USER_S   = { id: "uid-s", displayName: "Scot",  active: true };

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const baseCreate = {
  title: "Draft GBP post schedule",
  topicId: "t0",
  note: "Discussed in client call 2026-06-06",
  parentRef: null,
};

const basePromotion = {
  statusId: 8, // AI Gen
  assigneeIds: [],
  categoryId: "cat-web",
  tagIds: ["tag-gbp"],
};

function makeProps(overrides = {}) {
  return {
    create: baseCreate,
    idx: 0,
    isChecked: true,
    onToggle: vi.fn(),
    promotion: basePromotion,
    onUpdateCreate: vi.fn(),
    onUpdatePromotion: vi.fn(),
    itemsById: new Map(),
    creates: [baseCreate],
    users: [USER_A, USER_S],
    categories: [CAT_WEB, CAT_SEO],
    tags: [TAG_GBP, TAG_Q3],
    ...overrides,
  };
}

describe("ProposedBoardRow", () => {
  it("renders the create title", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("Draft GBP post schedule")).toBeInTheDocument();
  });

  it("renders the AI note as italic dimmed text", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    const note = screen.getByText("Discussed in client call 2026-06-06");
    expect(note).toBeInTheDocument();
    // note is rendered in a Typography with fontStyle italic
    expect(note).toHaveStyle({ fontStyle: "italic" });
  });

  it("renders the category pill text", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("web-dev")).toBeInTheDocument();
  });

  it("renders tag dots and names", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("gbp")).toBeInTheDocument();
  });

  it("shows separator dot when category and tags are both present", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("·")).toBeInTheDocument();
  });

  it("hides separator dot when category is absent", () => {
    const p = makeProps({ promotion: { ...basePromotion, categoryId: null } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("hides separator dot when tags are empty", () => {
    const p = makeProps({ promotion: { ...basePromotion, tagIds: [] } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("row is semi-transparent when unchecked", () => {
    const { container } = wrap(<ProposedBoardRow {...makeProps({ isChecked: false })} />);
    const row = container.firstChild;
    // MUI sx opacity:0.5 is applied inline or via CSS
    expect(row).toHaveStyle({ opacity: "0.5" });
  });

  it("calls onToggle when checkbox changes", () => {
    const onToggle = vi.fn();
    wrap(<ProposedBoardRow {...makeProps({ onToggle })} />);
    const cb = screen.getByRole("checkbox");
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows parent badge when parentRef is set to an existing item", () => {
    const itemsById = new Map([["item-1", { id: "item-1", title: "Parent Task" }]]);
    const p = makeProps({
      create: { ...baseCreate, parentRef: "item-1" },
      itemsById,
    });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText(/Parent Task/)).toBeInTheDocument();
  });

  it("shows parent badge for new: ref resolving to another create", () => {
    const creates = [
      baseCreate,
      { title: "Sub task", topicId: "t0", note: "", parentRef: "new:0" },
    ];
    const p = makeProps({
      create: creates[1],
      idx: 1,
      creates,
    });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText(/Draft GBP post schedule/)).toBeInTheDocument();
  });

  it("renders '+ category' placeholder when categoryId is null", () => {
    const p = makeProps({ promotion: { ...basePromotion, categoryId: null } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText("+ category")).toBeInTheDocument();
  });

  it("renders '+ tags' placeholder when tagIds is empty", () => {
    const p = makeProps({ promotion: { ...basePromotion, tagIds: [] } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText("+ tags")).toBeInTheDocument();
  });

  it("does not render AI note when create.note is empty", () => {
    const p = makeProps({ create: { ...baseCreate, note: "" } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.queryByText("Discussed in client call 2026-06-06")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they all fail**

```bash
npm test -- ProposedBoardRow
```

Expected: all 13 tests FAIL with "Cannot find module '../ProposedBoardRow.jsx'"

- [ ] **Step 1.3: Create `src/components/ProposedBoardRow.jsx`**

```jsx
import { useState } from "react";
import {
  Box,
  Checkbox,
  Chip as MuiChip,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { Check } from "@mui/icons-material";
import MemberAvatar from "./MemberAvatar.jsx";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import { AI_GEN_STATUS } from "../lib/itemStatusMap.js";
import { getPillBg, getTextColor } from "../theme/pillColors.js";

const STATUS_BY_ID = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id, s]));

export default function ProposedBoardRow({
  create,
  idx,
  isChecked,
  onToggle,
  promotion,
  onUpdateCreate,
  onUpdatePromotion,
  itemsById,
  creates,
  users = [],
  categories = [],
  tags = [],
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(create.title || "");
  const [statusAnchor, setStatusAnchor] = useState(null);
  const [assigneeAnchor, setAssigneeAnchor] = useState(null);
  const [categoryAnchor, setCategoryAnchor] = useState(null);
  const [tagsAnchor, setTagsAnchor] = useState(null);

  const promo = promotion || {};
  const statusId = promo.statusId ?? AI_GEN_STATUS;
  const status = STATUS_BY_ID[statusId];
  const assigneeIds = promo.assigneeIds || [];
  const assignees = assigneeIds.map((uid) => users.find((u) => u.id === uid)).filter(Boolean);
  const category = categories.find((c) => c.id === promo.categoryId) || null;
  const selectedTagIds = promo.tagIds || [];
  const selectedTags = selectedTagIds.map((id) => tags.find((t) => t.id === id)).filter(Boolean);
  const isSubitem = Boolean(create.parentRef);

  // Resolve parent badge label from parentRef
  let parentLabel = null;
  if (create.parentRef) {
    if (create.parentRef.startsWith("new:")) {
      const n = parseInt(create.parentRef.slice(4), 10);
      const pc = creates[n];
      parentLabel = pc ? `${pc.title} (new)` : `new task #${n}`;
    } else {
      parentLabel = itemsById.get(create.parentRef)?.title || create.parentRef;
    }
  }

  const handleTitleBlur = () => {
    setEditingTitle(false);
    if (titleValue !== create.title) {
      onUpdateCreate(idx, "title", titleValue);
    }
  };

  const handleTitleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleBlur();
    }
    if (e.key === "Escape") {
      setTitleValue(create.title || "");
      setEditingTitle(false);
    }
  };

  const showSep = Boolean(category) && selectedTags.length > 0;

  return (
    <Box
      sx={{
        py: 0.75,
        px: 1.5,
        pl: isSubitem ? 4 : 1.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        opacity: isChecked ? 1 : 0.5,
        "&:last-child": { borderBottom: "none" },
      }}
    >
      {/* Row 1: checkbox · title · parent badge · status pill · assignee */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Checkbox
          size="small"
          checked={isChecked}
          onChange={onToggle}
          sx={{ p: 0.25, flexShrink: 0 }}
        />

        {editingTitle && isChecked ? (
          <TextField
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKey}
            variant="standard"
            size="small"
            autoFocus
            sx={{
              flex: 1,
              minWidth: 0,
              "& .MuiInput-input": { fontWeight: 600, fontSize: "0.8125rem" },
            }}
          />
        ) : (
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              minWidth: 0,
              fontWeight: 600,
              fontSize: "0.8125rem",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              cursor: isChecked ? "pointer" : "default",
              "&:hover": isChecked ? { textDecoration: "underline" } : {},
            }}
            onClick={() => isChecked && setEditingTitle(true)}
          >
            {titleValue || create.title || "Untitled"}
          </Typography>
        )}

        {parentLabel && (
          <Typography
            variant="caption"
            sx={{
              bgcolor: "action.hover",
              px: 0.75,
              py: 0.25,
              borderRadius: 2,
              flexShrink: 0,
              color: "text.secondary",
            }}
          >
            ↳ {parentLabel}
          </Typography>
        )}

        {/* Status pill */}
        <MuiChip
          label={status?.name || "—"}
          size="small"
          sx={{
            bgcolor: getPillBg(status?.color),
            color: getTextColor(status?.color),
            fontWeight: 600,
            fontSize: "0.68rem",
            height: 19,
            "& .MuiChip-label": { px: 0.6 },
            cursor: isChecked ? "pointer" : "default",
            flexShrink: 0,
          }}
          onClick={isChecked ? (e) => setStatusAnchor(e.currentTarget) : undefined}
        />
        {isChecked && (
          <Menu
            anchorEl={statusAnchor}
            open={Boolean(statusAnchor)}
            onClose={() => setStatusAnchor(null)}
          >
            {STATUS_OPTIONS.map((s) => (
              <MenuItem
                key={s.id}
                onClick={() => {
                  setStatusAnchor(null);
                  onUpdatePromotion(idx, { statusId: s.id });
                }}
              >
                <MuiChip
                  label={s.name}
                  size="small"
                  sx={{
                    bgcolor: getPillBg(s.color),
                    color: getTextColor(s.color),
                    fontWeight: 600,
                    width: "100%",
                  }}
                />
              </MenuItem>
            ))}
          </Menu>
        )}

        {/* Assignee avatars or dash */}
        {assignees.length > 0 ? (
          <Box
            onClick={isChecked ? (e) => setAssigneeAnchor(e.currentTarget) : undefined}
            sx={{ cursor: isChecked ? "pointer" : "default", flexShrink: 0 }}
          >
            <MemberAvatar users={assignees} size={22} max={3} />
          </Box>
        ) : (
          <Typography
            variant="body2"
            sx={{
              color: "text.disabled",
              cursor: isChecked ? "pointer" : "default",
              flexShrink: 0,
            }}
            onClick={isChecked ? (e) => setAssigneeAnchor(e.currentTarget) : undefined}
          >
            —
          </Typography>
        )}
        {isChecked && (
          <Menu
            anchorEl={assigneeAnchor}
            open={Boolean(assigneeAnchor)}
            onClose={() => setAssigneeAnchor(null)}
          >
            {users
              .filter((u) => u.active !== false)
              .map((u) => {
                const sel = assigneeIds.includes(u.id);
                return (
                  <MenuItem
                    key={u.id}
                    selected={sel}
                    onClick={() => {
                      const next = sel
                        ? assigneeIds.filter((id) => id !== u.id)
                        : [...assigneeIds, u.id];
                      onUpdatePromotion(idx, { assigneeIds: next });
                    }}
                    sx={{ gap: 1.5 }}
                  >
                    <MemberAvatar user={u} size={22} />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {u.displayName || u.email}
                    </Typography>
                    {sel && <Check sx={{ fontSize: 16, color: "primary.main" }} />}
                  </MenuItem>
                );
              })}
          </Menu>
        )}
      </Box>

      {/* Row 2: category pill · tag dots + names */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mt: 0.5,
          pl: 3,
          flexWrap: "wrap",
        }}
      >
        {/* Category — bordered pill */}
        {category ? (
          <Box
            onClick={isChecked ? (e) => setCategoryAnchor(e.currentTarget) : undefined}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              px: 1,
              py: 0.25,
              borderRadius: 2,
              border: `1.5px solid ${category.color}`,
              bgcolor: getPillBg(category.color),
              color: getTextColor(category.color),
              fontSize: "0.68rem",
              fontWeight: 600,
              cursor: isChecked ? "pointer" : "default",
              "&:hover": isChecked ? { filter: "brightness(0.92)" } : {},
              flexShrink: 0,
            }}
          >
            {category.name}
          </Box>
        ) : (
          <Box
            onClick={isChecked ? (e) => setCategoryAnchor(e.currentTarget) : undefined}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              px: 1,
              py: 0.25,
              borderRadius: 2,
              border: "1.5px solid",
              borderColor: "divider",
              color: "text.disabled",
              fontSize: "0.68rem",
              cursor: isChecked ? "pointer" : "default",
              flexShrink: 0,
            }}
          >
            + category
          </Box>
        )}
        {isChecked && (
          <Menu
            anchorEl={categoryAnchor}
            open={Boolean(categoryAnchor)}
            onClose={() => setCategoryAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                setCategoryAnchor(null);
                onUpdatePromotion(idx, { categoryId: null });
              }}
            >
              <Typography variant="body2">None</Typography>
            </MenuItem>
            {categories.map((c) => (
              <MenuItem
                key={c.id}
                selected={c.id === promo.categoryId}
                onClick={() => {
                  setCategoryAnchor(null);
                  onUpdatePromotion(idx, { categoryId: c.id });
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: c.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2">{c.name}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Menu>
        )}

        {/* Separator dot — only when category + tags both present */}
        {showSep && (
          <Typography sx={{ color: "divider", fontSize: "0.75rem" }}>·</Typography>
        )}

        {/* Tags — colored dot + plain text */}
        {selectedTags.map((t) => (
          <Box
            key={t.id}
            onClick={isChecked ? (e) => setTagsAnchor(e.currentTarget) : undefined}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              cursor: isChecked ? "pointer" : "default",
              flexShrink: 0,
              "&:hover .tag-name": isChecked ? { color: "primary.main" } : {},
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: t.color,
                flexShrink: 0,
              }}
            />
            <Typography
              variant="body2"
              className="tag-name"
              sx={{ fontSize: "0.75rem", fontWeight: 500 }}
            >
              {t.name}
            </Typography>
          </Box>
        ))}
        {selectedTags.length === 0 && (
          <Typography
            variant="body2"
            sx={{
              color: "text.disabled",
              fontSize: "0.75rem",
              cursor: isChecked ? "pointer" : "default",
            }}
            onClick={isChecked ? (e) => setTagsAnchor(e.currentTarget) : undefined}
          >
            + tags
          </Typography>
        )}
        {isChecked && (
          <Menu
            anchorEl={tagsAnchor}
            open={Boolean(tagsAnchor)}
            onClose={() => setTagsAnchor(null)}
          >
            {tags.map((t) => {
              const sel = selectedTagIds.includes(t.id);
              return (
                <MenuItem
                  key={t.id}
                  selected={sel}
                  onClick={() => {
                    const next = sel
                      ? selectedTagIds.filter((id) => id !== t.id)
                      : [...selectedTagIds, t.id];
                    onUpdatePromotion(idx, { tagIds: next });
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        bgcolor: t.color,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {t.name}
                    </Typography>
                    {sel && <Check sx={{ fontSize: 16, color: "primary.main" }} />}
                  </Box>
                </MenuItem>
              );
            })}
            {selectedTagIds.length > 0 && (
              <MenuItem
                onClick={() => {
                  setTagsAnchor(null);
                  onUpdatePromotion(idx, { tagIds: [] });
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Clear all
                </Typography>
              </MenuItem>
            )}
          </Menu>
        )}
      </Box>

      {/* Row 3: AI note — read-only, dimmed italic */}
      {create.note && (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 0.5,
            pl: 3,
            color: "text.disabled",
            fontStyle: "italic",
            lineHeight: 1.35,
          }}
        >
          {create.note}
        </Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 1.4: Run tests — confirm all 13 pass**

```bash
npm test -- ProposedBoardRow
```

Expected: `Test Files 1 passed (1)` — 13 tests pass

- [ ] **Step 1.5: Commit**

```bash
git add src/components/ProposedBoardRow.jsx src/components/__tests__/ProposedBoardRow.test.jsx
git commit -m "feat: add ProposedBoardRow — board-style proposed create row"
```

---

## Task 2: Expand promotions state in `SyncMeetingDialog`

**Files:**
- Modify: `src/components/SyncMeetingDialog.jsx`

Changes in this task are logic-only (no render change yet): expand `promotions` shape, seed `categoryId`/`tagIds` in `applyValidation`, replace `setPromoStatus`/`setPromoAssignees` with generic `updatePromotion`.

- [ ] **Step 2.1: Add `inheritKeysForCreate` import**

At the top of `SyncMeetingDialog.jsx`, line 45 imports from `syncMeeting.js`:

```js
// Before:
import { validateProposal, normalizeTopicRefs, classifyTopicChanges } from "../lib/syncMeeting.js";

// After:
import { validateProposal, normalizeTopicRefs, classifyTopicChanges, inheritKeysForCreate } from "../lib/syncMeeting.js";
```

- [ ] **Step 2.2: Remove `AI_GEN_OPTION` and `PROMOTE_STATUSES` constants**

Delete lines 52–53 (the two module-level constants). They are replaced by `STATUS_OPTIONS` directly inside `ProposedBoardRow`:

```js
// DELETE these two lines:
const AI_GEN_OPTION = STATUS_OPTIONS.find((s) => s.id === AI_GEN_STATUS);
const PROMOTE_STATUSES = STATUS_OPTIONS.filter((s) => Object.prototype.hasOwnProperty.call(STATUS_MAP, s.name));
```

Also remove the `STATUS_MAP` import since it's no longer used in the dialog (only `AI_GEN_STATUS` is still needed):

```js
// Before:
import { STATUS_MAP, AI_GEN_STATUS } from "../lib/itemStatusMap.js";

// After:
import { AI_GEN_STATUS } from "../lib/itemStatusMap.js";
```

- [ ] **Step 2.3: Expand `applyValidation` — add `topicsById` + seed `categoryId`/`tagIds`**

Inside the `applyValidation` function (around line 193), replace the `initPromotions` block:

```js
// Before (lines ~193-199):
const initPromotions = {};
creates.forEach((c, i) => {
  if (accepted.has(c)) {
    const assigneeIds = inferAssigneeIds(c.note, users);
    initPromotions[i] = { statusId: AI_GEN_STATUS, ...(assigneeIds.length ? { assigneeIds } : {}) };
  }
});

// After:
const initPromotions = {};
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

- [ ] **Step 2.4: Replace `setPromoStatus` + `setPromoAssignees` with `updatePromotion`**

Delete the two setter functions (lines ~317–338) and add `updatePromotion` in their place:

```js
// DELETE these two functions entirely:
const setPromoStatus = (idx, statusId) => { ... };
const setPromoAssignees = (idx, assigneeIds) => { ... };

// ADD in their place:
const updatePromotion = (idx, patch) =>
  setPromotions((prev) => ({ ...prev, [idx]: { ...(prev[idx] || {}), ...patch } }));
```

- [ ] **Step 2.5: Verify dev server still starts (no crash on `apply`)**

```bash
npm run dev -- --force
```

The dialog's `apply` function references `promotions` but not the old setters — verify no import/reference errors in the console. The creates section still renders the old form-fields at this point (that changes in Task 3).

- [ ] **Step 2.6: Commit**

```bash
git add src/components/SyncMeetingDialog.jsx
git commit -m "refactor(sync-dialog): expand promotions to carry categoryId/tagIds; add updatePromotion"
```

---

## Task 3: Replace creates section with `ProposedBoardRow` board layout

**Files:**
- Modify: `src/components/SyncMeetingDialog.jsx`

This is the largest single change: the entire creates form-field block (lines ~581–706) is replaced with a group-header + ProposedBoardRow map.

- [ ] **Step 3.1: Add `ProposedBoardRow` import**

At the top of `SyncMeetingDialog.jsx`, after the other component imports:

```js
import ProposedBoardRow from "./ProposedBoardRow.jsx";
```

- [ ] **Step 3.2: Build `STATUS_BY_ID` and `STATUS_BY_NAME` at module level**

After the existing `import { STATUS_OPTIONS }` line, add:

```js
const STATUS_BY_ID   = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id,   s]));
const STATUS_BY_NAME = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.name, s]));
```

These are used by the moves section in Task 4 but add them now so they're present.

- [ ] **Step 3.3: Replace the creates block**

Find the creates JSX block (starts with `{creates.length > 0 && (` around line 581) and replace the entire block including the wrapping `<Box>`:

```jsx
// REPLACE the entire creates block (from {creates.length > 0 && ( through the closing )} )
// with:

{creates.length > 0 && (
  <Box sx={{ mb: 2 }}>
    {/* "New Items" group header — matches MiniProjectBoard GroupHeader style */}
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.8,
        py: 0.5,
        px: 1,
        background: (theme) => `${theme.palette.primary.main}0D`,
        borderLeft: "3px solid",
        borderColor: "primary.main",
        borderRadius: 0.5,
        mb: 0.5,
        userSelect: "none",
      }}
    >
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "primary.main" }}>
        New Items
      </Typography>
      <Typography sx={{ fontSize: 10, color: "primary.main", opacity: 0.7, ml: 0.3 }}>
        ({creates.filter((_, i) => validCreateIdxs.has(i)).length})
      </Typography>
    </Box>
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      {creates.map((c, i) => {
        if (!validCreateIdxs.has(i)) return null;
        return (
          <ProposedBoardRow
            key={i}
            create={c}
            idx={i}
            isChecked={selCreates.has(i)}
            onToggle={() => toggle(setSelCreates, (idx) => validCreateIdxs.has(idx))(i)}
            promotion={promotions[i]}
            onUpdateCreate={setCreateField}
            onUpdatePromotion={updatePromotion}
            itemsById={itemsById}
            creates={creates}
            users={users || []}
            categories={_categories || []}
            tags={_tags || []}
          />
        );
      })}
    </Box>
  </Box>
)}
```

- [ ] **Step 3.4: Remove dead MUI imports**

`FormControl`, `InputLabel`, and `Select` are no longer used in the dialog. Remove them from the import block at the top:

```js
// Before:
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

// After (remove FormControl, InputLabel, Select):
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
```

- [ ] **Step 3.5: Smoke-test in dev server — open Sync Meeting dialog and reach review step**

```bash
npm run dev -- --force
```

Navigate to an agenda → open Sync Meeting → Generate (or use a cached proposal if one exists). Verify:
- Creates section shows "NEW ITEMS" group header in blue
- Each accepted create renders as a ProposedBoardRow
- Title is clickable/editable
- Status pill, assignee, category, tag all visible and clickable
- Unchecking a row greys it out

- [ ] **Step 3.6: Commit**

```bash
git add src/components/SyncMeetingDialog.jsx
git commit -m "feat(sync-dialog): replace creates form-fields with ProposedBoardRow board layout"
```

---

## Task 4: Replace moves section with pill → arrow → pill layout

**Files:**
- Modify: `src/components/SyncMeetingDialog.jsx`

- [ ] **Step 4.1: Replace the moves block**

Find the moves JSX block (starts with `{moves.length > 0 && (` around line 708) and replace it:

```jsx
// REPLACE the entire moves block with:

{moves.length > 0 && (
  <Box sx={{ mb: 2 }}>
    {/* "Status Updates" group header — orange, same pattern as "New Items" */}
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.8,
        py: 0.5,
        px: 1,
        background: "#f57c000D",
        borderLeft: "3px solid #f57c00",
        borderRadius: 0.5,
        mb: 0.5,
        userSelect: "none",
      }}
    >
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#f57c00" }}>
        Status Updates
      </Typography>
      <Typography sx={{ fontSize: 10, color: "#f57c00", opacity: 0.7, ml: 0.3 }}>
        ({moves.filter((m) => !droppedMoves.includes(m)).length})
      </Typography>
    </Box>
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      {moves.map((m, i) => {
        if (droppedMoves.includes(m)) return null;
        const curStatus = STATUS_BY_ID[itemsById.get(m.itemId)?.statusId];
        const toStatus = STATUS_BY_NAME[m.toStatus];
        return (
          <Box
            key={i}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1.5,
              py: 0.75,
              borderBottom: "1px solid",
              borderColor: "divider",
              "&:last-child": { borderBottom: "none" },
              opacity: selMoves.has(i) ? 1 : 0.5,
            }}
          >
            <Checkbox
              size="small"
              checked={selMoves.has(i)}
              onChange={() => toggle(setSelMoves)(i)}
              sx={{ p: 0.25, flexShrink: 0 }}
            />
            <Typography
              variant="body2"
              sx={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: "0.8125rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {m.title}
            </Typography>
            <Chip
              label={curStatus?.name || "?"}
              size="small"
              sx={{
                bgcolor: getPillBg(curStatus?.color),
                color: getTextColor(curStatus?.color),
                fontWeight: 600,
                fontSize: "0.68rem",
                height: 19,
                "& .MuiChip-label": { px: 0.6 },
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" sx={{ color: "text.disabled", flexShrink: 0 }}>→</Typography>
            <Chip
              label={toStatus?.name || m.toStatus}
              size="small"
              sx={{
                bgcolor: getPillBg(toStatus?.color),
                color: getTextColor(toStatus?.color),
                fontWeight: 600,
                fontSize: "0.68rem",
                height: 19,
                "& .MuiChip-label": { px: 0.6 },
                flexShrink: 0,
              }}
            />
          </Box>
        );
      })}
    </Box>
  </Box>
)}
```

- [ ] **Step 4.2: Add `getPillBg`/`getTextColor` import to SyncMeetingDialog**

The moves section now uses these. Add the import near the other theme imports:

```js
import { getPillBg, getTextColor } from "../theme/pillColors.js";
```

- [ ] **Step 4.3: Smoke-test moves section**

In the dev server, trigger a Sync Meeting that has status-update proposals. Verify:
- "STATUS UPDATES" group header appears in orange
- Each move row shows: `[checkbox]  [item title]  [current status pill]  →  [proposed status pill]`
- Pills use correct colors from `STATUS_OPTIONS`
- Unchecking a row greys it out

- [ ] **Step 4.4: Run full test suite**

```bash
npm test
```

Expected: all existing tests still pass (no regressions in syncMeeting.test.js, etc.)

- [ ] **Step 4.5: Commit**

```bash
git add src/components/SyncMeetingDialog.jsx
git commit -m "feat(sync-dialog): replace moves checkbox list with pill→arrow→pill board-style rows"
```

---

## Task 5: Update `applyUnified` to prefer promotion values

**Files:**
- Modify: `src/lib/aiAgenda.js`

- [ ] **Step 5.1: Find the `inheritKeysForCreate` call in `applyUnified`**

The line is around line 615:

```js
const { categoryId, tagIds } = inheritKeysForCreate(create, topicsById);
```

- [ ] **Step 5.2: Replace with promo-preferred logic**

```js
// Before:
const { categoryId, tagIds } = inheritKeysForCreate(create, topicsById);

// After:
const inherited = inheritKeysForCreate(create, topicsById);
const categoryId = promo?.categoryId !== undefined ? promo.categoryId : inherited.categoryId;
const tagIds = promo?.tagIds !== undefined ? promo.tagIds : inherited.tagIds;
```

`promo` is already defined earlier in the same `acceptedCreates.forEach` loop as `const promo = promotions[idx];`.

- [ ] **Step 5.3: Run tests to confirm no regressions**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5.4: Verify apply flow end-to-end in the dev server**

Run a full Sync Meeting on any client agenda:
1. Generate → wait for proposal
2. In the review step, edit a create's category or tags using the new menus
3. Click Apply
4. Navigate to the Project Board and verify the new item has the category/tags you selected (not the topic-inherited ones)
5. Verify Notes section is unchanged

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/aiAgenda.js
git commit -m "fix(apply-unified): prefer promo categoryId/tagIds over topic-inherited values"
```

---

## Verification Checklist

Before marking this feature done, verify each item from spec Section 8:

- [ ] Review step shows "NEW ITEMS" group — no TextFields/Selects visible in creates section
- [ ] Click title → edits inline; blur saves to proposal state
- [ ] Click status pill → MUI Menu; selecting changes pill color
- [ ] Click assignee `—` / avatar → menu; selecting toggles avatar
- [ ] Click category pill → menu; selecting updates pill (shows bordered pill with category color)
- [ ] Click `+ tags` or tag text → menu; selecting adds/removes dot+text tags
- [ ] Separator `·` visible only when both category and tags are set; hidden when either is empty
- [ ] Uncheck a row → row greys out, fields non-interactive
- [ ] "STATUS UPDATES" group header shows in orange
- [ ] Move rows show `pill → → pill` (current status → proposed status) with correct colors
- [ ] Notes section visually unchanged
- [ ] Apply → new items land on board with edited title, status, assignee, category, tags
- [ ] `create.note` stored as item `description` in Firestore (verify in Firestore console)
- [ ] `npm test` passes clean with no regressions
