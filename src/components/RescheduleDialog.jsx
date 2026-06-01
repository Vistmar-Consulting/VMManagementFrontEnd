// src/components/RescheduleDialog.jsx
//
// V2.1.1 dual-write reschedule:
//   1. POST /api/meetings/reschedule (PATCHes Graph → Google mirror)
//   2. On success, write the new meetingDatetime + rescheduledFrom to the
//      Firestore agenda doc that matches this meeting (joined via
//      graphEventId or googleEventId).
//
// Step 2 makes Firestore the source of truth for app state. Future agenda
// detail views read meetingDatetime from the agenda doc, not the API.

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { format } from "date-fns";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { rescheduleMeeting, sendMeetingMessage } from "../lib/meetingsApi.js";
import { visibleAttendees } from "../lib/meetingHelpers.js";
import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

function pad2(n) { return String(n).padStart(2, "0"); }

export default function RescheduleDialog({ meeting, agenda, onClose, onSuccess }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const originalStart = useMemo(
    () => (meeting?.date ? new Date(meeting.date) : new Date()),
    [meeting?.date]
  );
  const originalEnd = useMemo(
    () => (meeting?.end_date ? new Date(meeting.end_date) : null),
    [meeting?.end_date]
  );
  const isRecurring = meeting?.type === "recurring";

  // Preserve original duration on reschedule (archive defaulted to 1hr).
  const originalDurationMinutes = useMemo(() => {
    if (!originalEnd || !originalStart || isNaN(originalEnd) || isNaN(originalStart)) return 60;
    const min = Math.round((originalEnd.getTime() - originalStart.getTime()) / 60000);
    return min > 0 ? min : 60;
  }, [originalStart, originalEnd]);

  // Scope only meaningful for recurring meetings. Non-recurring meetings
  // always patch their own event directly — the backend's `series` mode does
  // exactly that (events.patch on the event_id, no findInstanceByDate).
  const [mode, setMode] = useState("instance");
  const [newDate, setNewDate] = useState(originalStart);
  const [newTime, setNewTime] = useState(originalStart);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);

  // Human recipients for the optional custom note (proxies/bots filtered out).
  const recipients = useMemo(
    () => visibleAttendees(meeting?.attendees || []),
    [meeting?.attendees],
  );

  // Dual-write: call API, then mirror the new meetingDatetime to the
  // matching Firestore agenda doc. Failure to update Firestore doesn't roll
  // back the API write (Graph + Google are already moved) — it surfaces as
  // a warning. Reconciliation will pick up the drift on next page load.
  const mutation = useMutation({
    mutationFn: async (vars) => {
      const apiResult = await rescheduleMeeting(vars);
      if (agenda?.id) {
        try {
          await updateDoc(doc(db, "agendas", agenda.id), {
            meetingDatetime: new Date(`${vars.new_date_iso}`),
            durationMinutes: vars.durationMinutes,
            rescheduledFrom: agenda.meetingDatetime || null,
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || null,
          });
        } catch (firestoreErr) {
          console.error("[RescheduleDialog] Firestore agenda update failed (Graph + Google succeeded):", firestoreErr);
        }
      }

      // Optional custom note to the human attendees — supplements the native
      // Outlook reschedule invite (which has no message slot). Best-effort.
      if (vars.message?.trim() && recipients.length) {
        try {
          await sendMeetingMessage({
            title: meeting?.title || "Meeting",
            kind: "reschedule",
            dateFormatted: format(new Date(vars.new_date_iso), "EEE MMM d, h:mm a"),
            message: vars.message.trim(),
            attendees: recipients,
          });
        } catch (msgErr) {
          console.error("[RescheduleDialog] custom note send failed (reschedule already done):", msgErr);
        }
      }
      return apiResult;
    },
    onSuccess: () => {
      setError(null);
      // Refresh the Calendar's cached meeting list everywhere (this dialog is
      // used from both the Calendar and the Agenda Action Bar).
      queryClient.invalidateQueries({ queryKey: ["meetings-list"] });
      onSuccess?.();
    },
    onError: (err) => setError(err.message || "Reschedule failed"),
  });

  const handleSubmit = () => {
    setError(null);
    if (!newDate || !newTime) {
      setError("Pick a new date and time.");
      return;
    }
    const dateStr = format(newDate, "yyyy-MM-dd");
    const timeStr = `${pad2(newTime.getHours())}:${pad2(newTime.getMinutes())}`;
    const originalDateStr = format(originalStart, "yyyy-MM-dd");
    // Construct a wall-clock ISO for the Firestore Timestamp write — uses the
    // local browser TZ same way the picker captured the inputs. Pacific is
    // hardcoded server-side in the API; Firestore stores the absolute instant.
    const newDateIso = (() => {
      const d = new Date(newDate);
      d.setHours(newTime.getHours(), newTime.getMinutes(), 0, 0);
      return d.toISOString();
    })();

    // For recurring meetings, the eventId passed to the backend MUST be the
    // recurring master id (series_id). Google's events.instances() rejects
    // expanded-instance ids like "<master>_20260527T140000Z". For
    // non-recurring meetings, event_id IS the master (no series exists).
    const eventIdForApi = isRecurring ? meeting.series_id : meeting.event_id;
    // Collapse non-recurring meetings to "series" mode so the backend skips
    // findInstanceByDate (which is recurring-only) and patches directly.
    const effectiveMode = isRecurring ? mode : "series";

    mutation.mutate({
      eventId: eventIdForApi,
      mode: effectiveMode,
      originalDate: effectiveMode === "instance" ? originalDateStr : null,
      newDate: dateStr,
      newTime: timeStr,
      timezone: "America/Los_Angeles",
      durationMinutes: originalDurationMinutes,
      orgId: meeting.org_id || null,
      new_date_iso: newDateIso,  // passed through for Firestore write only
      message,                   // passed through for the optional note email
    });
  };

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Reschedule meeting
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {meeting.title || "(untitled)"} · currently {format(originalStart, "EEE MMM d, h:mm a")}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {isRecurring && (
            <FormControl>
              <FormLabel>Scope</FormLabel>
              <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value)}>
                <FormControlLabel
                  value="instance"
                  control={<Radio size="small" />}
                  label={`Just this meeting (${format(originalStart, "MMM d")})`}
                />
                <FormControlLabel
                  value="series"
                  control={<Radio size="small" />}
                  label="Entire series"
                />
              </RadioGroup>
            </FormControl>
          )}

          <Stack direction="row" spacing={2}>
            <DatePicker
              label="New date"
              value={newDate}
              onChange={setNewDate}
              slotProps={{ textField: { size: "small", fullWidth: true } }}
            />
            <TimePicker
              label="New time"
              value={newTime}
              onChange={setNewTime}
              minutesStep={15}
              slotProps={{ textField: { size: "small", fullWidth: true } }}
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Times shown in Pacific (Vistamar HQ). Duration preserved at {originalDurationMinutes} min.
            Attendees will be notified automatically via Outlook (Microsoft Graph fans the
            updated invite to every attendee); the Google Calendar mirror is updated silently.
          </Typography>

          {recipients.length > 0 && (
            <TextField
              label="Add a note to attendees (optional)"
              placeholder="e.g. Moving this so it doesn't clash with your QBR — same agenda, new time."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              multiline
              minRows={2}
              size="small"
              fullWidth
              helperText={`Emails a short note to the ${recipients.length} attendee${recipients.length !== 1 ? "s" : ""} alongside the updated invite.`}
            />
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Rescheduling…" : "Reschedule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
