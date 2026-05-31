// AI Suggest Tasks dialog (Slice 5a + 5b). Admin-triggered from the agenda.
// Reads the meeting window (assembleGenInputs) + full SOPs + the org's board,
// and proposes three reviewable, selectable kinds of change:
//   • New tasks   → written as statusId 8 ("AI Gen" triage)
//   • Status moves → status change on an existing task (mutates — opt-in)
//   • Notes        → appended to an existing task's description
// Nothing applies unless checked.
import { useMemo, useState } from "react";
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
  Divider,
  Stack,
  Typography,
  TextField,
} from "@mui/material";
import { useAuth } from "../contexts/AuthContext.jsx";
import { assembleGenInputs } from "../lib/aiAgenda.js";
import { suggestTasks, applyTaskChanges } from "../lib/aiTasks.js";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";

const statusName = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.name || "";

export default function SuggestTasksDialog({ agenda, items, orgSlug, onClose }) {
  const { user } = useAuth();
  const [step, setStep] = useState("choose"); // choose | working | review
  const [extraContext, setExtraContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [moves, setMoves] = useState([]);
  const [notes, setNotes] = useState([]);
  const [selTasks, setSelTasks] = useState(new Set());
  const [selMoves, setSelMoves] = useState(new Set());
  const [selNotes, setSelNotes] = useState(new Set());
  const [existingTagSet, setExistingTagSet] = useState(() => new Set());

  const itemsById = useMemo(() => new Map((items || []).map((it) => [it.id, it])), [items]);
  const totalSelected = selTasks.size + selMoves.size + selNotes.size;
  const totalProposed = tasks.length + moves.length + notes.length;

  const run = async () => {
    setBusy(true);
    setError(null);
    setStep("working");
    try {
      const { transcripts, orgAgendas, categories, tagVocab } = await assembleGenInputs(agenda, items, orgSlug);
      setExistingTagSet(new Set((tagVocab || []).map((t) => (t.name || "").toLowerCase())));
      const existingTasks = (items || [])
        .filter((it) => it.organizationId === orgSlug)
        .map((it) => ({ id: it.id, title: it.title || "", status: statusName(it.statusId), category: it.categoryId || "" }));
      const result = await suggestTasks({
        agenda: { title: agenda?.title || "" },
        transcripts,
        orgAgendas,
        existingTasks,
        categories, // WITH full SOPs (the point of task suggestion)
        tagVocab,
        extraContext: extraContext.trim() || undefined,
      });
      setTasks(result.tasks);
      setMoves(result.moves);
      setNotes(result.notes);
      setSelTasks(new Set(result.tasks.map((_, i) => i)));
      setSelMoves(new Set(result.moves.map((_, i) => i)));
      setSelNotes(new Set(result.notes.map((_, i) => i)));
      setStep("review");
    } catch (err) {
      setError(err.message || "Task suggestion failed");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (setFn) => (i) => setFn((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await applyTaskChanges(orgSlug, {
        creates: tasks.filter((_, i) => selTasks.has(i)),
        moves: moves.filter((_, i) => selMoves.has(i)),
        notes: notes.filter((_, i) => selNotes.has(i)),
      }, user?.uid || null);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to apply changes");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Suggest tasks from this meeting</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {step === "review" ? (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              {totalProposed === 0 ? "No board changes proposed" : `${totalSelected} of ${totalProposed} selected`}
            </Typography>
            {totalProposed === 0 && (
              <Typography variant="body2" color="text.secondary">
                Nothing in this meeting's record warrants a board change beyond what's already tracked.
              </Typography>
            )}

            {tasks.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>New tasks → AI Gen</Typography>
                <Divider sx={{ mb: 0.5 }} />
                {tasks.map((t, i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75 }}>
                    <Checkbox size="small" checked={selTasks.has(i)} onChange={() => toggle(setSelTasks)(i)} sx={{ mt: -0.5 }} />
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
              </Box>
            )}

            {moves.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Status updates (existing tasks)</Typography>
                <Divider sx={{ mb: 0.5 }} />
                {moves.map((m, i) => {
                  const cur = statusName(itemsById.get(m.itemId)?.statusId) || "?";
                  return (
                    <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75 }}>
                      <Checkbox size="small" checked={selMoves.has(i)} onChange={() => toggle(setSelMoves)(i)} sx={{ mt: -0.5 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.title}</Typography>
                        <Typography variant="caption" sx={{ display: "block" }}>
                          <strong>{cur}</strong> → <strong>{m.toStatus}</strong>
                        </Typography>
                        {m.reason && <Typography variant="caption" color="text.secondary">{m.reason}</Typography>}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}

            {notes.length > 0 && (
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Notes (added to existing tasks)</Typography>
                <Divider sx={{ mb: 0.5 }} />
                {notes.map((n, i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75 }}>
                    <Checkbox size="small" checked={selNotes.has(i)} onChange={() => toggle(setSelNotes)(i)} sx={{ mt: -0.5 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{n.title}</Typography>
                      <Typography variant="caption" color="text.secondary">{n.note}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ) : step === "working" ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary" align="center">
              Reading the meeting record + SOPs and reconciling against the board…
            </Typography>
          </Stack>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The assistant scans this meeting's transcripts + agendas (with the Client SOPs) and proposes new
              tasks, status updates on existing tasks, and notes. You review + select before anything is applied.
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
          <Button variant="contained" onClick={apply} disabled={busy || totalSelected === 0}>
            {busy ? "Applying…" : `Apply ${totalSelected} change${totalSelected === 1 ? "" : "s"}`}
          </Button>
        ) : (
          <Button variant="contained" onClick={run} disabled={busy}>Suggest tasks</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
