// Board Chat's confirm step: every proposed create / update / delete of a
// task, tag or category, one row each with a checkbox. Invalid ops can't be
// ticked; ops on items changed since Claude last read them start unticked.
// Nothing writes until Apply. There is no Escape / backdrop close: leaving
// without applying is Cancel. BoardChangeList is the row list alone, also
// used by Agenda Chat's review for the Task Board half of its proposal.
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
  name: "Name", color: "Color", organizationId: "Used by",
};

function formatValue(field, value, L) {
  if (field === "organizationId") return value ? `${L.orgName(value)} only` : "Shared";
  if (value == null || (Array.isArray(value) && value.length === 0)) return "—";
  if (field === "statusId") return statusName(value);
  if (field === "priorityId") return priorityName(value);
  if (field === "assigneeIds") return value.map(L.userName).join(", ");
  if (field === "categoryId") return L.categoryName(value);
  if (field === "tagIds") return value.map(L.tagName).join(", ");
  if (field === "dueDate") return ymd(value);
  return String(value);
}

// A create's org and every field it sets, so nothing is applied unseen.
const CREATE_FIELDS = ["statusId", "priorityId", "assigneeIds", "categoryId", "tagIds", "dueDate"];
function createSummary(r, L) {
  const set = CREATE_FIELDS.filter((f) => formatValue(f, r.fields[f], L) !== "—");
  const parts = [L.orgName(r.orgId), ...set.map((f) => `${FIELD_LABEL[f]} ${formatValue(f, r.fields[f], L)}`)];
  const desc = r.fields.description?.trim();
  if (desc) parts.push(`Description "${desc.length > 60 ? `${desc.slice(0, 60)}…` : desc}"`);
  return parts.join(" · ");
}

const GROUPS = [
  { ops: ["create_tag", "create_category"], label: "New tags & categories" },
  { ops: ["update_tag", "update_category"], label: "Change tags & categories" },
  { ops: ["create"], label: "Create" },
  { ops: ["update"], label: "Update" },
  { ops: ["delete"], label: "Delete", danger: true },
  { ops: ["delete_tag", "delete_category"], label: "Delete tags & categories", danger: true },
];

const KIND = { create_tag: "Tag", update_tag: "Tag", delete_tag: "Tag", create_category: "Category", update_category: "Category", delete_category: "Category" };

// Lookups that also name the tags and categories this proposal creates.
export function withNewNames(L, rows) {
  const names = Object.fromEntries(rows.filter((r) => r.ok && r.tempId && KIND[r.op]).map((r) => [r.tempId, `${r.fields.name} (new)`]));
  return {
    ...L,
    tagName: (id) => names[id] || L.tagName(id),
    categoryName: (id) => names[id] || L.categoryName(id),
  };
}

function Swatch({ color }) {
  if (!color) return null;
  return <Box component="span" sx={{ display: "inline-block", width: 10, height: 10, borderRadius: "2px", bgcolor: color, mr: 0.75, verticalAlign: "middle" }} />;
}

// checked: Set of row indexes; onToggle(index).
export function BoardChangeList({ rows, checked, onToggle, lookups, itemLabel, disabled = false }) {
  const L = withNewNames(lookups, rows);
  // A rejected create has no fields or itemId, so it is named by its position.
  const rowTitle = (r) => {
    if (!r.ok && !r.itemId && !r.targetId) return `Op ${r.index + 1}`;
    if (KIND[r.op]) return `${KIND[r.op]}: ${String(r.op).startsWith("create_") ? r.fields.name : r.name}`;
    if (r.op === "create") return `${r.parentId || r.parentTempId ? "Subtask" : "Task"}: ${r.fields.title}`;
    return r.itemId ? itemLabel(r.itemId) : `Op ${r.index + 1}`;
  };

  return GROUPS.map((g) => {
    const groupRows = rows.filter((r) => g.ops.includes(r.op));
    if (groupRows.length === 0) return null;
    return (
      <Box key={g.label} sx={{ mb: 2 }}>
        <Typography variant="overline" color={g.danger ? "error" : "text.secondary"}>{g.label}</Typography>
        <Stack spacing={1}>
          {groupRows.map((r) => (
            <Stack key={r.index} direction="row" spacing={1} alignItems="flex-start">
              <Checkbox
                size="small"
                checked={checked.has(r.index)}
                disabled={!r.ok || disabled}
                onChange={() => onToggle(r.index)}
                inputProps={{ "aria-label": rowTitle(r) }}
                sx={{ p: 0.5 }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: g.danger ? "error.main" : "text.primary" }}>
                  {r.ok && String(r.op).startsWith("create_") && <Swatch color={r.fields.color} />}
                  {rowTitle(r)}
                </Typography>
                {r.ok && (r.op === "update" || String(r.op).startsWith("update_")) && r.diffs.map((d) => (
                  <Typography key={d.field} variant="caption" component="div" color="text.secondary">
                    {FIELD_LABEL[d.field]}: <span>{`${formatValue(d.field, d.before, L)} → ${formatValue(d.field, d.after, L)}`}</span>
                  </Typography>
                ))}
                {r.ok && r.op === "create" && (
                  <Typography variant="caption" component="div" color="text.secondary">
                    {createSummary(r, L)}
                  </Typography>
                )}
                {r.ok && r.op === "create_tag" && (
                  <Typography variant="caption" component="div" color="text.secondary">
                    {formatValue("organizationId", r.fields.organizationId, L)}
                  </Typography>
                )}
                {r.ok && r.op === "delete" && r.cascadeIds.length > 0 && (
                  <Typography variant="caption" component="div" color="error">
                    Also deletes {r.cascadeIds.length} subtask{r.cascadeIds.length === 1 ? "" : "s"}
                  </Typography>
                )}
                {r.ok && (r.op === "delete_tag" || r.op === "delete_category") && (
                  <Typography variant="caption" component="div" color="error">
                    {r.usedBy
                      ? `Removed from ${r.usedBy} task${r.usedBy === 1 ? "" : "s"} and from agenda topic cards`
                      : "No tasks use it; also removed from agenda topic cards"}
                  </Typography>
                )}
                {r.needs?.length > 0 && (
                  <Typography variant="caption" component="div" color="text.secondary">
                    Uses a new tag or category above — applies only if that one does.
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
  });
}

export const initialBoardChecked = (rows) => new Set(rows.filter((r) => r.ok && !r.stale).map((r) => r.index));

export function toggleIn(set, i) {
  const next = new Set(set);
  if (next.has(i)) next.delete(i); else next.add(i);
  return next;
}

export default function BoardChatChangesModal({ open, summary, rows, lookups, itemLabel, onApply, onCancel, applying = false, error = null }) {
  const [checked, setChecked] = useState(() => initialBoardChecked(rows));
  const count = checked.size;
  return (
    <Dialog open={open} maxWidth="sm" fullWidth>
      <DialogTitle>Review changes</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>{summary}</Typography>
        <BoardChangeList
          rows={rows}
          checked={checked}
          onToggle={(i) => setChecked((prev) => toggleIn(prev, i))}
          lookups={lookups}
          itemLabel={itemLabel}
          disabled={applying}
        />
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
