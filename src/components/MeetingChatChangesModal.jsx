// Meeting Chat's confirm step: every proposed agenda change, one row each with
// a checkbox and a redline of any body it rewrites. Invalid ops can't be
// ticked; ops on topics changed since Claude last read them start unticked.
// Nothing writes until Apply. No Escape / backdrop close: leaving is Cancel.
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

function rowTitle(r) {
  if (!r.ok) return `Change ${r.index + 1}`;
  if (r.op === "create_topic") return `Add topic “${r.name}”`;
  if (r.op === "delete_topic") return `Delete topic “${r.topicName}”`;
  if (r.op === "set_open_floor") return "Rewrite the Open Floor";
  if (r.op === "move_topic") return `Move “${r.topicName}” ${r.afterTopicId === "start" ? "to the top" : `after “${r.afterName}”`}`;
  if (r.name && r.afterHtml !== undefined) return `Rename “${r.topicName}” to “${r.name}” and rewrite its body`;
  if (r.name) return `Rename “${r.topicName}” to “${r.name}”`;
  return `Rewrite “${r.topicName}”`;
}

function redlineOf(r) {
  if (!r.ok) return null;
  if (r.op === "create_topic") return r.afterHtml ? diffAgendaHtml("", r.afterHtml) : null;
  if (r.op === "delete_topic") return r.beforeHtml ? diffAgendaHtml(r.beforeHtml, "") : null;
  if (r.afterHtml !== undefined) return diffAgendaHtml(r.beforeHtml, r.afterHtml) || "<p><em>Empty</em></p>";
  return null;
}

export default function MeetingChatChangesModal({ summary, rows, initialChecked, orgName, othersCount = 0, onApply, onCancel, applying = false, error = null }) {
  const [checked, setChecked] = useState(() => initialChecked ?? new Set(rows.filter((r) => r.ok && !r.stale).map((r) => r.index)));
  const toggle = (i) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <Dialog open maxWidth="md" fullWidth>
      <DialogTitle>Review agenda changes</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>{summary}</Typography>
        {othersCount > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {othersCount} other {othersCount === 1 ? "person is" : "people are"} in this agenda now. A rewritten body replaces what is there, including anything they are typing in it.
          </Alert>
        )}
        <Stack spacing={1.5}>
          {rows.map((r) => {
            const redline = redlineOf(r);
            return (
              <Box key={r.index} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <Checkbox
                  size="small"
                  checked={checked.has(r.index)}
                  disabled={!r.ok || applying}
                  onChange={() => toggle(r.index)}
                  inputProps={{ "aria-label": rowTitle(r) }}
                  sx={{ p: 0.5 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" color={r.op === "delete_topic" ? "error" : "text.primary"}>
                    {rowTitle(r)}
                    {r.op === "create_topic" && r.orgId && orgName ? ` · ${orgName(r.orgId)}` : ""}
                  </Typography>
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
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
          The agenda is saved to Version history before these changes are applied.
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={applying}>Cancel</Button>
        <Button variant="contained" onClick={() => onApply(checked)} disabled={applying || checked.size === 0}>
          {applying ? "Applying…" : `Apply ${checked.size} change${checked.size === 1 ? "" : "s"}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
