// V2.2.2b.4 — Send Meeting Invite dialog.
//
// Computes the diff between agenda.attendees (current) and
// agenda.lastSentAttendees (what Graph last knows about), then fires the
// add/remove patch via /api/meetings/attendees. On success, mirrors the
// current set to agenda.lastSentAttendees so the diff clears.
//
// For recurring + bound series the user picks the applyTo scope
// (future-only vs. all-incl-past). For unbound agendas the button is gated
// upstream — this dialog assumes a bound event when it opens.

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
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { visibleAttendees } from "../lib/meetingHelpers.js";

// ── Inline API call ─────────────────────────────────────────────────────
// PUT /api/meetings/attendees — same payload as the Console version.

async function patchAttendees({ orgId, eventId, add, remove, applyTo }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const r = await fetch("/api/meetings/attendees", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({
      org_id: orgId || "unspecified",
      event_id: eventId,
      add: add || [],
      remove: remove || [],
      applyTo: applyTo || "future",
    }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(d.error || `HTTP ${r.status}`);
  }
  return r.json();
}

export default function SendInviteDialog({ agenda, agendaId, calendarSeries, onClose }) {
  const { user } = useAuth();
  const isRecurring = !!calendarSeries?.recurrence;

  const currentVisible = useMemo(() => visibleAttendees(agenda?.attendees), [agenda?.attendees]);
  const lastSent = useMemo(() => visibleAttendees(agenda?.lastSentAttendees), [agenda?.lastSentAttendees]);

  const { add, remove } = useMemo(() => {
    const lastByEmail = new Map(lastSent.map((a) => [a.email?.toLowerCase(), a]));
    const curByEmail = new Map(currentVisible.map((a) => [a.email?.toLowerCase(), a]));
    const add = [];
    const remove = [];
    for (const [email, a] of curByEmail) {
      if (!lastByEmail.has(email)) add.push({ email: a.email, name: a.name || a.email });
    }
    for (const [email, a] of lastByEmail) {
      if (!curByEmail.has(email)) remove.push({ email: a.email, name: a.name || a.email });
    }
    return { add, remove };
  }, [currentVisible, lastSent]);

  const [applyTo, setApplyTo] = useState("future");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSend = async () => {
    setError(null);
    if (add.length === 0 && remove.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const eventId =
        calendarSeries?.googleSeriesEventId
        || agenda?.googleEventId
        || agendaId;
      await patchAttendees({
        orgId: agenda?.organizationId || calendarSeries?.organizationId || null,
        eventId,
        add,
        remove,
        applyTo: isRecurring ? applyTo : "future",
      });
      await updateDoc(doc(db, "agendas", agendaId), {
        lastSentAttendees: agenda?.attendees || [],
        lastInviteSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Send failed");
    } finally {
      setBusy(false);
    }
  };

  const nothingToSend = add.length === 0 && remove.length === 0;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Send meeting invite
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          Updated invites go out from meetings@'s Outlook. Added attendees get the .ics;
          removed attendees get a cancellation. Google Calendar mirror updates silently.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {nothingToSend ? (
            <Alert severity="info">
              No changes since the last invite was sent. Everyone on the attendee list already has it.
            </Alert>
          ) : (
            <>
              {add.length > 0 && (
                <Box>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#2e7d32", mb: 0.8 }}>
                    Will receive invite ({add.length})
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {add.map((a) => (
                      <Chip
                        key={a.email}
                        label={a.name || a.email}
                        size="small"
                        sx={{ bgcolor: "#e8f5e9", color: "#1b5e20", fontSize: 11 }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
              {remove.length > 0 && (
                <Box>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#c62828", mb: 0.8 }}>
                    Will receive cancellation ({remove.length})
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {remove.map((a) => (
                      <Chip
                        key={a.email}
                        label={a.name || a.email}
                        size="small"
                        sx={{ bgcolor: "#ffebee", color: "#b71c1c", fontSize: 11 }}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {isRecurring && (
                <FormControl>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.5 }}>
                    Apply to
                  </Typography>
                  <RadioGroup row value={applyTo} onChange={(e) => setApplyTo(e.target.value)}>
                    <FormControlLabel value="future" control={<Radio size="small" />} label="Future meetings only" />
                    <FormControlLabel value="all" control={<Radio size="small" />} label="All instances (including past)" />
                  </RadioGroup>
                </FormControl>
              )}
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Back</Button>
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={busy || nothingToSend}
        >
          {busy ? "Sending…" : "Send invite"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
