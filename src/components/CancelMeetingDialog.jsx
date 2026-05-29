// V2.2.2b.4 — Cancel meeting dialog.
//
// Opens from the Action Bar's Cancel button. For recurring meetings the
// user picks a scope (this instance / all future / entire series); for
// one-time meetings the scope is implicit. For BOUND agendas we POST to
// /api/meetings/cancel which delegates to graph.cancelEvent + google
// mirror cancel — Graph fans .ics cancellations to every attendee from
// Outlook. For unbound agendas we just flip the agenda doc status to
// 'cancelled' (no calendar event to delete).

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import { format } from "date-fns";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { cancelMeeting } from "../lib/meetingsApi.js";

export default function CancelMeetingDialog({ agenda, agendaId, calendarSeries, onClose }) {
  const { user } = useAuth();
  const isRecurring = !!calendarSeries?.recurrence;
  const isBound = !!(agenda?.graphEventId || calendarSeries?.graphSeriesEventId);

  const [mode, setMode] = useState(isRecurring ? "instance" : "series");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const meetingDt = useMemo(() => {
    if (!agenda?.meetingDatetime) return null;
    return agenda.meetingDatetime?.toDate ? agenda.meetingDatetime.toDate() : null;
  }, [agenda?.meetingDatetime]);

  const handleCancel = async () => {
    setError(null);
    setBusy(true);
    try {
      if (isBound) {
        // For instance mode, the API needs the specific occurrence's date
        // (YYYY-MM-DD) so it can target the right exception.
        const dateStr = mode === "instance" && meetingDt
          ? format(meetingDt, "yyyy-MM-dd")
          : null;
        // Google's events.instances() rejects per-instance IDs — it needs
        // the series master. For one-time + bound, googleEventId is the
        // same as the series id. Bail with a clear error if we have neither
        // rather than sending the agenda doc id (which is never a valid
        // Google event ID).
        const eventId =
          calendarSeries?.googleSeriesEventId
          || agenda?.googleEventId
          || null;
        if (!eventId) {
          throw new Error("No Google event binding on this agenda — cannot cancel via API.");
        }
        await cancelMeeting({
          orgId: agenda?.organizationId || calendarSeries?.organizationId || null,
          eventId,
          mode,
          date: dateStr,
        });
      }
      await updateDoc(doc(db, "agendas", agendaId), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
      // If cancelling the whole series, mark the series doc too so Calendar
      // page filters can hide it.
      if (mode === "series" && calendarSeries?.id) {
        await updateDoc(doc(db, "calendar_series", calendarSeries.id), {
          status: "cancelled",
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || null,
        });
      }
      onClose();
    } catch (err) {
      setError(err.message || "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Cancel meeting
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          {isBound
            ? "Graph fans the cancellation invite to every attendee from meetings@'s Outlook; the Google Calendar mirror is removed silently."
            : "This agenda isn't bound to a calendar event yet — only the agenda doc status will change."}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {isRecurring && isBound && (
            <FormControl>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.5 }}>
                Scope
              </Typography>
              <RadioGroup value={mode} onChange={(e) => setMode(e.target.value)}>
                <FormControlLabel
                  value="instance"
                  control={<Radio size="small" />}
                  label={`Just this meeting${meetingDt ? ` (${format(meetingDt, "MMM d")})` : ""}`}
                />
                <FormControlLabel
                  value="series"
                  control={<Radio size="small" />}
                  label="Entire series (all past + future instances)"
                />
              </RadioGroup>
            </FormControl>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Back</Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleCancel}
          disabled={busy}
        >
          {busy ? "Cancelling…" : "Cancel meeting"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
