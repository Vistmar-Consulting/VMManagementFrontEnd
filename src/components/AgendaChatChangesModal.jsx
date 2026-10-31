// Agenda Chat's confirm step: every proposed agenda change, one row each with
// a checkbox and a redline of any body it rewrites, then the Task Board
// changes of the same proposal (BoardChangeList, as in Board Chat). Invalid
// ops can't be ticked; ops on topics or items changed since Claude last read
// them start unticked. Nothing writes until Apply. No Escape / backdrop
// close: leaving is Cancel.
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
import { BoardChangeList, initialBoardChecked, toggleIn, withNewNames } from "./BoardChatChangesModal.jsx";
import { diffAgendaHtml } from "../lib/agendaDiff.js";
import { sanitizeRedlineHtml } from "../lib/agendaHtml.js";
import { t } from "../theme/tokens.js";

const REDLINE_SX = {
  mt: 0.75,
  p: 1,
  border: "1px solid",
  borderColor: "divider",
  borderRadius: 1,
  maxHeight: 260,
  overflow: "auto",
  fontSize: 13,
  lineHeight: 1.4,
  "& ul, & ol": { pl: 3, m: 0 },
  "& li": { mb: 0.3 },
  "& p, & li p": { m: 0 },
  "& table": { borderCollapse: "collapse", width: "100%", my: 0.75 },
  "& th, & td": { border: "1px solid", borderColor: "divider", p: "4px 6px", verticalAlign: "top" },
  "& del": { color: t.red, textDecoration: "line-through" },
  "& ins": { color: t.green, textDecoration: "none", backgroundColor: `${t.green}1f` },
};

function rowTitle(r, itemLabel) {
  if (!r.ok) return `Change ${r.index + 1}`;
  if (r.op === "create_topic") return `Add topic “${r.name}”`;
  if (r.op === "delete_topic") return `Delete topic “${r.topicName}”`;
  if (r.op === "set_open_floor") return "Rewrite the Open Floor";
  if (r.op === "move_topic") return `Move “${r.topicName}” ${r.afterTopicId === "start" ? "to the top" : `after “${r.afterName}”`}`;
  if (r.op === "remove_task") return `Take “${itemLabel(r.itemId)}” off the “${r.topicName}” card`;
  if (r.op === "restore_task") return `Put “${itemLabel(r.itemId)}” back on the “${r.topicName}” card`;
  const parts = [
    r.name && `rename it “${r.name}”`,
    r.afterHtml !== undefined && "rewrite its body",
    r.keys && "change which tasks its card shows",
  ].filter(Boolean);
  return `“${r.topicName}”: ${parts.join(", ")}`;
}

function redlineOf(r) {
  if (!r.ok) return null;
  if (r.op === "create_topic") return r.afterHtml ? diffAgendaHtml("", r.afterHtml) : null;
  if (r.op === "delete_topic") return r.beforeHtml ? diffAgendaHtml(r.beforeHtml, "") : null;
  if (r.afterHtml !== undefined) return diffAgendaHtml(r.beforeHtml, r.afterHtml) || "<p><em>Empty</em></p>";
  return null;
}

const KEY_LABEL = { categoryIds: "Categories", tagIds: "Tags" };

// boardRows / lookups / itemLabel: the Task Board half (boardChat/proposal.js
// rows) and how to name its members, tags, categories and items.
// onApply(agendaChecked, boardChecked).
export default function AgendaChatChangesModal({
  summary, rows, initialChecked, boardRows = [], initialBoardChecked: boardInit, lookups, itemLabel = (id) => id,
  orgName, othersCount = 0, onApply, onCancel, applying = false, error = null,
}) {
  const [checked, setChecked] = useState(() => initialChecked ?? new Set(rows.filter((r) => r.ok && !r.stale).map((r) => r.index)));
  const [boardChecked, setBoardChecked] = useState(() => boardInit ?? initialBoardChecked(boardRows));
  const L = lookups ? withNewNames(lookups, boardRows) : null;
  const keyNames = (field, ids) => (ids.length ? ids.map((id) => (field === "tagIds" ? L.tagName(id) : L.categoryName(id))).join(", ") : "none");
  const count = checked.size + boardChecked.size;

  return (
    <Dialog open maxWidth="md" fullWidth>
      <DialogTitle>Review changes</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>{summary}</Typography>
        {othersCount > 0 && rows.length > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {othersCount} other {othersCount === 1 ? "person is" : "people are"} in this agenda now. A rewritten body replaces what is there, including anything they are typing in it.
          </Alert>
        )}
        {rows.length > 0 && boardRows.length > 0 && <Typography variant="overline" color="text.secondary">Agenda</Typography>}
        <Stack spacing={1.5}>
          {rows.map((r) => {
            const redline = redlineOf(r);
            return (
              <Box key={r.index} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <Checkbox
                  size="small"
                  checked={checked.has(r.index)}
                  disabled={!r.ok || applying}
                  onChange={() => setChecked((prev) => toggleIn(prev, r.index))}
                  inputProps={{ "aria-label": rowTitle(r, itemLabel) }}
                  sx={{ p: 0.5 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" color={r.op === "delete_topic" ? "error" : "text.primary"}>
                    {rowTitle(r, itemLabel)}
                    {r.op === "create_topic" && r.orgId && orgName ? ` · ${orgName(r.orgId)}` : ""}
                  </Typography>
                  {r.ok && r.keys && L && Object.entries(r.keys).map(([field, { before, after }]) => (
                    <Typography key={field} variant="caption" color="text.secondary" component="div">
                      {`${KEY_LABEL[field]}: ${keyNames(field, before)} → ${keyNames(field, after)}`}
                    </Typography>
                  ))}
                  {r.boardNeeds?.length > 0 && (
                    <Typography variant="caption" color="text.secondary" component="div">
                      Uses a new tag or category below — applies only if that one does.
                    </Typography>
                  )}
                  {r.reason && <Typography variant="caption" color="text.secondary" component="div">{r.reason}</Typography>}
                  {!r.ok && <Alert severity="error" sx={{ mt: 0.5, py: 0 }}>{r.error}</Alert>}
                  {r.stale && (
                    <Alert severity="warning" sx={{ mt: 0.5, py: 0 }}>
                      Someone changed this after Claude read it — applying replaces their edit. Unticked to be safe.
                    </Alert>
                  )}
                  {redline && <Box sx={REDLINE_SX} dangerouslySetInnerHTML={{ __html: sanitizeRedlineHtml(redline) }} />}
                </Box>
              </Box>
            );
          })}
        </Stack>
        {rows.length > 0 && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
            The agenda is saved to Version history before these changes are applied.
          </Typography>
        )}
        {boardRows.length > 0 && (
          <Box sx={{ mt: rows.length ? 3 : 0 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Task Board</Typography>
            <BoardChangeList
              rows={boardRows}
              checked={boardChecked}
              onToggle={(i) => setBoardChecked((prev) => toggleIn(prev, i))}
              lookups={lookups}
              itemLabel={itemLabel}
              disabled={applying}
            />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={applying}>Cancel</Button>
        <Button variant="contained" onClick={() => onApply(checked, boardChecked)} disabled={applying || count === 0}>
          {applying ? "Applying…" : `Apply ${count} change${count === 1 ? "" : "s"}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
