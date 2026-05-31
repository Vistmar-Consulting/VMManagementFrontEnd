// Agenda version history dialog: save a version, list versions, preview a
// version (rendered via composeAgendaHtml), and restore one. Restore is itself
// revertible (restoreAgendaVersion snapshots the current state first).
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { format } from "date-fns";
import { orderBy } from "firebase/firestore";

import { useCollection } from "../hooks/useCollection.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { snapshotAgenda, restoreAgendaVersion } from "../lib/agendaVersions.js";
import { composeAgendaHtml } from "../lib/agendaHtml.js";

const SOURCE_LABEL = {
  manual: "Saved",
  "pre-ai-gen": "Before AI Gen",
  "pre-restore": "Before restore",
};

function fmt(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    return d ? format(d, "MMM d, yyyy · h:mm a") : "…";
  } catch {
    return "…";
  }
}

export default function AgendaHistoryDialog({ agendaId, onClose }) {
  const { user } = useAuth();
  const constraints = useMemo(() => [orderBy("createdAt", "desc")], []);
  const { data: versions } = useCollection(agendaId ? `agendas/${agendaId}/versions` : null, constraints);

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // a version doc being previewed

  const saveVersion = async () => {
    setBusy(true);
    try {
      await snapshotAgenda(agendaId, { source: "manual", label: label.trim() || null, uid: user?.uid || null });
      setLabel("");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (versionId) => {
    if (!window.confirm("Restore this version? Your current agenda is saved as a version first, so you can undo.")) return;
    setBusy(true);
    try {
      await restoreAgendaVersion(agendaId, versionId, { uid: user?.uid || null });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const previewHtml = useMemo(() => {
    if (!preview?.snapshot) return "";
    const s = preview.snapshot;
    return composeAgendaHtml(s, s.topics || []);
  }, [preview]);

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Version history</DialogTitle>
      <DialogContent dividers>
        {preview ? (
          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <IconButton size="small" onClick={() => setPreview(null)}><ArrowBackIcon fontSize="small" /></IconButton>
              <Typography variant="subtitle2">
                Preview — {SOURCE_LABEL[preview.source] || preview.source} · {fmt(preview.createdAt)}
              </Typography>
            </Stack>
            <Box
              sx={{
                border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2, maxHeight: 420, overflow: "auto",
                fontSize: 13, lineHeight: 1.4,
                "& h2": { fontSize: 15, fontWeight: 700, mt: 2, mb: 0.5 },
                "& ul, & ol": { pl: 3, m: 0 }, "& li": { mb: 0.3 }, "& li p": { m: 0 },
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml || "<em>Empty agenda</em>" }}
            />
          </Box>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <TextField
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                size="small"
                fullWidth
              />
              <Button variant="contained" size="small" onClick={saveVersion} disabled={busy} sx={{ whiteSpace: "nowrap" }}>
                Save version
              </Button>
            </Stack>
            <Divider sx={{ mb: 1 }} />
            {(!versions || versions.length === 0) ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                No saved versions yet. Click "Save version" to capture the current agenda.
              </Typography>
            ) : (
              <Stack divider={<Divider />}>
                {versions.map((v) => (
                  <Stack key={v.id} direction="row" alignItems="center" spacing={1} sx={{ py: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{fmt(v.createdAt)}</Typography>
                        <Chip label={SOURCE_LABEL[v.source] || v.source} size="small" variant="outlined" />
                      </Stack>
                      {v.label && <Typography variant="caption" color="text.secondary">{v.label}</Typography>}
                    </Box>
                    <Button size="small" onClick={() => setPreview(v)}>Preview</Button>
                    <Button size="small" color="primary" variant="outlined" disabled={busy} onClick={() => restore(v.id)}>Restore</Button>
                  </Stack>
                ))}
              </Stack>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
