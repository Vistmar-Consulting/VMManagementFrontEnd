// V2.2.2b.3 — Schedule create dialog. Opens from an unbound agenda's
// schedule row. Mints a Graph + Google calendar event via
// /api/meetings/create and writes the new IDs back to the agenda doc +
// calendar_series doc so the agenda becomes "scheduled".
//
// Per docs/AGENDA_DETAIL_PAGE_REFERENCE.md §3 "create" mode. Frequency pills
// + day-of-week (recurring) + date + time + duration. Monthly/Quarterly
// (ordinal + relativeMonthly) defer to V2.2.2b.4.

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { addDays, format, parseISO, set } from "date-fns";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { createMeeting } from "../lib/meetingsApi.js";
import { visibleAttendees } from "../lib/meetingHelpers.js";

const FREQUENCY_OPTIONS = [
  { id: "one-time", label: "One-time", enabled: true },
  { id: "weekly", label: "Weekly", enabled: true },
  { id: "biweekly", label: "Biweekly", enabled: true },
  { id: "monthly", label: "Monthly", enabled: false },
  { id: "quarterly", label: "Quarterly", enabled: false },
];

const WEEKDAYS = [
  { id: "monday", label: "Mon" },
  { id: "tuesday", label: "Tue" },
  { id: "wednesday", label: "Wed" },
  { id: "thursday", label: "Thu" },
  { id: "friday", label: "Fri" },
];

function pad2(n) { return String(n).padStart(2, "0"); }

export default function ScheduleCreateDialog({ agenda, agendaId, calendarSeries, orgs, onClose }) {
  const { user } = useAuth();
  const orgId =
    agenda?.organizationId
    || calendarSeries?.organizationId
    || null;

  const initialDate = useMemo(() => {
    // Default the date to next Tuesday so weekly cadence defaults make sense.
    // For one-time it's just a starting point the user can change.
    const now = new Date();
    return addDays(now, 1);
  }, []);

  const [frequency, setFrequency] = useState("one-time");
  const [dayOfWeek, setDayOfWeek] = useState("tuesday");
  const [meetingDate, setMeetingDate] = useState(initialDate);
  const [meetingTime, setMeetingTime] = useState(set(initialDate, { hours: 11, minutes: 0, seconds: 0, milliseconds: 0 }));
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isRecurring = frequency !== "one-time";

  const handleSave = async () => {
    setError(null);
    if (!agenda?.title?.trim()) {
      setError("Set a meeting title in the hero before scheduling.");
      return;
    }
    if (!orgId) {
      setError("Assign an organization (hero chip) before scheduling — the meeting needs an org binding.");
      return;
    }
    if (!meetingDate || !meetingTime) {
      setError("Pick a date and time.");
      return;
    }

    setBusy(true);
    try {
      const dateStr = format(meetingDate, "yyyy-MM-dd");
      const timeStr = `${pad2(meetingTime.getHours())}:${pad2(meetingTime.getMinutes())}`;
      const cadence = isRecurring
        ? { frequency, day: dayOfWeek, startDate: dateStr, time: timeStr }
        : null;
      const apiAttendees = visibleAttendees(agenda?.attendees).map((a) => ({
        email: a.email,
        name: a.name || a.email,
      }));
      const result = await createMeeting({
        orgId,
        title: agenda.title,
        agendaId,
        cadence,
        date: isRecurring ? null : dateStr,
        time: isRecurring ? null : timeStr,
        timezone: "America/Los_Angeles",
        attendees: apiAttendees,
      });

      // Build the canonical meetingDatetime from date+time (treated as Pacific
      // wall-clock and converted to UTC by JS using browser TZ — fine for our
      // PT user base; revisit with Intl.DateTimeFormat when we add a TZ picker).
      const meetingDatetime = new Date(meetingDate);
      meetingDatetime.setHours(meetingTime.getHours(), meetingTime.getMinutes(), 0, 0);

      // 1. Mirror to agenda doc.
      const seriesIdFromApi = result?.seriesId || result?.eventId;
      await updateDoc(doc(db, "agendas", agendaId), {
        graphEventId: result?.m365EventId || null,
        googleEventId: result?.eventId || null,
        iCalUID: result?.iCalUID || null,
        teamsUrl: result?.teamsUrl || null,
        calendarSeriesId: seriesIdFromApi,
        meetingDatetime,
        durationMinutes,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });

      // 2. Mirror to calendar_series doc (create-or-merge — doc id == series id).
      if (seriesIdFromApi) {
        await setDoc(
          doc(db, "calendar_series", seriesIdFromApi),
          {
            organizationId: orgId,
            title: agenda.title,
            status: "scheduled",
            recurrence: isRecurring ? frequency : null,
            graphSeriesEventId: result?.m365EventId || null,
            googleSeriesEventId: result?.seriesId || result?.eventId || null,
            iCalUID: result?.iCalUID || null,
            organizerEmail: "meetings@vistamarconsulting.com",
            sourceCalendar: "meetings@vistamarconsulting.com",
            teamsUrl: result?.teamsUrl || null,
            defaultAttendees: apiAttendees,
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || null,
          },
          { merge: true }
        );
      }

      onClose();
    } catch (err) {
      setError(err.message || "Schedule create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Schedule meeting
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          Mints a Microsoft Teams meeting on meetings@vistamarconsulting.com's calendar
          and fans the invite via Outlook to every attendee. Google Calendar mirror updates silently.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {/* Frequency pills */}
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.8 }}>
              Frequency
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8 }}>
              {FREQUENCY_OPTIONS.map((opt) => {
                const active = frequency === opt.id;
                return (
                  <Chip
                    key={opt.id}
                    label={opt.enabled ? opt.label : `${opt.label} · V2.2.2b.4`}
                    size="small"
                    onClick={opt.enabled ? () => setFrequency(opt.id) : undefined}
                    sx={{
                      bgcolor: active ? "#b87333" : "#f5f3ee",
                      color: active ? "#fff" : opt.enabled ? "#3d3d5c" : "#aaa",
                      fontWeight: active ? 600 : 500,
                      cursor: opt.enabled ? "pointer" : "not-allowed",
                      opacity: opt.enabled ? 1 : 0.5,
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          {/* Day of week (recurring only) */}
          {isRecurring && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.8 }}>
                Day of week
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                {WEEKDAYS.map((d) => {
                  const active = dayOfWeek === d.id;
                  return (
                    <Chip
                      key={d.id}
                      label={d.label}
                      size="small"
                      onClick={() => setDayOfWeek(d.id)}
                      sx={{
                        bgcolor: active ? "#5e35b1" : "#f5f3ee",
                        color: active ? "#fff" : "#3d3d5c",
                        fontWeight: active ? 600 : 500,
                        cursor: "pointer",
                        minWidth: 48,
                      }}
                    />
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Date + Time + Duration */}
          <Stack direction="row" spacing={2}>
            <DatePicker
              label={isRecurring ? "Start date" : "Meeting date"}
              value={meetingDate}
              onChange={setMeetingDate}
              slotProps={{ textField: { size: "small", fullWidth: true } }}
            />
            <TimePicker
              label="Start time"
              value={meetingTime}
              onChange={setMeetingTime}
              minutesStep={15}
              slotProps={{ textField: { size: "small", fullWidth: true } }}
            />
          </Stack>

          <Stack direction="row" spacing={2} alignItems="center">
            <TextField
              label="Duration (minutes)"
              type="number"
              size="small"
              value={durationMinutes}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n) && n > 0) setDurationMinutes(n);
              }}
              inputProps={{ min: 15, step: 15 }}
              sx={{ width: 200 }}
            />
            <Typography variant="caption" color="text.secondary">
              {visibleAttendees(agenda?.attendees).length} attendee
              {visibleAttendees(agenda?.attendees).length === 1 ? "" : "s"} will be invited.
            </Typography>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={busy}>
          {busy ? "Scheduling…" : "Schedule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
