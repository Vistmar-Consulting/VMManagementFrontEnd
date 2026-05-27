// Ported from _PM_Archive_From_Console_2026-05-12/src/pages/pages/TaskBoardRow.jsx
// 14-column row with inline editing across every cell.
//
// Differences from archive:
//   - Field names PascalCase → camelCase per Cross-Stack Naming Parity.
//   - Single assigneeIds array (Console split User_Id / Member_Id; we
//     unify because every Member is a Firestore user with uid = doc id).
//   - Categories + tags scoped per-org (lookups passed in from parent).
//   - Subitems rendered recursively as TaskBoardRow with isSubitem prop
//     (no separate inline sub-table with its own header — defer that).
//   - File cell rendered faded with no handler (Storage on Blaze later).
//   - Data writes via callback props from parent (onUpdate / onDelete /
//     onAddSubitem) — no direct Firestore writes inside the row.

import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInHours, formatDistanceToNow } from "date-fns";
import {
  Box,
  Chip as MuiChip,
  IconButton,
  Menu,
  MenuItem,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArrowDropDown as ArrowDropDownIcon,
  Check,
  ChevronRight as ChevronRightIcon,
  Description as DescriptionIcon,
  ExpandMore as ExpandMoreIcon,
  InsertDriveFileOutlined as FileIcon,
  MoreVert as MoreVertIcon,
} from "@mui/icons-material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

import MemberAvatar from "./MemberAvatar.jsx";
import { PRIORITY_LIST } from "../constants/itemPriorities.js";
import { getPillBg, getTextColor } from "../theme/pillColors.js";

const STATUS_OPTIONS = [
  { id: 1, name: "Assigned",    color: "#7b61ff" },
  { id: 2, name: "In Progress", color: "#2196f3" },
  { id: 6, name: "Pending",     color: "#f5a623" },
  { id: 4, name: "Review",      color: "#9c6ade" },
  { id: 5, name: "Done",        color: "#4caf50" },
  { id: 7, name: "Archive",     color: "#9e9e9e" },
];

const STATUS_BY_ID = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id, s]));
const PRIORITY_BY_ID = Object.fromEntries(PRIORITY_LIST.map((p) => [p.id, p]));

function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

export default function TaskBoardRow({
  item,
  isSubitem = false,
  subitems = [],
  users = [],
  categories = [],
  tags = [],
  canUpdate = true,
  expanded = false,
  onSetExpanded = () => {},
  getCommentCount = () => 0,
  getFileCount = () => 0,
  onUpdate,
  onRequestDelete,
  onAddSubitem,
  onOpenComments,
  onOpenFiles,
}) {
  const [editingTitle, setEditingTitle] = useState(!item.title && canUpdate);
  const [titleValue, setTitleValue] = useState(item.title || "");
  const [priorityAnchor, setPriorityAnchor] = useState(null);
  const [statusAnchor, setStatusAnchor] = useState(null);
  const [categoryAnchor, setCategoryAnchor] = useState(null);
  const [tagsAnchor, setTagsAnchor] = useState(null);
  const [actionAnchor, setActionAnchor] = useState(null);
  const [assigneeAnchor, setAssigneeAnchor] = useState(false);
  const [assigneePosition, setAssigneePosition] = useState(null);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const titleRef = useRef(null);
  const titleSavedRef = useRef(false);

  useEffect(() => {
    if (titleSavedRef.current) {
      titleSavedRef.current = false;
      return;
    }
    if (item.title && !editingTitle) setTitleValue(item.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.title]);

  const status = STATUS_BY_ID[item.statusId];
  const priority = PRIORITY_BY_ID[item.priorityId];
  const category = categories.find((c) => c.id === item.categoryId);
  const assigneeIds = item.assigneeIds || [];
  const assignees = assigneeIds.map((uid) => users.find((u) => u.id === uid)).filter(Boolean);
  const hasSubitems = subitems && subitems.length > 0;

  const dueDate = tsToDate(item.dueDate);
  const createdAt = tsToDate(item.createdAt);
  const updatedAt = tsToDate(item.updatedAt);

  const lastUpdated = useMemo(() => {
    if (!updatedAt) return "";
    const hours = differenceInHours(new Date(), updatedAt);
    if (hours < 24) return "1 day";
    return formatDistanceToNow(updatedAt);
  }, [updatedAt]);

  const idPrefix = isSubitem ? "SI" : "I";
  // Sequential per-org numbers stamped at create time via runTransaction
  // (counters live on organizations/{slug}.nextItemNumber/nextSubitemNumber).
  // Falls back to "?" for any item missing the field — e.g., pre-counter
  // dev items, or if a transaction failed partway.
  const idNumber = item.itemNumber ?? "?";

  const handleField = (patch) => onUpdate?.(item.id, patch);

  const handleTitleBlur = () => {
    setEditingTitle(false);
    if (titleValue !== item.title) {
      titleSavedRef.current = true;
      handleField({ title: titleValue });
    }
  };

  const handleTitleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleRef.current?.blur();
    }
    if (e.key === "Escape") {
      setTitleValue(item.title || "");
      setEditingTitle(false);
    }
  };

  const commentCount = getCommentCount(item.id);
  const fileCount = getFileCount(item.id);

  return (
    <>
      <TableRow sx={{ "&:hover": { backgroundColor: "action.hover" } }}>
        {/* Expand chevron */}
        <TableCell sx={{ width: 40, p: 0.5 }}>
          {!isSubitem && (hasSubitems || expanded) ? (
            <IconButton size="small" onClick={() => onSetExpanded(!expanded)}>
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          ) : !isSubitem && canUpdate ? (
            <Tooltip title="Expand to add subtasks" enterDelay={500} placement="right">
              <IconButton
                size="small"
                onClick={() => onSetExpanded(true)}
                sx={{
                  opacity: 0,
                  transition: "opacity 0.15s",
                  "tr:hover &": { opacity: 0.4 },
                  "&:hover": { opacity: 0.8 },
                }}
              >
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </TableCell>

        {/* Title (inline edit) */}
        <TableCell sx={{ pl: isSubitem ? 5 : 2 }}>
          {editingTitle && canUpdate ? (
            <TextField
              inputRef={titleRef}
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKey}
              variant="standard"
              fullWidth
              autoFocus
              size="small"
            />
          ) : (
            <Typography
              variant="body2"
              sx={{
                cursor: canUpdate ? "pointer" : "default",
                fontWeight: isSubitem ? 400 : 500,
                color: (titleValue || item.title) ? "inherit" : "text.disabled",
                fontStyle: (titleValue || item.title) ? "normal" : "italic",
                "&:hover": canUpdate ? { textDecoration: "underline" } : {},
              }}
              onClick={() => canUpdate && setEditingTitle(true)}
            >
              {titleValue || item.title || "Enter title…"}
            </Typography>
          )}
        </TableCell>

        {/* ID */}
        <TableCell align="center">
          <Typography variant="caption" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {idPrefix}-{idNumber}
          </Typography>
        </TableCell>

        {/* Priority pill + dropdown */}
        <TableCell>
          <MuiChip
            label={priority?.label || "—"}
            size="small"
            sx={{
              backgroundColor: getPillBg(priority?.color),
              color: getTextColor(priority?.color),
              cursor: canUpdate ? "pointer" : "default",
              fontWeight: 600,
              fontSize: "0.75rem",
            }}
            onClick={canUpdate ? (e) => setPriorityAnchor(e.currentTarget) : undefined}
            onDelete={canUpdate ? (e) => { e.stopPropagation(); setPriorityAnchor(e.currentTarget); } : undefined}
            deleteIcon={canUpdate ? <ArrowDropDownIcon sx={{ fontSize: 16, color: `${getTextColor(priority?.color)} !important` }} /> : undefined}
          />
          {canUpdate && (
            <Menu anchorEl={priorityAnchor} open={Boolean(priorityAnchor)} onClose={() => setPriorityAnchor(null)}>
              <MenuItem onClick={() => { setPriorityAnchor(null); handleField({ priorityId: null }); }}>
                <Typography variant="body2">None</Typography>
              </MenuItem>
              {PRIORITY_LIST.map((p) => (
                <MenuItem key={p.id} onClick={() => { setPriorityAnchor(null); handleField({ priorityId: p.id }); }}>
                  <MuiChip
                    label={p.label}
                    size="small"
                    sx={{ backgroundColor: getPillBg(p.color), color: getTextColor(p.color), fontWeight: 600, width: "100%" }}
                  />
                </MenuItem>
              ))}
            </Menu>
          )}
        </TableCell>

        {/* Status pill + dropdown */}
        <TableCell>
          <MuiChip
            label={status?.name || "—"}
            size="small"
            sx={{
              backgroundColor: getPillBg(status?.color),
              color: getTextColor(status?.color),
              cursor: canUpdate ? "pointer" : "default",
              fontWeight: 600,
              fontSize: "0.75rem",
            }}
            onClick={canUpdate ? (e) => setStatusAnchor(e.currentTarget) : undefined}
            onDelete={canUpdate ? (e) => { e.stopPropagation(); setStatusAnchor(e.currentTarget); } : undefined}
            deleteIcon={canUpdate ? <ArrowDropDownIcon sx={{ fontSize: 16, color: `${getTextColor(status?.color)} !important` }} /> : undefined}
          />
          {canUpdate && (
            <Menu anchorEl={statusAnchor} open={Boolean(statusAnchor)} onClose={() => setStatusAnchor(null)}>
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s.id} onClick={() => { setStatusAnchor(null); handleField({ statusId: s.id }); }}>
                  <MuiChip
                    label={s.name}
                    size="small"
                    sx={{ backgroundColor: getPillBg(s.color), color: getTextColor(s.color), fontWeight: 600, width: "100%" }}
                  />
                </MenuItem>
              ))}
            </Menu>
          )}
        </TableCell>

        {/* Assignees (multi) */}
        <TableCell align="center">
          {assignees.length > 0 ? (
            <Box
              sx={{ display: "inline-block", cursor: canUpdate ? "pointer" : "default" }}
              onClick={canUpdate ? (e) => { setAssigneePosition({ top: e.clientY, left: e.clientX }); setAssigneeAnchor(true); } : undefined}
            >
              <MemberAvatar users={assignees} size={28} max={3} />
            </Box>
          ) : (
            <Typography
              variant="body2"
              sx={{ cursor: canUpdate ? "pointer" : "default", color: "text.disabled" }}
              onClick={canUpdate ? (e) => { setAssigneePosition({ top: e.clientY, left: e.clientX }); setAssigneeAnchor(true); } : undefined}
            >
              —
            </Typography>
          )}
          {canUpdate && (
            <Menu
              anchorReference="anchorPosition"
              anchorPosition={assigneePosition}
              open={Boolean(assigneeAnchor)}
              onClose={() => { setAssigneeAnchor(false); setAssigneePosition(null); }}
            >
              {users.filter((u) => u.active !== false).map((u) => {
                const selected = assigneeIds.includes(u.id);
                return (
                  <MenuItem
                    key={u.id}
                    selected={selected}
                    onClick={() => {
                      const next = selected ? assigneeIds.filter((id) => id !== u.id) : [...assigneeIds, u.id];
                      handleField({ assigneeIds: next });
                    }}
                    sx={{ gap: 1.5 }}
                  >
                    <MemberAvatar user={u} size={22} />
                    <Typography variant="body2" sx={{ flex: 1 }}>{u.displayName || u.email}</Typography>
                    {selected && <Check sx={{ fontSize: 16, color: "primary.main" }} />}
                  </MenuItem>
                );
              })}
            </Menu>
          )}
        </TableCell>

        {/* Category (subitems inherit — render empty). Linear-style:
            colored dot + plain text. No chip border/caret so full names
            like "Provider Onboarding" fit; wraps to two lines if cell
            is narrow rather than truncating with ellipsis. */}
        <TableCell>
          {isSubitem ? null : (
            <>
              <Box
                onClick={canUpdate ? (e) => setCategoryAnchor(e.currentTarget) : undefined}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  cursor: canUpdate ? "pointer" : "default",
                  minHeight: 24,
                  "&:hover .cat-name": canUpdate ? { color: "primary.main" } : {},
                }}
              >
                {category ? (
                  <>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: category.color,
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="body2"
                      className="cat-name"
                      sx={{
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        lineHeight: 1.3,
                        whiteSpace: "normal",
                        overflowWrap: "break-word",
                      }}
                    >
                      {category.name}
                    </Typography>
                  </>
                ) : (
                  <Typography
                    variant="body2"
                    className="cat-name"
                    sx={{ color: "text.disabled", fontSize: "0.75rem" }}
                  >
                    —
                  </Typography>
                )}
              </Box>
              {canUpdate && (
                <Menu anchorEl={categoryAnchor} open={Boolean(categoryAnchor)} onClose={() => setCategoryAnchor(null)}>
                  <MenuItem onClick={() => { setCategoryAnchor(null); handleField({ categoryId: null }); }}>
                    <Typography variant="body2">None</Typography>
                  </MenuItem>
                  {categories.map((c) => (
                    <MenuItem
                      key={c.id}
                      selected={c.id === item.categoryId}
                      onClick={() => { setCategoryAnchor(null); handleField({ categoryId: c.id }); }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: c.color, flexShrink: 0 }} />
                        <Typography variant="body2">{c.name}</Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </>
          )}
        </TableCell>

        {/* Tags (multi-select). Linear-style: stack of colored-dot + name
            rows, one per tag. Empty state shows "—". */}
        <TableCell>
          {(() => {
            const tagIds = item.tagIds || [];
            const selectedTags = tagIds
              .map((id) => tags.find((t) => t.id === id))
              .filter(Boolean);
            return (
              <>
                <Box
                  onClick={canUpdate ? (e) => setTagsAnchor(e.currentTarget) : undefined}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.5,
                    cursor: canUpdate ? "pointer" : "default",
                    minHeight: 24,
                    "&:hover .tag-name": canUpdate ? { color: "primary.main" } : {},
                  }}
                >
                  {selectedTags.length === 0 ? (
                    <Typography
                      variant="body2"
                      className="tag-name"
                      sx={{ color: "text.disabled", fontSize: "0.75rem" }}
                    >
                      —
                    </Typography>
                  ) : (
                    selectedTags.map((t) => (
                      <Box
                        key={t.id}
                        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
                      >
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: t.color,
                            flexShrink: 0,
                          }}
                        />
                        <Typography
                          variant="body2"
                          className="tag-name"
                          sx={{
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            lineHeight: 1.3,
                            whiteSpace: "normal",
                            overflowWrap: "break-word",
                          }}
                        >
                          {t.name}
                        </Typography>
                      </Box>
                    ))
                  )}
                </Box>
                {canUpdate && (
                  <Menu anchorEl={tagsAnchor} open={Boolean(tagsAnchor)} onClose={() => setTagsAnchor(null)}>
                    {tags.map((t) => {
                      const selected = tagIds.includes(t.id);
                      return (
                        <MenuItem
                          key={t.id}
                          selected={selected}
                          onClick={() => {
                            const next = selected ? tagIds.filter((id) => id !== t.id) : [...tagIds, t.id];
                            handleField({ tagIds: next });
                          }}
                        >
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: t.color, flexShrink: 0 }} />
                            <Typography variant="body2" sx={{ flex: 1 }}>{t.name}</Typography>
                            {selected && <Check sx={{ fontSize: 16, color: "primary.main" }} />}
                          </Box>
                        </MenuItem>
                      );
                    })}
                    {tagIds.length > 0 && (
                      <MenuItem onClick={() => { setTagsAnchor(null); handleField({ tagIds: [] }); }}>
                        <Typography variant="body2" color="text.secondary">Clear all</Typography>
                      </MenuItem>
                    )}
                  </Menu>
                )}
              </>
            );
          })()}
        </TableCell>

        {/* Due Date — calendar icon hidden; the date text itself opens the picker */}
        <TableCell>
          {canUpdate ? (
            <DatePicker
              open={duePickerOpen}
              onOpen={() => setDuePickerOpen(true)}
              onClose={() => setDuePickerOpen(false)}
              value={dueDate}
              onChange={(date) => handleField({ dueDate: date ?? null })}
              format="MMM dd"
              slotProps={{
                textField: {
                  variant: "standard",
                  size: "small",
                  placeholder: "—",
                  onClick: () => setDuePickerOpen(true),
                  InputProps: { disableUnderline: true, readOnly: true },
                  sx: {
                    width: 80,
                    cursor: "pointer",
                    "& .MuiInput-input": {
                      cursor: "pointer",
                      caretColor: "transparent",
                      "&:hover": { textDecoration: "underline" },
                    },
                  },
                },
                openPickerButton: { sx: { display: "none" } },
              }}
            />
          ) : (
            <Typography variant="body2">
              {dueDate ? dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
            </Typography>
          )}
        </TableCell>

        {/* Updated */}
        <TableCell>
          <Typography variant="caption">{lastUpdated}</Typography>
        </TableCell>

        {/* Created */}
        <TableCell>
          <Typography variant="caption">
            {createdAt ? createdAt.toLocaleDateString() : ""}
          </Typography>
        </TableCell>

        {/* Comments */}
        <TableCell sx={{ overflow: "hidden", textAlign: "center", p: 0.5 }}>
          {commentCount > 0 ? (
            <Tooltip title={`${commentCount} comment${commentCount > 1 ? "s" : ""}`} enterDelay={500} placement="top">
              <IconButton size="small" onClick={() => onOpenComments?.(item)} sx={{ position: "relative" }}>
                <DescriptionIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    fontSize: 8,
                    fontWeight: 700,
                    color: "#fff",
                    backgroundColor: "#b87333",
                    borderRadius: "50%",
                    width: 14,
                    height: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {commentCount}
                </Box>
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Add note" enterDelay={500} placement="top">
              <IconButton size="small" onClick={() => onOpenComments?.(item)}>
                <DescriptionIcon sx={{ fontSize: 18, color: "#e0e0e0", "&:hover": { color: "text.secondary" }, transition: "color 0.15s" }} />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>

        {/* Files — URL links only in V1 (actual uploads land with Blaze). */}
        <TableCell sx={{ overflow: "hidden", textAlign: "center", p: 0.5 }}>
          {fileCount > 0 ? (
            <Tooltip title={`${fileCount} file link${fileCount > 1 ? "s" : ""}`} enterDelay={500} placement="top">
              <IconButton size="small" onClick={() => onOpenFiles?.(item)} sx={{ position: "relative" }}>
                <FileIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    fontSize: 8,
                    fontWeight: 700,
                    color: "#fff",
                    backgroundColor: "#b87333",
                    borderRadius: "50%",
                    width: 14,
                    height: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {fileCount}
                </Box>
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Add file link" enterDelay={500} placement="top">
              <IconButton size="small" onClick={() => onOpenFiles?.(item)}>
                <FileIcon sx={{ fontSize: 18, color: "#e0e0e0", "&:hover": { color: "text.secondary" }, transition: "color 0.15s" }} />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>

        {/* Action menu */}
        <TableCell sx={{ p: 0.5, textAlign: "center" }}>
          {canUpdate && (
            <>
              <IconButton size="small" onClick={(e) => setActionAnchor(e.currentTarget)}>
                <MoreVertIcon fontSize="small" />
              </IconButton>
              <Menu
                anchorEl={actionAnchor}
                open={Boolean(actionAnchor)}
                onClose={() => setActionAnchor(null)}
                anchorOrigin={{ vertical: "top", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
              >
                {!isSubitem && (
                  <MenuItem onClick={() => { setActionAnchor(null); onSetExpanded(true); onAddSubitem?.(item); }}>
                    Add subtask
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => { setActionAnchor(null); onRequestDelete?.(item, isSubitem); }}
                  sx={{ color: "error.main" }}
                >
                  Delete
                </MenuItem>
              </Menu>
            </>
          )}
        </TableCell>
      </TableRow>

      {/* Subitems (recursive) */}
      {!isSubitem && expanded && subitems.map((sub) => (
        <TaskBoardRow
          key={sub.id}
          item={sub}
          isSubitem
          subitems={[]}
          users={users}
          categories={categories}
          tags={tags}
          canUpdate={canUpdate}
          getCommentCount={getCommentCount}
          onUpdate={onUpdate}
          onRequestDelete={onRequestDelete}
          onOpenComments={onOpenComments}
        />
      ))}

      {/* + Add subitem row */}
      {!isSubitem && expanded && canUpdate && (
        <TableRow>
          <TableCell colSpan={14} sx={{ borderBottom: "none", py: 0.5, pl: 7 }}>
            <Typography
              variant="caption"
              onClick={() => onAddSubitem?.(item)}
              sx={{
                color: "text.disabled",
                cursor: "pointer",
                fontSize: "0.8rem",
                "&:hover": { color: "primary.main" },
              }}
            >
              + Add subtask
            </Typography>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
