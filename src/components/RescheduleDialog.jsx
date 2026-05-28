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
import { format, parseISO } from "date-fns";

import { rescheduleMeeting } from "../lib/meetingsApi.js";

function pad2(n) { return String(n).padStart(2, "0"); }

export default function RescheduleDialog({ meeting, onClose, onSuccess }) {
  const originalStart = useMemo(
    () => (meeting?.date ? new Date(meeting.date) : new Date()),
    [meeting?.date]
  );
  const isRecurring = meeting?.type === "recurring";

  // Default scope: instance for recurring, "series" is irrelevant for singles
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

    mutation.mutate({
      eventId: meeting.event_id,
      mode,
      originalDate: mode === "instance" ? originalDateStr : null,
      newDate: dateStr,
      newTime: timeStr,
      timezone: "America/Los_Angeles",
      orgId: meeting.org_id || meeting.orgId || null,
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
            Attendees will be notified automatically via Outlook (Microsoft Graph fans the
            updated invite to every attendee). The Google Calendar mirror is updated silently.
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
