// V2.2.2b.6 — Cancel agenda dialog (stage 2 of two-stage cancel flow).
//
// Hard-deletes the agenda from Firestore. Surfaces only when isBound is
// false in the Action Bar — either because the agenda was never scheduled
// or because Cancel meeting (stage 1) already cleared the calendar
// binding. Walks the topics + openFloor subcollections so they don't
// leak as orphans, then deletes the agenda doc itself and navigates back
// to /calendar.
//
// Confirmation modal only — no scope picker. The calendar event is
// already gone (or was never minted), so attendees don't need a fresh
// .ics — they were notified via Cancel meeting if that path applied.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase.js";

export default function CancelAgendaDialog({ agendaId, agendaTitle, onClose }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    setError(null);
    setBusy(true);
    try {
      // Walk subcollections best-effort. Firestore doesn't cascade-delete
      // subcollections when the parent is removed — they persist as
      // unreachable orphans. For an internal tool the data debt is small,
      // but we clean up the visible ones (topics + their nested
      // talkingPoints/notes, plus openFloor) so a future re-creation under
      // a recycled doc id can't pick up stale rows.
      //
      // Firestore batch limit is 500 ops. Typical agenda has <50 docs total
      // across all subcollections, well within one batch. For an unusually
      // dense agenda we'd need to split, but not handled here.
      const topicsSnap = await getDocs(collection(db, "agendas", agendaId, "topics"));
      const batch = writeBatch(db);
      for (const topicDoc of topicsSnap.docs) {
        const [tpSnap, notesSnap] = await Promise.all([
          getDocs(collection(db, "agendas", agendaId, "topics", topicDoc.id, "talkingPoints")),
          getDocs(collection(db, "agendas", agendaId, "topics", topicDoc.id, "notes")),
        ]);
        tpSnap.docs.forEach((d) => batch.delete(d.ref));
        notesSnap.docs.forEach((d) => batch.delete(d.ref));
        batch.delete(topicDoc.ref);
      }
      const ofSnap = await getDocs(collection(db, "agendas", agendaId, "openFloor"));
      ofSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      // Delete the agenda doc itself outside the batch so a subcollection
      // failure doesn't leave the doc removed but children intact.
      await deleteDoc(doc(db, "agendas", agendaId));

      navigate("/calendar");
    } catch (err) {
      setError(err.message || "Cancel agenda failed");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Cancel agenda
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          Permanently removes "{agendaTitle || "this agenda"}" from the app.
          Topics, talking points, notes, and open-floor items are deleted with
          it. Attendees are not notified — if you also need to cancel the
          calendar event, do that first via Cancel meeting.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            This action cannot be undone. The agenda and all its content will be gone for good.
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Back</Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleDelete}
          disabled={busy}
        >
          {busy ? "Cancelling…" : "Cancel agenda"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
