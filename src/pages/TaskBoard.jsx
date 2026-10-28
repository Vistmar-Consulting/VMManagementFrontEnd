// Ported from _PM_Archive_From_Console_2026-05-12/src/pages/pages/TaskBoard.jsx
// Monday.com-style table with three collapsible groups (Active / Completed /
// Archive), 14-column TaskBoardRow, sortable + filterable headers, status
// scorecards row, organization filter chip group.
//
// Differences from archive: Firestore data layer (useCollection +
// onSnapshot, item writes via src/lib/itemWrites.js except discarding a blank
// new item and the category/tag clean-up), camelCase fields,
// per-org categories/tags scoped via subcollections. DnD reorder + comments
// modal are follow-up slices.

import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocalStorage, useSessionStorage } from "@uidotdev/usehooks";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  createSubitem,
  createTopLevelItem,
  deleteItemCascade,
  newItemRef,
  nextSubitemOrder,
  nextTopLevelOrder,
  updateItem,
} from "../lib/itemWrites.js";
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
  Divider,
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
import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SearchIcon from "@mui/icons-material/Search";
import SyncIcon from "@mui/icons-material/Sync";

import BoardChatPanel, { PANEL_WIDTH } from "../components/BoardChatPanel.jsx";
import ColorPicker from "../components/ColorPicker.jsx";
import { getContrastText } from "../theme/pillColors.js";
import SyncBoardDialog from "../components/SyncBoardDialog.jsx";
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
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import { buildBoardGroups, groupKeyOf } from "../lib/boardGroups.js";
import { buildItemMatcher } from "../lib/boardFilters.js";
import { planBoardFilter } from "../lib/boardChat/boardFilter.js";
import { EMPTY_ACTIVE, activeView, addView, aiFilterOfView, isEdited, removeView, resetViews, toggleView } from "../lib/boardChat/boardViews.js";
import { canBoardSync } from "../lib/boardSyncCore.js";
import { applySort, removeSort, sortItems } from "../lib/boardSort.js";
import { SCORECARDS, countScorecards } from "../lib/scorecards.js";

const NO_VIEWS = [];
const LAST_ORG_KEY = "vm-board-org-filter";
const readLastOrg = () => {
  const raw = localStorage.getItem(LAST_ORG_KEY);
  return raw ? JSON.parse(raw) : "all";
};

export default function TaskBoard() {
  const { user } = useAuth();
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

  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [syncBoardOpen, setSyncBoardOpen] = useState(false);
  const [orgPickerCreating, setOrgPickerCreating] = useState(false);

  // Board Chat filter views (see lib/boardChat/boardViews.js). An active view
  // re-applies its filters on load. The saved views are shared by every tab;
  // which one is on (and the filters to restore) is per tab, since each tab
  // keeps its own filters. Views saved before the split ({ views, ... }) are
  // read as a plain list.
  const [storedViews, setStoredViews] = useLocalStorage("vm-board-chat-views", NO_VIEWS);
  const [storedActive, setStoredActive] = useSessionStorage("vm-board-chat-active", EMPTY_ACTIVE);
  const views = Array.isArray(storedViews) ? storedViews
    : Array.isArray(storedViews?.views) ? storedViews.views
    : NO_VIEWS;
  const activeId = views.some((v) => v.id === storedActive?.activeId) ? storedActive.activeId : null;
  const viewStore = { views, activeId, before: activeId ? storedActive.before : null };
  const setViewStore = (store) => {
    if (store.views !== views) setStoredViews(store.views);
    setStoredActive({ activeId: store.activeId, before: store.before });
  };
  const [initialView] = useState(() => activeView(viewStore));

  // Org filter chip group. Each tab keeps its own; a new tab starts on the
  // last org picked in any tab, or on the active view's org.
  const [orgFilter, setOrgFilterState] = useState(() => initialView?.filters.orgFilter ?? readLastOrg());
  const setOrgFilter = (org) => {
    setOrgFilterState(org);
    localStorage.setItem(LAST_ORG_KEY, JSON.stringify(org));
  };

  // Column sort + filter state.
  const [sorts, setSorts] = useState([]);
  const [columnFilters, setColumnFilters] = useState(() => initialView?.filters.columnFilters ?? {});
  const [titleSearch, setTitleSearch] = useState(() => initialView?.filters.titleSearch ?? "");

  // Scorecard single-select filter.
  const [scorecardFilter, setScorecardFilter] = useState(() => initialView?.filters.scorecardFilter ?? null);

  // The active view's AI item list: { label, ids: Set }. useLocalStorage
  // returns a fresh object every render, so this is keyed on the view's JSON
  // to keep a stable identity for the memos below.
  const activeViewJson = JSON.stringify(activeView(viewStore));
  const aiFilter = useMemo(() => aiFilterOfView(JSON.parse(activeViewJson)), [activeViewJson]);
  const [chatOpen, setChatOpen] = useState(false);

  // Group expanded state.
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  // Filter predicates — extracted so we can apply them to BOTH parents and
  // subitems (used by the parent-or-subitem-match logic below).
  // Note: organizationId is parent-level — subitems inherit their parent's
  // org at create-time, so the org filter is checked against the parent only.
  // Search + column filters only. The scorecard counts use this directly so
  // they respond to the column filters without zeroing each other out when a
  // card is selected.
  const matchesSearchAndColumns = useMemo(
    () => buildItemMatcher({ titleSearch, columnFilters, idSet: aiFilter?.ids }),
    [titleSearch, columnFilters, aiFilter],
  );

  const selectedCard = scorecardFilter ? SCORECARDS.find((c) => c.key === scorecardFilter) : null;

  // Items created while the current filters are on. A new item starts untitled
  // and Not Started, so it would match almost no filter and never render; keep
  // it in view until the filters change (same rule as the Mini Project Board).
  const [keptIds, setKeptIds] = useState(() => new Set());
  const keepInView = (id) => setKeptIds((s) => (s.has(id) ? s : new Set(s).add(id)));

  const matchesNonOrgFilters = useMemo(
    () => (item) => keptIds.has(item.id)
      || ((!selectedCard || selectedCard.match(item)) && matchesSearchAndColumns(item)),
    [keptIds, selectedCard, matchesSearchAndColumns],
  );

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
      || Object.values(columnFilters).some((v) => v && v.length > 0)
      || Boolean(aiFilter);
  }, [titleSearch, scorecardFilter, columnFilters, aiFilter]);

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
    const categoryNameById = new Map(categories.map((c) => [c.id, (c.name || "").toLowerCase()]));
    return sortItems(topLevel, sorts, { categoryNameById });
  }, [topLevel, sorts, categories]);

  const boardGroups = buildBoardGroups(sorted, visibleSubitemsByParent, matchesNonOrgFilters);

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

  const sortedOrgs = useMemo(
    () => [...(orgs || [])].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
    [orgs],
  );

  // Per-row expansion state lifted from TaskBoardRow so the "expand all /
  // collapse all" header button can toggle everything at once. Rows are keyed
  // by rowKey, so a ghost copy expands independently of its real row. Ghost
  // rows and filter-matched parents open by default; an explicit collapse
  // overrides that default and is cleared whenever the filters change.
  const [expansion, setExpansion] = useState(() => ({
    filters: [scorecardFilter, titleSearch, columnFilters, aiFilter],
    open: new Set(),
    closed: new Set(),
  }));
  const filtersChanged = expansion.filters[0] !== scorecardFilter
    || expansion.filters[1] !== titleSearch
    || expansion.filters[2] !== columnFilters
    || expansion.filters[3] !== aiFilter;
  if (filtersChanged) {
    setExpansion((prev) => ({
      ...prev,
      filters: [scorecardFilter, titleSearch, columnFilters, aiFilter],
      closed: new Set(),
    }));
    setKeptIds(new Set());
  }
  const closedRowKeys = filtersChanged ? new Set() : expansion.closed;

  const rowKey = (groupKey, id, ghost) => (ghost ? `ghost:${groupKey}:${id}` : id);

  const isRowExpanded = (key, defaultOpen) =>
    !closedRowKeys.has(key) && (defaultOpen || expansion.open.has(key));

  const setRowsExpanded = (keys, val) => {
    setExpansion((prev) => {
      const open = new Set(prev.open);
      const closed = new Set(prev.closed);
      for (const key of keys) {
        if (val) {
          open.add(key);
          closed.delete(key);
        } else {
          open.delete(key);
          closed.add(key);
        }
      }
      return { ...prev, open, closed };
    });
  };

  // The rows the header toggle acts on: rows with visible subitems, in the
  // group sections that are open.
  const groupOpen = { active: activeExpanded, completed: completedExpanded, archive: archiveExpanded };
  const toggleableRows = [];
  for (const [groupKey, rows] of Object.entries(boardGroups)) {
    if (!groupOpen[groupKey]) continue;
    for (const { item, subitems, ghost } of rows) {
      if (subitems.length === 0) continue;
      toggleableRows.push({
        key: rowKey(groupKey, item.id, ghost),
        defaultOpen: ghost || filterForceExpandedIds.has(item.id),
      });
    }
  }

  const allExpanded = toggleableRows.length > 0
    && toggleableRows.every((r) => isRowExpanded(r.key, r.defaultOpen));

  const toggleAllExpanded = () => setRowsExpanded(toggleableRows.map((r) => r.key), !allExpanded);

  const handleSort = (field, direction) => setSorts((prev) => applySort(prev, field, direction));
  const handleRemoveSort = (field) => setSorts((prev) => removeSort(prev, field));

  const handleFilterChange = (field, values) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!values || values.length === 0) delete next[field];
      else next[field] = values;
      return next;
    });
  };

  const ownFilters = { orgFilter, titleSearch, columnFilters, scorecardFilter };
  const applyFilters = (f) => {
    setOrgFilter(f.orgFilter);
    setTitleSearch(f.titleSearch);
    setColumnFilters(f.columnFilters);
    setScorecardFilter(f.scorecardFilter);
  };
  const runViewChange = ({ store, apply }) => {
    setViewStore(store);
    if (apply) applyFilters(apply);
  };

  // Board Chat's set_board_filter. Throws on any unknown id, so a bad call
  // errors back to the model and the board is unchanged. Several calls in one
  // model reply run back to back with no render between them, so each one
  // commits synchronously and the next sees its result (the panel reads this
  // handler fresh from its latest props).
  const handleBoardChatFilter = (input) => {
    const current = { ...ownFilters, aiFilter: activeView(viewStore)?.filters.aiFilter ?? null };
    const plan = planBoardFilter(input, { orgs, items: allItems, users, categories, tags }, current);
    if (plan.kind === "clear") {
      flushSync(() => {
        setViewStore(resetViews(viewStore));
        applyFilters(plan.filters);
      });
      return { applied: true, view: null };
    }
    flushSync(() => runViewChange(addView(viewStore, { id: crypto.randomUUID(), label: plan.label, filters: plan.filters }, ownFilters)));
    return { applied: true, view: plan.label, itemCount: plan.filters.aiFilter?.itemIds.length ?? null };
  };

  // Reset: every view off (none deleted), search / column / scorecard
  // filters cleared. The org pill is left alone.
  const canReset = hasAnyFilter || Boolean(viewStore.activeId);
  const handleReset = () => {
    setViewStore(resetViews(viewStore));
    setTitleSearch("");
    setColumnFilters({});
    setScorecardFilter(null);
  };

  // Firestore writes
  const handleUpdate = (itemId, patch) => updateItem(itemId, patch);

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
    const subIds = isSubitem ? [] : (subitemsByParent[item.id] || []).map((s) => s.id);
    await deleteItemCascade(item.id, subIds);
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

  // The item the user just created, so only its row opens into title edit.
  const [newItemId, setNewItemId] = useState(null);

  const handleNewSettled = () => setNewItemId(null);

  // Set while a subitem is being created, so a double click adds one, not two.
  const addingSubitemRef = useRef(false);

  // A just-created subitem left untitled is dropped: the user backed out.
  const handleDiscardNew = (item) => {
    setNewItemId(null);
    return deleteDoc(doc(db, "items", item.id));
  };

  const handleAddItem = async (orgId) => {
    // New items start Active; open that group so the row can take its title.
    setActiveExpanded(true);
    const ref = newItemRef();
    setNewItemId(ref.id);
    keepInView(ref.id);
    await createTopLevelItem({ ref, orgId, uid: user.uid, order: nextTopLevelOrder(allItems) });
  };

  const handleOrgPickerSelect = async (orgId) => {
    setOrgPickerCreating(true);
    try {
      await handleAddItem(orgId);
      setOrgFilter(orgId);
      setOrgPickerOpen(false);
    } catch (err) {
      setOrgPickerOpen(false);
      throw err;
    } finally {
      setOrgPickerCreating(false);
    }
  };

  const handleAddSubitem = async (parentItem) => {
    if (addingSubitemRef.current) return;
    addingSubitemRef.current = true;
    try {
      // New subitems start Active, so open the Active group and the parent's row
      // in it (its ghost copy there when the parent itself is Done / Archived).
      setActiveExpanded(true);
      setRowsExpanded([rowKey("active", parentItem.id, groupKeyOf(parentItem.statusId) !== "active")], true);
      const ref = newItemRef();
      setNewItemId(ref.id);
      keepInView(ref.id);
      await createSubitem({ ref, parent: parentItem, uid: user.uid, order: nextSubitemOrder(allItems, parentItem.id) });
    } finally {
      addingSubitemRef.current = false;
    }
  };

  // Categories + tags are global; pass the full list to every row.

  // Scorecard counts, narrowed by the org filter, title search and column
  // filters — but not by the selected scorecard itself.
  const scorecardCounts = useMemo(() => {
    const parents = allItems.filter(
      (item) => item.parentId == null && (orgFilter === "all" || item.organizationId === orgFilter),
    );
    return countScorecards(parents, subitemsByParent, matchesSearchAndColumns);
  }, [allItems, orgFilter, subitemsByParent, matchesSearchAndColumns]);

  // Filter chip values for column popovers
  const priorityFilterValues = PRIORITY_LIST.map((p) => ({ value: p.id, label: p.label, color: p.color }));
  const statusFilterValues = STATUS_OPTIONS.map((s) => ({ value: s.id, label: s.name, color: s.color }));
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
  const renderGroup = (title, groupKey, groupItems, expanded, setExpanded, color) => (
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
            {groupItems.reduce((n, row) => n + (row.ghost ? row.subitems.length : 1), 0)}
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
                  groupItems.map(({ item, subitems, ghost }) => (
                    <TaskBoardRow
                      key={ghost ? `ghost:${item.id}` : item.id}
                      item={item}
                      subitems={subitems}
                      ghost={ghost}
                      dimmed={Boolean(selectedCard) && !selectedCard.match(item)}
                      users={users}
                      categories={categories}
                      tags={tags}
                      expanded={isRowExpanded(rowKey(groupKey, item.id, ghost), ghost || filterForceExpandedIds.has(item.id))}
                      onSetExpanded={(val) => setRowsExpanded([rowKey(groupKey, item.id, ghost)], val)}
                      getCommentCount={getCommentCount}
                      getFileCount={getFileCount}
                      onUpdate={handleUpdate}
                      onRequestDelete={handleRequestDelete}
                      onAddSubitem={handleAddSubitem}
                      newItemId={newItemId}
                      onDiscardNew={handleDiscardNew}
                      onNewSettled={handleNewSettled}
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
          {toggleableRows.length > 0 && (
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
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort} sortOnly
        />
        <TaskBoardColumnHeader
          label="ID" field="id" align="center" width="5%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort} sortOnly
        />
        <TaskBoardColumnHeader
          label="Priority" field="priorityId" width="10%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort}
          filterValues={priorityFilterValues}
          selectedFilters={columnFilters.priorityId}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Status" field="statusId" width="10%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort}
          filterValues={statusFilterValues}
          selectedFilters={columnFilters.statusId}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Assigned" field="assigneeIds" align="center" width="10%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort}
          filterValues={assigneeFilterValues}
          selectedFilters={columnFilters.assigneeIds}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Category" field="categoryId" width="12%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort}
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
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort}
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
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort} sortOnly
        />
        <TaskBoardColumnHeader
          label="Updated" field="updatedAt" width="8%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort} sortOnly
        />
        <TaskBoardColumnHeader
          label="Created" field="createdAt" width="7%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort} sortOnly
        />
        <TaskBoardColumnHeader
          label="Notes" field="notes" width="4%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort} sortOnly
        />
        <TaskBoardColumnHeader
          label="Files" field="files" width="4%"
          sorts={sorts} onSort={handleSort} onRemoveSort={handleRemoveSort} sortOnly
        />
        <TableCell sx={{ width: "5%" }} />
      </TableRow>
    </TableHead>
  );

  if (itemsError) {
    return <Alert severity="error">Failed to load items: {itemsError.message}</Alert>;
  }

  return (
    <>
    <Stack spacing={4} sx={{ pr: chatOpen ? { md: `${PANEL_WIDTH}px` } : 0, transition: "padding 0.2s" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h4" component="h1">Project Board</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant={chatOpen ? "contained" : "outlined"} startIcon={<AutoAwesomeIcon />} onClick={() => setChatOpen((v) => !v)}>
            Board Chat
          </Button>
          {canBoardSync(user?.email) && (
            <Button variant="outlined" startIcon={<SyncIcon />} onClick={() => setSyncBoardOpen(true)}>
              Sync Board
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOrgPickerOpen(true)}
          >
            New item
          </Button>
        </Stack>
      </Stack>

      {/* Scorecards */}
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }} useFlexGap>
        {SCORECARDS.map((card, idx) => {
          const selected = scorecardFilter === card.key;
          const startsDateGroup = card.dateCard && !SCORECARDS[idx - 1]?.dateCard;
          return [
            startsDateGroup && (
              <Divider key="date-divider" orientation="vertical" flexItem sx={{ mx: 1 }} />
            ),
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
            </Box>,
          ];
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
                color: org.accentColor ? getContrastText(org.accentColor) : "#fff",
              }),
            }}
          />
        ))}
      </Stack>

      {/* Search bar — matches title + description across items AND subtasks.
          Cascades the same way other filters do: if a subtask's text matches
          but the parent's doesn't, the parent surfaces and auto-expands. */}
      <Stack direction="row" spacing={1} alignItems="center">
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
        <Button
          size="small"
          variant="outlined"
          startIcon={<RestartAltIcon />}
          onClick={handleReset}
          disabled={!canReset}
        >
          Reset
        </Button>
      </Stack>

      {viewStore.views.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {viewStore.views.map((view) => {
            const ids = view.filters.aiFilter && new Set(view.filters.aiFilter.itemIds);
            const count = ids ? ` (${allItems.filter((i) => ids.has(i.id)).length})` : "";
            const active = view.id === viewStore.activeId;
            const edited = active && isEdited(view, ownFilters) ? " · edited" : "";
            return (
              <Chip
                key={view.id}
                color="secondary"
                variant={active ? "filled" : "outlined"}
                label={`AI: ${view.label}${count}${edited}`}
                aria-pressed={active}
                onClick={() => runViewChange(toggleView(viewStore, view.id, ownFilters))}
                onDelete={() => runViewChange(removeView(viewStore, view.id))}
              />
            );
          })}
        </Stack>
      )}

      {itemsLoading && (
        <Typography variant="body2" color="text.secondary">Loading…</Typography>
      )}

      {!itemsLoading && (
        <>
          {renderGroup("Active", "active", boardGroups.active, activeExpanded, setActiveExpanded, "#4a90d9")}
          {renderGroup("Completed", "completed", boardGroups.completed, completedExpanded, setCompletedExpanded, "#4caf50")}
          {renderGroup("Archive", "archive", boardGroups.archive, archiveExpanded, setArchiveExpanded, "#9e9e9e")}
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

      {/* Org picker — opens when "New item" is clicked */}
      <Dialog
        open={orgPickerOpen}
        onClose={() => { if (!orgPickerCreating) setOrgPickerOpen(false); }}
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
                    disabled={orgPickerCreating}
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

      {syncBoardOpen && (
        <SyncBoardDialog
          items={allItems}
          users={users}
          categories={categories}
          tags={tags}
          onClose={() => setSyncBoardOpen(false)}
        />
      )}
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
        onApplyFilter={handleBoardChatFilter}
      />
    </>
  );
}
