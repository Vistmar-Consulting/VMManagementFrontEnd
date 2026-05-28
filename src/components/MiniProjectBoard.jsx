// V2.2.2e — MiniProjectBoard inside an AgendaTopicCard.
//
// Per docs/AGENDA_DETAIL_PAGE_REFERENCE.md §4.4. A miniature version of the
// main Task Board scoped to one topic — filters items where
// `item.categoryId ∈ topic.categoryIds` OR `item.tagIds ∩ topic.tagIds ≠ ∅`.
// Reuses src/components/TaskBoardRow so inline editing (priority, status,
// assignees, due date, etc.) comes for free.
//
// Groups: Active (statusId 1,2,4,6,8) / Completed (5) / Archive (7).
// Active default expanded; Completed expanded only when non-empty; Archive
// always collapsed by default.

import { useMemo, useState } from "react";
import {
  Box,
  Collapse,
  IconButton,
  Typography,
} from "@mui/material";
import { ExpandMore } from "@mui/icons-material";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import TaskBoardRow from "./TaskBoardRow.jsx";

const ACTIVE_STATUSES = new Set([1, 2, 4, 6, 8]);
const COMPLETED_STATUS = 5;
const ARCHIVE_STATUS = 7;

const GROUP_DEFS = [
  { key: "active", label: "Active", color: "#376fd0" },
  { key: "completed", label: "Completed", color: "#2e7d32" },
  { key: "archive", label: "Archive", color: "#9e9e9e" },
];

function classify(item) {
  if (item.statusId === COMPLETED_STATUS) return "completed";
  if (item.statusId === ARCHIVE_STATUS) return "archive";
  if (ACTIVE_STATUSES.has(item.statusId)) return "active";
  return "active";
}

function GroupHeader({ color, label, count, expanded, onToggle }) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.8,
        py: 0.5,
        px: 1,
        cursor: "pointer",
        background: `${color}0D`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 0.5,
        mb: 0.5,
        userSelect: "none",
      }}
    >
      <ExpandMore
        sx={{
          fontSize: 16,
          color,
          transition: "transform 0.15s",
          transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
        }}
      />
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 10, color, opacity: 0.7, ml: 0.3 }}>
        ({count})
      </Typography>
    </Box>
  );
}

export default function MiniProjectBoard({
  topic,
  agendaId,
  organizationId,
  items,
  users,
  categories,
  tags,
  onOpenComments,
  onOpenFiles,
  getCommentCount,
  getFileCount,
}) {
  const { user } = useAuth();
  const topicCatIds = topic?.categoryIds || [];
  const topicTagIds = topic?.tagIds || [];

  // Filter: scope to the agenda's organization FIRST so GV's biweekly never
  // shows Bryn Mawr's items, even if both orgs use the same category. Then
  // apply the topic's category/tag filter on top. Agendas without an
  // assigned organizationId render no items — they're a separate problem
  // (V2.1.1 left 11 series unassigned; admin UI to assign comes V2.2.2f).
  const matchedItems = useMemo(() => {
    if (!organizationId) return [];
    if (topicCatIds.length === 0 && topicTagIds.length === 0) return [];
    const catSet = new Set(topicCatIds);
    const tagSet = new Set(topicTagIds);
    return (items || []).filter((it) => {
      if (it.organizationId !== organizationId) return false;
      if (it.parentId) return false; // subitems show under their parent (V2.2.2e+ work)
      if (it.categoryId && catSet.has(it.categoryId)) return true;
      if (Array.isArray(it.tagIds) && it.tagIds.some((t) => tagSet.has(t))) return true;
      return false;
    });
  }, [items, organizationId, topicCatIds, topicTagIds]);

  const grouped = useMemo(() => {
    const out = { active: [], completed: [], archive: [] };
    for (const it of matchedItems) {
      out[classify(it)].push(it);
    }
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => (a.order || "").localeCompare(b.order || ""));
    }
    return out;
  }, [matchedItems]);

  const [expanded, setExpanded] = useState({
    active: true,
    completed: grouped.completed.length > 0,
    archive: false,
  });

  const handleUpdate = async (itemId, patch) => {
    await updateDoc(doc(db, "items", itemId), { ...patch, updatedAt: serverTimestamp() });
  };

  // Cascading delete — matches TaskBoard.jsx pattern. The topic row's
  // ⋮ Delete only deletes the topic doc; deleting an ITEM from inside the
  // mini board still needs to handle subitems just like the main board.
  const handleRequestDelete = async (item) => {
    if (!window.confirm(`Delete "${item.title || "Untitled"}"?`)) return;
    const batch = writeBatch(db);
    batch.delete(doc(db, "items", item.id));
    await batch.commit();
  };

  const handleAddItem = async () => {
    if (!organizationId) {
      // eslint-disable-next-line no-alert
      alert("This meeting isn't assigned to an organization yet — set one on the calendar series before adding items.");
      return;
    }
    if (topicCatIds.length === 0) {
      // eslint-disable-next-line no-alert
      alert("Pick a category for this topic first (⋮ menu → Edit). New items need a category so they show up here.");
      return;
    }
    const orgRef = doc(db, "organizations", organizationId);
    const newItemRef = doc(collection(db, "items"));
    const lastActive = grouped.active[grouped.active.length - 1];
    const order = generateKeyBetween(lastActive?.order || null, null);
    await runTransaction(db, async (tx) => {
      const orgSnap = await tx.get(orgRef);
      const next = orgSnap.data()?.nextItemNumber ?? 1;
      tx.set(newItemRef, {
        organizationId,
        parentId: null,
        hasChildren: false,
        type: "task",
        title: "",
        description: "",
        statusId: 1,
        priorityId: null,
        categoryId: topicCatIds[0],
        tagIds: topicTagIds,
        onHold: false,
        dueDate: null,
        completedAt: null,
        assigneeIds: [],
        itemNumber: next,
        createdBy: user?.uid || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        order,
      });
      tx.update(orgRef, { nextItemNumber: next + 1 });
    });
  };

  if (topicCatIds.length === 0 && topicTagIds.length === 0) {
    return (
      <Box
        sx={{
          py: 2,
          my: 1,
          border: "1px dashed #e8e4dd",
          borderRadius: 1,
          textAlign: "center",
          color: "#6b6b8a",
          fontSize: 12,
          fontStyle: "italic",
        }}
      >
        Pick categories or tags from the ⋮ menu to see items here.
      </Box>
    );
  }

  return (
    <Box sx={{ my: 1 }}>
      {GROUP_DEFS.map(({ key, label, color }) => {
        const items = grouped[key];
        // Archive group hidden entirely when empty (matches Console).
        if (key === "archive" && items.length === 0) return null;
        const isExpanded = !!expanded[key];
        return (
          <Box key={key} sx={{ mb: 1 }}>
            <GroupHeader
              color={color}
              label={label}
              count={items.length}
              expanded={isExpanded}
              onToggle={() => setExpanded((s) => ({ ...s, [key]: !s[key] }))}
            />
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ pl: 0.5 }}>
                {items.length === 0 && (
                  <Typography sx={{ fontSize: 11, color: "#6b6b8a", fontStyle: "italic", py: 0.8, pl: 1 }}>
                    No {label.toLowerCase()} items.
                  </Typography>
                )}
                {items.map((item) => (
                  <TaskBoardRow
                    key={item.id}
                    item={item}
                    users={users || []}
                    categories={categories || []}
                    tags={tags || []}
                    onUpdate={handleUpdate}
                    onRequestDelete={handleRequestDelete}
                    onAddSubitem={undefined}  // V2.2.2e first ship: skip subitems
                    onOpenComments={onOpenComments}
                    onOpenFiles={onOpenFiles}
                    getCommentCount={getCommentCount}
                    getFileCount={getFileCount}
                  />
                ))}
                {key === "active" && (
                  <Box
                    onClick={handleAddItem}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 0.5,
                      px: 1.5,
                      py: 0.5,
                      mt: 0.5,
                      borderRadius: 1,
                      border: "1px dashed #cfcfcf",
                      cursor: "pointer",
                      color: "#376fd0",
                      fontSize: 11,
                      fontWeight: 600,
                      transition: "background 0.15s",
                      "&:hover": { background: "#f3f6fb" },
                    }}
                  >
                    + New Item
                  </Box>
                )}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}
