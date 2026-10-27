// Board Chat's confirm step: every proposed create / update / delete, one row
// each with a checkbox. Invalid ops can't be ticked; ops on items changed
// since Claude last read them start unticked. Nothing writes until Apply.
// There is no Escape / backdrop close: leaving without applying is Cancel.
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
};

function formatValue(field, value, L) {
  if (value == null || (Array.isArray(value) && value.length === 0)) return "—";
  if (field === "statusId") return statusName(value);
  if (field === "priorityId") return priorityName(value);
  if (field === "assigneeIds") return value.map(L.userName).join(", ");
  if (field === "categoryId") return L.categoryName(value);
  if (field === "tagIds") return value.map(L.tagName).join(", ");
  if (field === "dueDate") return ymd(value);
  return String(value);
}

const GROUPS = [
  { op: "create", label: "Create" },
  { op: "update", label: "Update" },
  { op: "delete", label: "Delete" },
];

export default function BoardChatChangesModal({ open, summary, rows, lookups: L, itemLabel, onApply, onCancel, applying = false, error = null }) {
  const [checked, setChecked] = useState(() => new Set(rows.filter((r) => r.ok && !r.stale).map((r) => r.index)));
  const toggle = (i) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  // A rejected create has no fields or itemId, so it is named by its position.
  const rowTitle = (r) => {
    if (r.op === "create") {
      if (!r.ok) return `Op ${r.index + 1}`;
      return `${r.parentId || r.parentTempId ? "Subtask" : "Task"}: ${r.fields.title}`;
    }
    return r.itemId ? itemLabel(r.itemId) : `Op ${r.index + 1}`;
  };

  const count = checked.size;
  return (
    <Dialog open={open} maxWidth="sm" fullWidth>
      <DialogTitle>Review changes</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>{summary}</Typography>
        {GROUPS.map((g) => {
          const groupRows = rows.filter((r) => r.op === g.op);
          if (groupRows.length === 0) return null;
          return (
            <Box key={g.op} sx={{ mb: 2 }}>
              <Typography variant="overline" color={g.op === "delete" ? "error" : "text.secondary"}>{g.label}</Typography>
              <Stack spacing={1}>
                {groupRows.map((r) => (
                  <Stack key={r.index} direction="row" spacing={1} alignItems="flex-start">
                    <Checkbox
                      size="small"
                      checked={checked.has(r.index)}
                      disabled={!r.ok || applying}
                      onChange={() => toggle(r.index)}
                      inputProps={{ "aria-label": rowTitle(r) }}
                      sx={{ p: 0.5 }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: g.op === "delete" ? "error.main" : "text.primary" }}>
                        {rowTitle(r)}
                      </Typography>
                      {r.ok && r.op === "update" && r.diffs.map((d) => (
                        <Typography key={d.field} variant="caption" component="div" color="text.secondary">
                          {FIELD_LABEL[d.field]}: <span>{`${formatValue(d.field, d.before, L)} → ${formatValue(d.field, d.after, L)}`}</span>
                        </Typography>
                      ))}
                      {r.ok && r.op === "create" && (
                        <Typography variant="caption" component="div" color="text.secondary">
                          {L.orgName(r.orgId)}
                          {r.fields.assigneeIds?.length ? ` · ${formatValue("assigneeIds", r.fields.assigneeIds, L)}` : ""}
                          {r.fields.dueDate ? ` · due ${ymd(r.fields.dueDate)}` : ""}
                        </Typography>
                      )}
                      {r.ok && r.op === "delete" && r.cascadeIds.length > 0 && (
                        <Typography variant="caption" component="div" color="error">
                          Also deletes {r.cascadeIds.length} subtask{r.cascadeIds.length === 1 ? "" : "s"}
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
        })}
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
