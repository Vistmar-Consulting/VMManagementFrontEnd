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
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
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
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
} from "@mui/icons-material";

import TaskBoardColumnHeader from "../components/TaskBoardColumnHeader.jsx";
import TaskBoardRow from "../components/TaskBoardRow.jsx";
import { PRIORITY_LIST } from "../constants/itemPriorities.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { db } from "../firebase.js";
import { useCollection } from "../hooks/useCollection.js";
import { useItems } from "../hooks/useItems.js";

const STATUSES = [
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

function isDueThisWeek(date) {
  if (!date) return false;
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const t = date.getTime();
  return t >= now && t <= now + sevenDays;
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

  // Top-level items only, with org filter + scorecard filter applied.
  const topLevel = useMemo(() => {
    let result = allItems.filter((item) => item.parentId == null);
    if (orgFilter !== "all") result = result.filter((item) => item.organizationId === orgFilter);
    if (titleSearch) {
      const q = titleSearch.toLowerCase();
      result = result.filter((item) => (item.title || "").toLowerCase().includes(q));
    }
    if (scorecardFilter) {
      const card = SCORECARDS.find((c) => c.key === scorecardFilter);
      if (card) result = result.filter(card.match);
    }
    // Column filters
    Object.entries(columnFilters).forEach(([field, values]) => {
      if (!values || values.length === 0) return;
      if (field === "assigneeIds") {
        result = result.filter((item) => (item.assigneeIds || []).some((id) => values.includes(id)));
      } else if (field === "tagIds") {
        result = result.filter((item) => (item.tagIds || []).some((id) => values.includes(id)));
      } else {
        result = result.filter((item) => values.includes(item[field]));
      }
    });
    return result;
  }, [allItems, orgFilter, titleSearch, scorecardFilter, columnFilters]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortField) return topLevel;
    const getVal = (item) => {
      switch (sortField) {
        case "title": return (item.title || "").toLowerCase();
        case "statusId":
        case "priorityId": return item[sortField] ?? 999;
        case "dueDate": return item.dueDate ? tsToDate(item.dueDate).getTime() : Infinity;
        case "updatedAt": return item.updatedAt ? tsToDate(item.updatedAt).getTime() : 0;
        case "createdAt": return item.createdAt ? tsToDate(item.createdAt).getTime() : 0;
        case "categoryId": return item.categoryId || "zzz";
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
  }, [topLevel, sortField, sortDirection]);

  const activeItems = sorted.filter((i) => i.statusId !== DONE && i.statusId !== ARCHIVE);
  const completedItems = sorted.filter((i) => i.statusId === DONE);
  const archiveItems = sorted.filter((i) => i.statusId === ARCHIVE);

  // Subitems map: parentId → subitems array.
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
    // Cascade: delete subtasks before the parent so they don't orphan.
    if (!isSubitem) {
      const subs = subitemsByParent[item.id] || [];
      await Promise.all(subs.map((s) => deleteDoc(doc(db, "items", s.id))));
    }
    await deleteDoc(doc(db, "items", item.id));
    setDeleteConfirm(null);
  };

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
    if (orgFilter === "all") return;
    await addDoc(collection(db, "items"), {
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
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      order: nextTopLevelOrder(),
    });
  };

  const handleAddSubitem = async (parentItem) => {
    await addDoc(collection(db, "items"), {
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
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      order: nextSubitemOrder(parentItem.id),
    });
    // Maintain hasChildren denormalization client-side (Cloud Function later).
    if (!parentItem.hasChildren) {
      await updateDoc(doc(db, "items", parentItem.id), {
        hasChildren: true,
        updatedAt: serverTimestamp(),
      });
    }
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
  // Filter values reduced to those actually USED by currently-visible items
  // (the org-scoped top-level set). Categories/tags not in any visible row
  // are hidden from the column-header filter popover.
  const usedCategoryIds = useMemo(() => {
    const ids = new Set();
    for (const item of orgScopedTopLevel) {
      if (item.categoryId) ids.add(item.categoryId);
    }
    return ids;
  }, [orgScopedTopLevel]);
  const usedTagIds = useMemo(() => {
    const ids = new Set();
    for (const item of orgScopedTopLevel) {
      (item.tagIds || []).forEach((id) => ids.add(id));
    }
    return ids;
  }, [orgScopedTopLevel]);

  const categoryFilterValues = categories
    .filter((c) => usedCategoryIds.has(c.id))
    .map((c) => ({ value: c.id, label: c.name, color: c.color }));
  const tagFilterValues = tags
    .filter((t) => usedTagIds.has(t.id))
    .map((t) => ({ value: t.id, label: t.name, color: t.color }));

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
                      subitems={subitemsByParent[item.id] || []}
                      users={users}
                      categories={categories}
                      tags={tags}
                      canUpdate={isAdmin}
                      getCommentCount={() => 0}
                      onUpdate={handleUpdate}
                      onRequestDelete={handleRequestDelete}
                      onAddSubitem={handleAddSubitem}
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
        <TableCell sx={{ width: "2%", whiteSpace: "nowrap" }} />
        <TaskBoardColumnHeader
          label="Item" field="title" width="18%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly showSearch onSearchChange={setTitleSearch}
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
          label="Category" field="categoryId" width="10%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted}
          filterValues={categoryFilterValues}
          selectedFilters={columnFilters.categoryId}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Tags" field="tagIds" width="8%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted}
          filterValues={tagFilterValues}
          selectedFilters={columnFilters.tagIds}
          onFilterChange={handleFilterChange}
        />
        <TaskBoardColumnHeader
          label="Due" field="dueDate" width="7%"
          sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
          userSorted={userHasSorted} sortOnly
        />
        <TaskBoardColumnHeader
          label="Updated" field="updatedAt" width="10%"
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

      {/* Organization filter chips */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }} useFlexGap>
        <Chip
          label="All"
          onClick={() => setOrgFilter("all")}
          variant={orgFilter === "all" ? "filled" : "outlined"}
          color={orgFilter === "all" ? "primary" : "default"}
          size="small"
        />
        {orgs.map((org) => (
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
    </Stack>
  );
}
