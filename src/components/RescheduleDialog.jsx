// src/components/RescheduleDialog.jsx
//
// V2.1 ship target. Lets a signed-in VM user move a single instance or an
// entire series. Dual-write: backend PATCHes Graph first (Graph fans .ics
// updates to all attendees), then mirrors to Google.

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  Typography,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { format } from "date-fns";

import { rescheduleMeeting } from "../lib/meetingsApi.js";

function pad2(n) { return String(n).padStart(2, "0"); }

export default function RescheduleDialog({ meeting, onClose, onSuccess }) {
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
  const [error, setError] = useState(null);

  const mutation = useMutation({
    mutationFn: rescheduleMeeting,
    onSuccess: () => {
      setError(null);
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
