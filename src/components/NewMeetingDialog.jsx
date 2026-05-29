// V2.2.2b.5 — New Meeting Dialog. Opens from the Calendar page's "+ New
// Meeting" button. Single comprehensive form: title + org + attendees +
// cadence (frequency / ordinal / day-of-week / date / time / duration).
//
// On Save:
//   1. Create a fresh agenda doc in Firestore (status='draft', attendees,
//      organizationId).
//   2. Call /api/meetings/create with the new agenda id — mints a Teams
//      event on meetings@'s Outlook, dual-writes the Google mirror, fans
//      .ics invites.
//   3. Write the returned IDs (graphEventId, googleEventId, iCalUID,
//      teamsUrl, calendarSeriesId) back to the agenda. Seed
//      lastSentAttendees so the staged-invite diff stays cold.
//   4. setDoc the calendar_series with merge — keeps the binding between
//      org / series id / Teams URL canonical even if the user later cancels
//      the agenda and creates another.
//   5. Navigate to /agendas/{newAgendaId}.
//
// Modeled on ScheduleCreateDialog + ManageGuestsDialog. Kept self-contained
// rather than composing the two — single-form UX is meaningfully better
// than a two-step wizard, and the duplication is small.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { addDays, format, set } from "date-fns";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { createMeeting } from "../lib/meetingsApi.js";
import MemberAvatar from "./MemberAvatar.jsx";

const FREQUENCY_OPTIONS = [
  { id: "one-time", label: "One-time" },
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Biweekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
];

const WEEKDAYS = [
  { id: "monday", label: "Mon" },
  { id: "tuesday", label: "Tue" },
  { id: "wednesday", label: "Wed" },
  { id: "thursday", label: "Thu" },
  { id: "friday", label: "Fri" },
];

const ORDINALS = [
  { id: "first", label: "1st" },
  { id: "second", label: "2nd" },
  { id: "third", label: "3rd" },
  { id: "fourth", label: "4th" },
  { id: "last", label: "Last" },
];

function pad2(n) { return String(n).padStart(2, "0"); }

export default function NewMeetingDialog({ orgs, users, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const initialDate = useMemo(() => addDays(new Date(), 1), []);

  const [title, setTitle] = useState("");
  const [orgId, setOrgId] = useState("");
  const [attendees, setAttendees] = useState([]); // {email, name}[]
  const [internalPick, setInternalPick] = useState(null);
  const [externalEmail, setExternalEmail] = useState("");
  const [externalName, setExternalName] = useState("");
  const [frequency, setFrequency] = useState("one-time");
  const [dayOfWeek, setDayOfWeek] = useState("tuesday");
  const [ordinal, setOrdinal] = useState("second");
  const [meetingDate, setMeetingDate] = useState(initialDate);
  const [meetingTime, setMeetingTime] = useState(
    set(initialDate, { hours: 11, minutes: 0, seconds: 0, milliseconds: 0 })
  );
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isRecurring = frequency !== "one-time";
  const needsOrdinal = frequency === "monthly" || frequency === "quarterly";

  const attendeeEmails = useMemo(
    () => new Set(attendees.map((a) => a.email?.toLowerCase()).filter(Boolean)),
    [attendees]
  );

  const internalChoices = useMemo(() => {
    return (users || [])
      .filter((u) => u.email && !attendeeEmails.has(u.email.toLowerCase()))
      .map((u) => ({
        email: u.email,
        name: u.displayName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
      }));
  }, [users, attendeeEmails]);

  const addAttendee = (att) => {
    if (!att?.email) return;
    if (attendeeEmails.has(att.email.toLowerCase())) return;
    setAttendees((cur) => [...cur, att]);
  };
  const removeAttendee = (email) => {
    setAttendees((cur) => cur.filter((a) => a.email?.toLowerCase() !== email.toLowerCase()));
  };
  const handleAddInternal = () => {
    if (internalPick) {
      addAttendee(internalPick);
      setInternalPick(null);
    }
  };
  const handleAddExternal = () => {
    const e = externalEmail.trim().toLowerCase();
    if (!e || !/^[^@]+@[^@]+\.[^@]+$/.test(e)) {
      setError("Enter a valid email address");
      return;
    }
    addAttendee({ email: e, name: externalName.trim() || e });
    setExternalEmail("");
    setExternalName("");
    setError(null);
  };

  const validate = () => {
    if (!title.trim()) return "Set a meeting title.";
    if (!orgId) return "Pick an organization.";
    if (attendees.length === 0) return "Add at least one attendee.";
    if (!meetingDate || !meetingTime) return "Pick a date and time.";
    return null;
  };

  const handleCreate = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setBusy(true);
    try {
      const dateStr = format(meetingDate, "yyyy-MM-dd");
      const timeStr = `${pad2(meetingTime.getHours())}:${pad2(meetingTime.getMinutes())}`;
      const cadence = isRecurring
        ? {
            frequency,
            day: dayOfWeek,
            startDate: dateStr,
            time: timeStr,
            ...(needsOrdinal && { ordinal }),
          }
        : null;
      const apiAttendees = attendees.map((a) => ({
        email: a.email,
        name: a.name || a.email,
      }));

      // 1. Mint the agenda doc up front so /api/meetings/create has an
      //    agenda_id to reference and reconcile later (the API stamps the
      //    extendedProperties.shared.vmAgendaId on the Graph event from
      //    the value we pass in).
      const meetingDatetime = new Date(meetingDate);
      meetingDatetime.setHours(meetingTime.getHours(), meetingTime.getMinutes(), 0, 0);
      const newAgendaRef = await addDoc(collection(db, "agendas"), {
        title: title.trim(),
        organizationId: orgId,
        attendees: apiAttendees,
        status: "scheduled",
        meetingDatetime,
        durationMinutes,
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || null,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });

      // 2. Mint Graph + Google + Teams + invites.
      const result = await createMeeting({
        orgId,
        title: title.trim(),
        agendaId: newAgendaRef.id,
        cadence,
        date: isRecurring ? null : dateStr,
        time: isRecurring ? null : timeStr,
        timezone: "America/Los_Angeles",
        attendees: apiAttendees,
      });

      // 3. Write the meeting IDs back to the agenda. Seed lastSentAttendees
      //    with what we just shipped so the Send Meeting Invite button
      //    stays cold until the user actually drifts the roster.
      const seriesIdFromApi = result?.seriesId || result?.eventId;
      await updateDoc(doc(db, "agendas", newAgendaRef.id), {
        graphEventId: result?.m365EventId || null,
        googleEventId: result?.eventId || null,
        iCalUID: result?.iCalUID || null,
        teamsUrl: result?.teamsUrl || null,
        calendarSeriesId: seriesIdFromApi,
        lastSentAttendees: apiAttendees,
        lastInviteSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });

      // 4. Mint / merge the calendar_series doc.
      if (seriesIdFromApi) {
        await setDoc(
          doc(db, "calendar_series", seriesIdFromApi),
          {
            organizationId: orgId,
            title: title.trim(),
            status: "scheduled",
            recurrence: isRecurring ? frequency : null,
            graphSeriesEventId: result?.m365EventId || null,
            googleSeriesEventId: result?.seriesId || result?.eventId || null,
            iCalUID: result?.iCalUID || null,
            organizerEmail: "meetings@vistamarconsulting.com",
            sourceCalendar: "meetings@vistamarconsulting.com",
            teamsUrl: result?.teamsUrl || null,
            defaultAttendees: apiAttendees,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || null,
          },
          { merge: true }
        );
      }

      // 5. Navigate to the new agenda.
      navigate(`/agendas/${newAgendaRef.id}`);
    } catch (err) {
      setError(err.message || "Create meeting failed");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Create new meeting
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          Mints a Microsoft Teams meeting on meetings@vistamarconsulting.com's
          calendar, fans the invite via Outlook to every attendee, and mirrors
          to Google Calendar. Lands you in the new agenda when done.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {/* Title */}
          <TextField
            label="Meeting title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            size="small"
            fullWidth
            autoFocus
            placeholder="e.g. Total Vision — Weekly Marketing Check-in"
          />

          {/* Organization */}
          <TextField
            select
            label="Organization"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            size="small"
            fullWidth
            helperText="Drives org-scoped item filtering inside the agenda's topics."
          >
            {[...(orgs || [])]
              .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
              .map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.name}
                </MenuItem>
              ))}
          </TextField>

          {/* Frequency */}
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
                    label={opt.label}
                    size="small"
                    onClick={() => setFrequency(opt.id)}
                    sx={{
                      bgcolor: active ? "#b87333" : "#f5f3ee",
                      color: active ? "#fff" : "#3d3d5c",
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          {/* Ordinal (monthly/quarterly) */}
          {needsOrdinal && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.8 }}>
                Which week
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                {ORDINALS.map((o) => {
                  const active = ordinal === o.id;
                  return (
                    <Chip
                      key={o.id}
                      label={o.label}
                      size="small"
                      onClick={() => setOrdinal(o.id)}
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

          {/* Day of week */}
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
            <TextField
              label="Duration (min)"
              type="number"
              size="small"
              value={durationMinutes}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n) && n > 0) setDurationMinutes(n);
              }}
              inputProps={{ min: 15, step: 15 }}
              sx={{ width: 140 }}
            />
          </Stack>

          {/* Attendees */}
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 1 }}>
              Attendees ({attendees.length})
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1.5, maxHeight: 200, overflowY: "auto" }}>
              {attendees.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                  No attendees yet. Add at least one below.
                </Typography>
              )}
              {attendees.map((a) => (
                <Box key={a.email} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4 }}>
                  <MemberAvatar
                    user={(users || []).find((u) => u.email?.toLowerCase() === a.email?.toLowerCase()) || { displayName: a.name, email: a.email }}
                    size={22}
                    border={false}
                    tooltip={false}
                  />
                  <Typography sx={{ flex: 1, fontSize: 13 }}>{a.name || a.email}</Typography>
                  <IconButton size="small" onClick={() => removeAttendee(a.email)} aria-label="Remove">
                    <Close sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>

            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <Autocomplete
                size="small"
                fullWidth
                value={internalPick}
                onChange={(_, v) => setInternalPick(v)}
                options={internalChoices}
                getOptionLabel={(o) => o.name || o.email}
                isOptionEqualToValue={(a, b) => a.email === b.email}
                renderInput={(params) => (
                  <TextField {...params} placeholder="Add Vistamar teammate…" size="small" />
                )}
              />
              <Button size="small" variant="outlined" onClick={handleAddInternal} disabled={!internalPick}>
                Add
              </Button>
            </Stack>

            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                placeholder="external@example.com"
                value={externalEmail}
                onChange={(e) => setExternalEmail(e.target.value)}
              />
              <TextField
                size="small"
                fullWidth
                placeholder="Display name (optional)"
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
              />
              <Button size="small" variant="outlined" onClick={handleAddExternal} disabled={!externalEmail.trim()}>
                Add
              </Button>
            </Stack>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={handleCreate} disabled={busy}>
          {busy ? "Creating…" : "Create meeting"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
