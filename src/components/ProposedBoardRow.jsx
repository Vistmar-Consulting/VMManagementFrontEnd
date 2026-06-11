import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!editingTitle) setTitleValue(create.title || "");
  }, [create.title, editingTitle]);
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
          <Menu anchorEl={statusAnchor} open={Boolean(statusAnchor)} onClose={() => setStatusAnchor(null)}>
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
                  sx={{ bgcolor: getPillBg(s.color), color: getTextColor(s.color), fontWeight: 600, width: "100%" }}
                />
              </MenuItem>
            ))}
          </Menu>
        )}

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
            sx={{ color: "text.disabled", cursor: isChecked ? "pointer" : "default", flexShrink: 0 }}
            onClick={isChecked ? (e) => setAssigneeAnchor(e.currentTarget) : undefined}
          >
            —
          </Typography>
        )}
        {isChecked && (
          <Menu anchorEl={assigneeAnchor} open={Boolean(assigneeAnchor)} onClose={() => setAssigneeAnchor(null)}>
            {users.filter((u) => u.active !== false).map((u) => {
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
                  <Typography variant="body2" sx={{ flex: 1 }}>{u.displayName || u.email}</Typography>
                  {sel && <Check sx={{ fontSize: 16, color: "primary.main" }} />}
                </MenuItem>
              );
            })}
          </Menu>
        )}
      </Box>

      {/* Row 2: category pill · tags */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, pl: 3, flexWrap: "wrap" }}>
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
          <Menu anchorEl={categoryAnchor} open={Boolean(categoryAnchor)} onClose={() => setCategoryAnchor(null)}>
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
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: c.color, flexShrink: 0 }} />
                  <Typography variant="body2">{c.name}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Menu>
        )}

        {showSep && <Typography sx={{ color: "divider", fontSize: "0.75rem" }}>·</Typography>}

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
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: t.color, flexShrink: 0 }} />
            <Typography variant="body2" className="tag-name" sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
              {t.name}
            </Typography>
          </Box>
        ))}
        {selectedTags.length === 0 && (
          <Typography
            variant="body2"
            sx={{ color: "text.disabled", fontSize: "0.75rem", cursor: isChecked ? "pointer" : "default" }}
            onClick={isChecked ? (e) => setTagsAnchor(e.currentTarget) : undefined}
          >
            + tags
          </Typography>
        )}
        {isChecked && (
          <Menu anchorEl={tagsAnchor} open={Boolean(tagsAnchor)} onClose={() => setTagsAnchor(null)}>
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
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: t.color, flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ flex: 1 }}>{t.name}</Typography>
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
                <Typography variant="body2" color="text.secondary">Clear all</Typography>
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
