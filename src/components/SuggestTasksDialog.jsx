// AI Suggest Tasks dialog (Slice 5a). Admin-triggered from the agenda. Reads
// the meeting window (reusing assembleGenInputs) + full SOPs + the org's
// existing board, proposes NEW tasks, and writes the selected ones as
// statusId 8 ("AI Gen" triage) for the human to promote/discard on the board.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useAuth } from "../contexts/AuthContext.jsx";
import { assembleGenInputs } from "../lib/aiAgenda.js";
import { suggestTasks, applyTaskSuggestions } from "../lib/aiTasks.js";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";

const statusName = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.name || "";

export default function SuggestTasksDialog({ agenda, items, orgSlug, onClose }) {
  const { user } = useAuth();
  const [step, setStep] = useState("choose"); // choose | working | review
  const [extraContext, setExtraContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(new Set());

  // Existing tag names (lowercased) — populated after assembleGenInputs; used
  // to flag coined tags as "· new" in the review.
  const [existingTagSet, setExistingTagSet] = useState(() => new Set());

  const run = async () => {
    setBusy(true);
    setError(null);
    setStep("working");
    try {
      const { transcripts, orgAgendas, categories, tagVocab } = await assembleGenInputs(agenda, items, orgSlug);
      setExistingTagSet(new Set((tagVocab || []).map((t) => (t.name || "").toLowerCase())));
      const existingTasks = (items || [])
        .filter((it) => it.organizationId === orgSlug)
        .map((it) => ({ title: it.title || "", status: statusName(it.statusId), category: it.categoryId || "" }));
      const result = await suggestTasks({
        agenda: { title: agenda?.title || "" },
        transcripts,
        orgAgendas,
        existingTasks,
        categories, // WITH full SOPs (the point of task suggestion)
        tagVocab,
        extraContext: extraContext.trim() || undefined,
      });
      setTasks(result);
      setSelected(new Set(result.map((_, i) => i))); // default all checked
      setStep("review");
    } catch (err) {
      setError(err.message || "Task suggestion failed");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = tasks.filter((_, i) => selected.has(i));
      await applyTaskSuggestions(orgSlug, chosen, user?.uid || null);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to add tasks");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Suggest tasks from this meeting</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
        )}

        {step === "review" ? (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {tasks.length === 0 ? "No new tasks found" : `${selected.size} of ${tasks.length} selected`}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              Selected tasks are added to the board in the <strong>AI Gen</strong> column for you to triage.
            </Typography>
            {tasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing new surfaced in this meeting's record that isn't already on the board.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {tasks.map((t, i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", borderBottom: "1px solid", borderColor: "divider", pb: 1 }}>
                    <Checkbox size="small" checked={selected.has(i)} onChange={() => toggle(i)} sx={{ mt: -0.5 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.title}</Typography>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5, my: 0.5 }} useFlexGap>
                        {t.category && <Chip label={t.category} size="small" color="primary" variant="outlined" />}
                        {(t.tags || []).map((tag) => {
                          const isNew = !existingTagSet.has(String(tag).toLowerCase());
                          return <Chip key={tag} label={isNew ? `${tag} · new` : tag} size="small" color={isNew ? "secondary" : "default"} variant={isNew ? "filled" : "outlined"} />;
                        })}
                      </Stack>
                      {t.note && <Typography variant="caption" color="text.secondary">{t.note}</Typography>}
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        ) : step === "working" ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary" align="center">
              Reading the meeting record + SOPs and surfacing new tasks…
            </Typography>
          </Stack>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The assistant scans this meeting's transcripts + agendas (with the Client SOPs) and proposes new
              Project Board tasks that aren't already tracked. You review + select before anything is added.
            </Typography>
            <TextField
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              label="Additional context (optional)"
              placeholder="e.g. Focus on CyberKnife event prep; we already handled the GBP claims."
              multiline
              minRows={3}
              fullWidth
              disabled={busy}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{step === "review" ? "Discard" : "Cancel"}</Button>
        {step === "review" ? (
          <Button variant="contained" onClick={apply} disabled={busy || selected.size === 0}>
            {busy ? "Adding…" : `Add ${selected.size} task${selected.size === 1 ? "" : "s"}`}
          </Button>
        ) : (
          <Button variant="contained" onClick={run} disabled={busy}>Suggest tasks</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
