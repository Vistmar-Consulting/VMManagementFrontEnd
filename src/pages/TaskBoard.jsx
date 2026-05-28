// Ported from _PM_Archive_From_Console_2026-05-12/src/pages/pages/TaskBoard.jsx
// Monday.com-style table with three collapsible groups (Active / Completed /
// Archive), 14-column TaskBoardRow, sortable + filterable headers, status
// scorecards row, organization filter chip group.
//
// Differences from archive: Firestore data layer (useCollection +
// onSnapshot, direct writes via updateDoc/deleteDoc), camelCase fields,
// per-org categories/tags scoped via subcollections. DnD reorder + comments
// modal are follow-up slices.

import { useMemo, useState } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import {
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Search as SearchIcon,
} from "@mui/icons-material";

import ColorPicker from "../components/ColorPicker.jsx";
import TaskBoardColumnHeader from "../components/TaskBoardColumnHeader.jsx";
import TaskBoardFilesModal from "../components/TaskBoardFilesModal.jsx";
import TaskBoardModal from "../components/TaskBoardModal.jsx";
import TaskBoardRow from "../components/TaskBoardRow.jsx";
import { PRIORITY_LIST } from "../constants/itemPriorities.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { db } from "../firebase.js";
import { useCollection } from "../hooks/useCollection.js";
import { useCollectionGroup } from "../hooks/useCollectionGroup.js";
import { useItems } from "../hooks/useItems.js";
import { CATEGORY_COLORS, TAG_COLORS } from "../seed/archiveData.js";

const STATUSES = [
  // AI Gen first — items AI-suggested from upcoming Fireflies / agenda
  // pipelines, awaiting human confirmation. See TaskBoardRow STATUS_OPTIONS.
  { id: 8, name: "AI Gen",      color: "#00bcd4" },
  { id: 1, name: "Assigned",    color: "#7b61ff" },
  { id: 2, name: "In Progress", color: "#2196f3" },
  { id: 6, name: "Pending",     color: "#f5a623" },
  { id: 4, name: "Review",      color: "#9c6ade" },
  { id: 5, name: "Done",        color: "#4caf50" },
  { id: 7, name: "Archive",     color: "#9e9e9e" },
];

const DONE = 5;
const ARCHIVE = 7;

const SCORECARDS = [
  { key: "assigned",   label: "Assigned",     color: "#7b61ff", match: (i) => i.statusId === 1 && !i.onHold },
  { key: "inProgress", label: "In Progress",  color: "#2196f3", match: (i) => i.statusId === 2 && !i.onHold },
  { key: "review",     label: "Review",       color: "#9c6ade", match: (i) => i.statusId === 4 },
  { key: "onHold",     label: "On Hold",      color: "#e74c3c", match: (i) => i.onHold === true },
  { key: "done",       label: "Done",         color: "#4caf50", match: (i) => i.statusId === DONE },
  { key: "overdue",    label: "Overdue",      color: "#d32f2f", match: (i) => i.dueDate && tsToDate(i.dueDate) < new Date() && i.statusId !== DONE && i.statusId !== ARCHIVE },
  { key: "dueThisWk",  label: "Due This Wk",  color: "#ef6c00", match: (i) => i.dueDate && isDueThisWeek(tsToDate(i.dueDate)) && i.statusId !== DONE && i.statusId !== ARCHIVE },
];

function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

// "Due This Wk" = dueDate falls within the CURRENT business week,
// Monday 00:00 → Friday 23:59:59 (local time). Weekend due dates and
// next-week dates are excluded. An item due Monday that's now past is
// still considered "this week" (it will also appear in "Overdue").
function isDueThisWeek(date) {
  if (!date) return false;
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  // Step back to Monday: Sunday → -6, Mon → 0, Tue → -1, …, Sat → -5.
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  const t = date.getTime();
  return t >= monday.getTime() && t <= friday.getTime();
}

export default function TaskBoard() {
  const { user, isAdmin } = useAuth();
  const { data: allItems, loading: itemsLoading, error: itemsError } = useItems();
  const { data: orgs } = useCollection("organizations");
  const { data: users } = useCollection("users");

  // Shared top-level categories + tags (per Andy 2026-05-27 — Org_Id stripped
  // from Console's per-org model). Row dropdowns offer all values; column-
  // header filter popovers reduce to values actually used by visible items
  // (built below from `topLevel`).
  const { data: categories } = useCollection("categories");
  const { data: tags } = useCollection("tags");

  // All comments across all items — used to drive the notes badge count
  // on every row without N per-item subscriptions. Each comment doc has
  // a denormalized `itemId` field so we can group locally.
  const { data: allComments } = useCollectionGroup("comments");
  const commentCountByItemId = useMemo(() => {
    const m = {};
    for (const c of allComments) {
      if (c.itemId) m[c.itemId] = (m[c.itemId] || 0) + 1;
    }
    return m;
  }, [allComments]);
  const getCommentCount = (itemId) => commentCountByItemId[itemId] || 0;

  // Same shape for file links (URL links only in V1; file uploads land
  // when Blaze enables Firebase Storage).
  const { data: allFiles } = useCollectionGroup("files");
  const fileCountByItemId = useMemo(() => {
    const m = {};
    for (const f of allFiles) {
      if (f.itemId) m[f.itemId] = (m[f.itemId] || 0) + 1;
    }
    return m;
  }, [allFiles]);
  const getFileCount = (itemId) => fileCountByItemId[itemId] || 0;

  // Notes + Files modal state — which item's modal is currently open.
  const [notesModalItem, setNotesModalItem] = useState(null);
  const [filesModalItem, setFilesModalItem] = useState(null);

  // Per-row expansion state lifted from TaskBoardRow so the "expand all /
  // collapse all" header button can toggle everything at once.
  const [expandedItemIds, setExpandedItemIds] = useState(() => new Set());
  const setItemExpanded = (id, val) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (val) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Org filter chip group — persisted in localStorage.
  const [orgFilter, setOrgFilter] = useLocalStorage("vm-board-org-filter", "all");

  // Column sort + filter state.
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [userHasSorted, setUserHasSorted] = useState(false);
  const [columnFilters, setColumnFilters] = useState({});
  const [titleSearch, setTitleSearch] = useState("");

  // Scorecard single-select filter.
  const [scorecardFilter, setScorecardFilter] = useState(null);

  // Group expanded state.
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  // Filter predicates — extracted so we can apply them to BOTH parents and
  // subitems (used by the parent-or-subitem-match logic below).
  // Note: organizationId is parent-level — subitems inherit their parent's
  // org at create-time, so the org filter is checked against the parent only.
  const matchesNonOrgFilters = useMemo(() => {
    const q = (titleSearch || "").trim().toLowerCase();
    const card = scorecardFilter ? SCORECARDS.find((c) => c.key === scorecardFilter) : null;
    const activeCols = Object.entries(columnFilters).filter(([, v]) => v && v.length > 0);
    return (item) => {
      if (q) {
        const title = (item.title || "").toLowerCase();
        const desc = (item.description || "").toLowerCase();
        if (!title.includes(q) && !desc.includes(q)) return false;
      }
      if (card && !card.match(item)) return false;
      for (const [field, values] of activeCols) {
        if (field === "assigneeIds") {
          if (!(item.assigneeIds || []).some((id) => values.includes(id))) return false;
        } else if (field === "tagIds") {
          if (!(item.tagIds || []).some((id) => values.includes(id))) return false;
        } else if (!values.includes(item[field])) {
          return false;
        }
      }
      return true;
    };
  }, [titleSearch, scorecardFilter, columnFilters]);

  // Subitems map: parentId → subitems array. Built first because the
  // top-level filter consults it to do the parent-or-subitem-match check.
  // This is the FULL map — used internally by counts (delete cascade, etc.).
  // Rendering uses `visibleSubitemsByParent` below which respects the filter.
  const subitemsByParent = useMemo(() => {
    const map = {};
    for (const item of allItems) {
      if (item.parentId) {
        if (!map[item.parentId]) map[item.parentId] = [];
        map[item.parentId].push(item);
      }
    }
    return map;
  }, [allItems]);

  // Whether any non-org filter is currently active.
  const hasAnyFilter = useMemo(() => {
    return Boolean(titleSearch)
      || Boolean(scorecardFilter)
      || Object.values(columnFilters).some((v) => v && v.length > 0);
  }, [titleSearch, scorecardFilter, columnFilters]);

  // What gets RENDERED under an expanded parent. When any filter is active,
  // narrow each parent's subitems to those that match the filter; otherwise
  // pass through the full set. This is what TaskBoardRow consumes.
  const visibleSubitemsByParent = useMemo(() => {
    if (!hasAnyFilter) return subitemsByParent;
    const out = {};
    for (const [parentId, subs] of Object.entries(subitemsByParent)) {
      out[parentId] = subs.filter(matchesNonOrgFilters);
    }
    return out;
  }, [subitemsByParent, matchesNonOrgFilters, hasAnyFilter]);

  // Top-level items: keep if the parent itself passes filters OR any of
  // its subitems does (so a match deep in the tree pulls its parent up
  // into view). Org filter applies to parent only (subitems inherit).
  const topLevel = useMemo(() => {
    return allItems
      .filter((item) => item.parentId == null)
      .filter((item) => orgFilter === "all" || item.organizationId === orgFilter)
      .filter((item) => {
        if (matchesNonOrgFilters(item)) return true;
        const subs = subitemsByParent[item.id] || [];
        return subs.some(matchesNonOrgFilters);
      });
  }, [allItems, orgFilter, matchesNonOrgFilters, subitemsByParent]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortField) return topLevel;
    const categoryNameById = new Map(categories.map((c) => [c.id, (c.name || "").toLowerCase()]));
    const getVal = (item) => {
      switch (sortField) {
        case "title": return (item.title || "").toLowerCase();
        case "id": return item.itemNumber ?? Infinity;
        case "statusId":
        case "priorityId": return item[sortField] ?? 999;
        case "dueDate": return item.dueDate ? tsToDate(item.dueDate).getTime() : Infinity;
        case "updatedAt": return item.updatedAt ? tsToDate(item.updatedAt).getTime() : 0;
        case "createdAt": return item.createdAt ? tsToDate(item.createdAt).getTime() : 0;
        // Sort categories by NAME (the visible label), not by raw id —
        // raw ids are numeric-string sequences and produce nonsense order.
        case "categoryId": return categoryNameById.get(item.categoryId) || "zzz";
        default: return item[sortField] ?? "";
      }
    };
    return [...topLevel].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av < bv) return sortDirection === "asc" ? -1 : 1;
      if (av > bv) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [topLevel, sortField, sortDirection, categories]);

  const activeItems = sorted.filter((i) => i.statusId !== DONE && i.statusId !== ARCHIVE);
  const completedItems = sorted.filter((i) => i.statusId === DONE);
  const archiveItems = sorted.filter((i) => i.statusId === ARCHIVE);

  // Toggle-all logic: expand-all button shows when at least one expandable
  // item is collapsed; otherwise collapse-all. Only items with children
  // count toward "expandable" — leaves don't matter.
  const expandableIds = useMemo(() => {
    const ids = new Set();
    for (const item of sorted) {
      if ((subitemsByParent[item.id] || []).length > 0) ids.add(item.id);
    }
    return ids;
  }, [sorted, subitemsByParent]);

  // Filter-driven auto-expand: if a parent is in the visible set only
  // because one of its subitems matches the filter, force-expand it so
  // the matching subitem is actually rendered.
  const filterForceExpandedIds = useMemo(() => {
    if (!hasAnyFilter) return new Set();
    const ids = new Set();
    for (const item of sorted) {
      const subs = subitemsByParent[item.id] || [];
      if (subs.some(matchesNonOrgFilters)) ids.add(item.id);
    }
    return ids;
  }, [sorted, subitemsByParent, matchesNonOrgFilters, hasAnyFilter]);

  const isItemExpanded = (id) => expandedItemIds.has(id) || filterForceExpandedIds.has(id);

  const allExpanded = expandableIds.size > 0
    && Array.from(expandableIds).every(isItemExpanded);

  const toggleAllExpanded = () => {
    if (allExpanded) setExpandedItemIds(new Set());
    else setExpandedItemIds(new Set(expandableIds));
  };

  // Sort handler
  const handleSort = (field, direction) => {
    setUserHasSorted(true);
    if (direction) {
      setSortField(field);
      setSortDirection(direction);
    } else if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleFilterChange = (field, values) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!values || values.length === 0) delete next[field];
      else next[field] = values;
      return next;
    });
  };

  // Firestore writes
  const handleUpdate = async (itemId, patch) => {
    await updateDoc(doc(db, "items", itemId), { ...patch, updatedAt: serverTimestamp() });
  };

  // Delete confirmation dialog state. Set via handleRequestDelete from the
  // row's action menu; cleared on Cancel or after Confirm completes.
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const handleRequestDelete = (item, isSubitem) => {
    const subCount = !isSubitem ? (subitemsByParent[item.id] || []).length : 0;
    setDeleteConfirm({ item, isSubitem, subitemCount: subCount });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    const { item, isSubitem } = deleteConfirm;
    // Atomic cascade: parent + all children commit together so a
    // Firestore hiccup can't leave subitems orphaned with no parent.
    const batch = writeBatch(db);
    if (!isSubitem) {
      const subs = subitemsByParent[item.id] || [];
      subs.forEach((s) => batch.delete(doc(db, "items", s.id)));
    }
    batch.delete(doc(db, "items", item.id));
    await batch.commit();
    setDeleteConfirm(null);
  };

  // ───── Category CRUD ─────
  // Add+Edit share one dialog. State shape: null | { mode, id?, name, color }.
  const [categoryDialog, setCategoryDialog] = useState(null);
  const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState(null);

  const openAddCategory = () => setCategoryDialog({ mode: "add", name: "", color: CATEGORY_COLORS[0] });
  const openEditCategory = (catId) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return;
    setCategoryDialog({ mode: "edit", id: catId, name: cat.name, color: cat.color });
  };
  const requestDeleteCategory = (catId) => setDeleteCategoryConfirm(catId);

  const handleSaveCategory = async () => {
    const name = categoryDialog?.name?.trim();
    if (!name) return;
    if (categoryDialog.mode === "add") {
      await addDoc(collection(db, "categories"), {
        name,
        color: categoryDialog.color,
        sortOrder: categories.length + 1,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, "categories", categoryDialog.id), {
        name,
        color: categoryDialog.color,
      });
    }
    setCategoryDialog(null);
  };

  const handleConfirmDeleteCategory = async () => {
    const catId = deleteCategoryConfirm;
    if (!catId) return;
    // Atomic: clear categoryId on every affected item AND delete the
    // category doc in one batch. Prevents the partial-failure mode where
    // the category is gone but items still reference its id.
    const affected = allItems.filter((i) => i.categoryId === catId);
    const batch = writeBatch(db);
    affected.forEach((i) => {
      batch.update(doc(db, "items", i.id), {
        categoryId: null,
        updatedAt: serverTimestamp(),
      });
    });
    batch.delete(doc(db, "categories", catId));
    await batch.commit();
    setDeleteCategoryConfirm(null);
  };

  // ───── Tag CRUD ─────
  const [tagDialog, setTagDialog] = useState(null);
  const [deleteTagConfirm, setDeleteTagConfirm] = useState(null);

  const openAddTag = () => setTagDialog({ mode: "add", name: "", color: TAG_COLORS[0] });
  const openEditTag = (tagId) => {
    const tag = tags.find((t) => t.id === tagId);
    if (!tag) return;
    setTagDialog({ mode: "edit", id: tagId, name: tag.name, color: tag.color });
  };
  const requestDeleteTag = (tagId) => setDeleteTagConfirm(tagId);

  const handleSaveTag = async () => {
    const name = tagDialog?.name?.trim();
    if (!name) return;
    if (tagDialog.mode === "add") {
      await addDoc(collection(db, "tags"), {
        name,
        color: tagDialog.color,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, "tags", tagDialog.id), {
        name,
        color: tagDialog.color,
      });
    }
    setTagDialog(null);
  };

  const handleConfirmDeleteTag = async () => {
    const tagId = deleteTagConfirm;
    if (!tagId) return;
    // Atomic: strip the tag from every affected item AND delete the tag
    // doc in one batch — same partial-failure safety as the category path.
    const affected = allItems.filter((i) => (i.tagIds || []).includes(tagId));
    const batch = writeBatch(db);
    affected.forEach((i) => {
      const next = (i.tagIds || []).filter((t) => t !== tagId);
      batch.update(doc(db, "items", i.id), {
        tagIds: next,
        updatedAt: serverTimestamp(),
      });
    });
    batch.delete(doc(db, "tags", tagId));
    await batch.commit();
    setDeleteTagConfirm(null);
  };

  // Counts for delete-confirm dialog messages.
  const categoryUsageCount = (catId) => allItems.filter((i) => i.categoryId === catId).length;
  const tagUsageCount = (tagId) => allItems.filter((i) => (i.tagIds || []).includes(tagId)).length;

  // Compute rank for new items: place at end of current top-level list.
  const nextTopLevelOrder = () => {
    const tops = allItems.filter((i) => i.parentId == null);
    const last = tops.map((i) => i.order).filter(Boolean).sort().pop() || null;
    return generateKeyBetween(last, null);
  };

  const nextSubitemOrder = (parentId) => {
    const subs = allItems.filter((i) => i.parentId === parentId);
    const last = subs.map((i) => i.order).filter(Boolean).sort().pop() || null;
    return generateKeyBetween(last, null);
  };

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
    // Transaction atomically pulls the next item number from the org doc and
    // bumps it — prevents race when two admins add at the same time.
    await runTransaction(db, async (tx) => {
      const orgSnap = await tx.get(orgRef);
      const next = orgSnap.data()?.nextItemNumber ?? 1;
      tx.set(newItemRef, {
        organizationId: orgFilter,
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

  const handleAddSubitem = async (parentItem) => {
    const newItemRef = doc(collection(db, "items"));
    const parentRef = doc(db, "items", parentItem.id);
    const order = nextSubitemOrder(parentItem.id);
    // Subitem counter is per-parent — SI-N is unique within a single
    // parent, not across an org. Reading + bumping the counter inside
    // the transaction also makes the `hasChildren` update race-safe
    // (we read the parent in-tx, so concurrent writers serialize).
    await runTransaction(db, async (tx) => {
      const parentSnap = await tx.get(parentRef);
      const next = parentSnap.data()?.nextSubitemNumber ?? 1;
      tx.set(newItemRef, {
        organizationId: parentItem.organizationId,
        parentId: parentItem.id,
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
      tx.update(parentRef, {
        nextSubitemNumber: next + 1,
        hasChildren: true,
        updatedAt: serverTimestamp(),
      });
    });
  };

  // Categories + tags are global; pass the full list to every row.

  // Scorecard counts (computed against the full unfiltered item set, but
  // respecting the org filter so the chips reflect what the user is looking at).
  const orgScopedTopLevel = useMemo(() => {
    let r = allItems.filter((i) => i.parentId == null);
    if (orgFilter !== "all") r = r.filter((i) => i.organizationId === orgFilter);
    return r;
  }, [allItems, orgFilter]);

  const scorecardCounts = useMemo(() => {
    const counts = {};
    SCORECARDS.forEach((s) => {
      counts[s.key] = orgScopedTopLevel.filter(s.match).length;
    });
    return counts;
  }, [orgScopedTopLevel]);

  // Filter chip values for column popovers
  const priorityFilterValues = PRIORITY_LIST.map((p) => ({ value: p.id, label: p.label, color: p.color }));
  const statusFilterValues = STATUSES.map((s) => ({ value: s.id, label: s.name, color: s.color }));
  const assigneeFilterValues = users.filter((u) => u.active !== false).map((u) => ({
    value: u.id,
    label: u.displayName || u.email,
    color: null,
  }));
  // Categories + tags are global. Show ALL in the column-header popover so
  // newly-added values are immediately visible and editable. Per-org
  // reduction happens implicitly — picking a category not used in the
  // current visible set just filters to zero items.
  const categoryFilterValues = categories.map((c) => ({ value: c.id, label: c.name, color: c.color }));
  const tagFilterValues = tags.map((t) => ({ value: t.id, label: t.name, color: t.color }));

  // Group renderer
  const renderGroup = (title, groupItems, expanded, setExpanded, color) => (
    <Box sx={{ mb: 3 }}>
      <Paper sx={{ overflow: "hidden", border: "1px solid rgba(0,0,0,0.12)" }}>
        <Box
          sx={{
            backgroundColor: `${color}0D`,
            borderLeft: `3px solid ${color}`,
            px: 2,
            py: 1.25,
            display: "flex",
            alignItems: "center",
            gap: 1,
            cursor: "pointer",
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <IconButton size="small" sx={{ color }}>
            {expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          </IconButton>
          <Typography variant="h6" sx={{ color, fontWeight: 600, fontSize: "1rem" }}>{title}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500 }}>
            {groupItems.length}
          </Typography>
        </Box>
        <Collapse in={expanded}>
          <TableContainer>
            <Table sx={{ tableLayout: "fixed", width: "100%" }}>
              {renderColumnHeaders()}
              <TableBody>
                {groupItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} align="center">
                      <Typography variant="body2" py={3} sx={{ color: "text.disabled", fontStyle: "italic" }}>
                        No items
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  groupItems.map((item) => (
                    <TaskBoardRow
                      key={item.id}
                      item={item}
                      subitems={visibleSubitemsByParent[item.id] || []}
                      users={users}
                      categories={categories}
                      tags={tags}
                      canUpdate={isAdmin}
                      expanded={isItemExpanded(item.id)}
                      onSetExpanded={(val) => setItemExpanded(item.id, val)}
                      getCommentCount={getCommentCount}
                      getFileCount={getFileCount}
                      onUpdate={handleUpdate}
                      onRequestDelete={handleRequestDelete}
                      onAddSubitem={handleAddSubitem}
                      onOpenComments={(it) => setNotesModalItem(it)}
                      onOpenFiles={(it) => setFilesModalItem(it)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Collapse>
      </Paper>
    </Box>
  );

  const renderColumnHeaders = () => (
    <TableHead>
      <TableRow>
        <TableCell sx={{ width: "2%", whiteSpace: "nowrap", textAlign: "center", p: 0.5 }}>
          {expandableIds.size > 0 && (
            <Tooltip title={allExpanded ? "Collapse all" : "Expand all"} placement="top">
              <IconButton
                size="small"
                onClick={toggleAllExpanded}
                aria-label={allExpanded ? "Collapse all" : "Expand all"}
              >
                {allExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
        <TaskBoardColumnHeader
          label="Item" field="title" width="18%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TaskBoardColumnHeader
          label="ID" field="id" align="center" width="5%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TaskBoardColumnHeader
          label="Priority" field="priorityId" width="10%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted}
          filterValues={priorityFilterValues}
          selectedFilters={columnFilters.priorityId}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Status" field="statusId" width="10%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted}
          filterValues={statusFilterValues}
          selectedFilters={columnFilters.statusId}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Assigned" field="assigneeIds" align="center" width="10%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted}
          filterValues={assigneeFilterValues}
          selectedFilters={columnFilters.assigneeIds}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Category" field="categoryId" width="12%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted}
          filterValues={categoryFilterValues}
          selectedFilters={columnFilters.categoryId}
          onFilterChange={handleFilterChange}
          showAddNew
          onAddNew={openAddCategory}
          onEditItem={openEditCategory}
          onDeleteItem={requestDeleteCategory}
        />
        <TaskBoardColumnHeader
          label="Tags" field="tagIds" width="8%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted}
          filterValues={tagFilterValues}
          selectedFilters={columnFilters.tagIds}
          onFilterChange={handleFilterChange}
          showAddNew
          onAddNew={openAddTag}
          onEditItem={openEditTag}
          onDeleteItem={requestDeleteTag}
        />
        <TaskBoardColumnHeader
          label="Due" field="dueDate" width="7%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TaskBoardColumnHeader
          label="Updated" field="updatedAt" width="8%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TaskBoardColumnHeader
          label="Created" field="createdAt" width="7%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TaskBoardColumnHeader
          label="Notes" field="notes" width="4%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TaskBoardColumnHeader
          label="Files" field="files" width="4%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TableCell sx={{ width: "5%" }} />
      </TableRow>
    </TableHead>
  );

  if (itemsError) {
    return <Alert severity="error">Failed to load items: {itemsError.message}</Alert>;
  }

  return (
    <Stack spacing={4}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h4" component="h1">Project Board</Typography>
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
      </Stack>

      {/* Scorecards */}
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }} useFlexGap>
        {SCORECARDS.map((card) => {
          const selected = scorecardFilter === card.key;
          return (
            <Box
              key={card.key}
              onClick={() => setScorecardFilter(selected ? null : card.key)}
              sx={{
                px: 2.5,
                py: 1.25,
                borderRadius: 1.5,
                bgcolor: selected ? card.color : "background.paper",
                color: selected ? "#fff" : "text.primary",
                border: `1px solid ${selected ? card.color : "rgba(0,0,0,0.12)"}`,
                cursor: "pointer",
                minWidth: 110,
                transition: "all 0.15s",
                "&:hover": { borderColor: card.color },
              }}
            >
              <Typography variant="caption" sx={{ display: "block", opacity: selected ? 0.9 : 0.7, fontWeight: 500 }}>
                {card.label}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: selected ? "#fff" : card.color }}>
                {scorecardCounts[card.key]}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      {/* Organization filter chips — sorted by org.sortOrder (lower first);
          orgs missing sortOrder fall to the end, preserving Firestore order
          among them. */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }} useFlexGap>
        <Chip
          label="All"
          onClick={() => setOrgFilter("all")}
          variant={orgFilter === "all" ? "filled" : "outlined"}
          color={orgFilter === "all" ? "primary" : "default"}
          size="small"
        />
        {[...orgs].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)).map((org) => (
          <Chip
            key={org.id}
            label={org.name}
            onClick={() => setOrgFilter(org.id)}
            variant={orgFilter === org.id ? "filled" : "outlined"}
            size="small"
            sx={{
              ...(orgFilter === org.id && {
                bgcolor: org.accentColor || "primary.main",
                color: "#fff",
              }),
            }}
          />
        ))}
      </Stack>

      {/* Search bar — matches title + description across items AND subtasks.
          Cascades the same way other filters do: if a subtask's text matches
          but the parent's doesn't, the parent surfaces and auto-expands. */}
      <TextField
        size="small"
        placeholder="Search items and subtasks…"
        value={titleSearch}
        onChange={(e) => setTitleSearch(e.target.value)}
        fullWidth
        sx={{ maxWidth: 480 }}
        InputProps={{
          startAdornment: (
            <SearchIcon sx={{ fontSize: 18, color: "text.disabled", mr: 1, flexShrink: 0 }} />
          ),
          endAdornment: titleSearch ? (
            <IconButton size="small" onClick={() => setTitleSearch("")} aria-label="Clear search">
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          ) : null,
        }}
      />

      {itemsLoading && (
        <Typography variant="body2" color="text.secondary">Loading…</Typography>
      )}

      {!itemsLoading && (
        <>
          {renderGroup("Active", activeItems, activeExpanded, setActiveExpanded, "#4a90d9")}
          {renderGroup("Completed", completedItems, completedExpanded, setCompletedExpanded, "#4caf50")}
          {renderGroup("Archive", archiveItems, archiveExpanded, setArchiveExpanded, "#9e9e9e")}
        </>
      )}

      <Dialog
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>
          Delete {deleteConfirm?.isSubitem ? "subtask" : "item"}?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
            {deleteConfirm?.item?.title || "Untitled"}
          </Typography>
          {deleteConfirm?.subitemCount > 0 && (
            <Typography variant="body2" color="text.secondary">
              This will also delete {deleteConfirm.subitemCount} subtask{deleteConfirm.subitemCount > 1 ? "s" : ""}.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* ───────── Category Add/Edit ───────── */}
      <Dialog open={Boolean(categoryDialog)} onClose={() => setCategoryDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{categoryDialog?.mode === "edit" ? "Edit category" : "Add category"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Category name"
            value={categoryDialog?.name || ""}
            onChange={(e) => setCategoryDialog((s) => ({ ...s, name: e.target.value }))}
            variant="outlined"
            margin="normal"
          />
          <Box sx={{ mt: 2 }}>
            <ColorPicker
              color={categoryDialog?.color || CATEGORY_COLORS[0]}
              onChange={(color) => setCategoryDialog((s) => ({ ...s, color }))}
              presets={CATEGORY_COLORS}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCategoryDialog(null)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleSaveCategory} disabled={!categoryDialog?.name?.trim()}>
            {categoryDialog?.mode === "edit" ? "Save" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ───────── Category Delete Confirm ───────── */}
      <Dialog open={Boolean(deleteCategoryConfirm)} onClose={() => setDeleteCategoryConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Delete category?</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
            {categories.find((c) => c.id === deleteCategoryConfirm)?.name || "Untitled"}
          </Typography>
          {(() => {
            const n = categoryUsageCount(deleteCategoryConfirm);
            if (n === 0) return (
              <Typography variant="body2" color="text.secondary">No items currently use this category.</Typography>
            );
            return (
              <Typography variant="body2" color="text.secondary">
                {n} item{n > 1 ? "s" : ""} will have their category cleared.
              </Typography>
            );
          })()}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteCategoryConfirm(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirmDeleteCategory}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* ───────── Tag Add/Edit ───────── */}
      <Dialog open={Boolean(tagDialog)} onClose={() => setTagDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{tagDialog?.mode === "edit" ? "Edit tag" : "Add tag"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Tag name"
            value={tagDialog?.name || ""}
            onChange={(e) => setTagDialog((s) => ({ ...s, name: e.target.value }))}
            variant="outlined"
            margin="normal"
          />
          <Box sx={{ mt: 2 }}>
            <ColorPicker
              color={tagDialog?.color || TAG_COLORS[0]}
              onChange={(color) => setTagDialog((s) => ({ ...s, color }))}
              presets={TAG_COLORS}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setTagDialog(null)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleSaveTag} disabled={!tagDialog?.name?.trim()}>
            {tagDialog?.mode === "edit" ? "Save" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ───────── Notes Modal ───────── */}
      <TaskBoardModal
        open={Boolean(notesModalItem)}
        onClose={() => setNotesModalItem(null)}
        item={notesModalItem}
        users={users}
      />

      {/* ───────── Files Modal ───────── */}
      <TaskBoardFilesModal
        open={Boolean(filesModalItem)}
        onClose={() => setFilesModalItem(null)}
        item={filesModalItem}
        users={users}
      />

      {/* ───────── Tag Delete Confirm ───────── */}
      <Dialog open={Boolean(deleteTagConfirm)} onClose={() => setDeleteTagConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Delete tag?</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
            {tags.find((t) => t.id === deleteTagConfirm)?.name || "Untitled"}
          </Typography>
          {(() => {
            const n = tagUsageCount(deleteTagConfirm);
            if (n === 0) return (
              <Typography variant="body2" color="text.secondary">No items currently use this tag.</Typography>
            );
            return (
              <Typography variant="body2" color="text.secondary">
                {n} item{n > 1 ? "s" : ""} will have this tag removed. Items whose only tag was this one will go back to no tags.
              </Typography>
            );
          })()}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTagConfirm(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirmDeleteTag}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
