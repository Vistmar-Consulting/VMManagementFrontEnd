// V2.2.2b.6 — Cancel meeting dialog (stage 1 of two-stage cancel flow).
//
// Cancels just the calendar event. The agenda doc stays accessible — topics,
// notes, talking points, attendee list, prepared-by all remain visible. The
// meeting binding fields (graphEventId, googleEventId, teamsUrl, etc.) are
// cleared so isBound flips to false on the Action Bar, which morphs the
// red button from "Cancel meeting" to "Cancel agenda" (stage 2).
//
// For recurring meetings the user picks scope (instance vs series); for
// one-time it's implicit. The /api/meetings/cancel endpoint delegates to
// graph.cancelEvent which uses POST /cancel and fans cancellation .ics
// invites to every attendee from meetings@'s Outlook.

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
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
  const [notify, setNotify] = useState(true);
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
        const dateStr = mode === "instance" && meetingDt
          ? format(meetingDt, "yyyy-MM-dd")
          : null;
        // Google's events.instances() rejects per-instance IDs — recurring
        // patches need the series master. Bail loudly if both are missing.
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
          notify,
        });
      }

      // Clear the meeting binding so isBound flips to false and the Action
      // Bar morphs the red button to "Cancel agenda". The agenda doc itself
      // stays accessible — meetingCancelledAt records when this happened.
      await updateDoc(doc(db, "agendas", agendaId), {
        graphEventId: null,
        googleEventId: null,
        iCalUID: null,
        teamsUrl: null,
        calendarSeriesId: null,
        meetingCancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });

      // For series-scope cancel, mark the calendar_series doc too so the
      // Calendar page can filter out the cancelled series.
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
            ? "Cancels the calendar event. With “Notify attendees” on, Google emails a cancellation to every attendee and removes it from their calendars; off removes it silently (use for cleanup, e.g. a duplicate series). The agenda itself stays — reschedule it or cancel the agenda separately."
            : "This agenda isn't bound to a calendar event yet — nothing to cancel here. Use Cancel agenda instead if you want to remove the agenda."}
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

          {isBound && (
            <FormControlLabel
              control={<Checkbox size="small" checked={notify} onChange={(e) => setNotify(e.target.checked)} />}
              label={
                <Typography sx={{ fontSize: 13 }}>
                  Notify attendees (send cancellation)
                </Typography>
              }
            />
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
          disabled={busy || !isBound}
        >
          {busy ? "Cancelling…" : "Cancel meeting"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
