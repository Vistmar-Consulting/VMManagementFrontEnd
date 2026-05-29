// V2.2.2b.2 — Manage Guests dialog. Per docs/AGENDA_DETAIL_PAGE_REFERENCE.md §4.8.
//
// Add/remove attendees on an agenda. On Save:
//   1. Compute add/remove diff vs. the original agenda.attendees array.
//   2. Call /api/meetings/attendees with the diff (Graph PATCH fans .ics to
//      added/removed; Google mirror updates silently).
//   3. Mirror to the agenda.attendees field in Firestore so the FE reflects
//      the new state immediately.
//
// "Apply to" scope radio (future-only / all-incl-past) is shown only when the
// series is recurring + bound. For ad-hoc / unbound, the scope is implicit
// (the only event in question).
//
// Silent proxies (meetings@, seo@) are never shown — they're stamped onto
// every Graph event by attendee-helpers.withSilentProxies and stay invisible
// to the user. The dialog works on the visibleAttendees list internally;
// the final agenda.attendees write reconstructs the full array by keeping
// any proxies that were already there.

import { useMemo, useState } from "react";
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
  FormControl,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { visibleAttendees } from "../lib/meetingHelpers.js";
import MemberAvatar from "./MemberAvatar.jsx";

// ── Inline API call for attendees endpoint ─────────────────────────────
// PUT /api/meetings/attendees
// { org_id, event_id, add: [...], remove: [...], applyTo: "future" | "all" }

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

export default function ManageGuestsDialog({ agenda, agendaId, calendarSeries, users, onClose }) {
  const { user } = useAuth();
  const isRecurring = !!calendarSeries?.recurrence;
  const isBound = !!(agenda?.graphEventId || calendarSeries?.graphSeriesEventId);

  // Original attendee set — visible (proxies hidden). Stable reference for the
  // diff computation.
  const originalVisible = useMemo(() => visibleAttendees(agenda?.attendees), [agenda?.attendees]);
  const originalRaw = agenda?.attendees || [];

  // Working list state — what the user is editing.
  const [working, setWorking] = useState(originalVisible);
  const [internalPick, setInternalPick] = useState(null);
  const [externalEmail, setExternalEmail] = useState("");
  const [externalName, setExternalName] = useState("");
  const [applyTo, setApplyTo] = useState("future");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const workingEmails = useMemo(
    () => new Set(working.map((a) => a.email?.toLowerCase()).filter(Boolean)),
    [working]
  );

  const internalChoices = useMemo(() => {
    return (users || [])
      .filter((u) => u.email && !workingEmails.has(u.email.toLowerCase()))
      .map((u) => ({
        email: u.email,
        name: u.displayName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
      }));
  }, [users, workingEmails]);

  const addAttendee = (att) => {
    if (!att?.email) return;
    if (workingEmails.has(att.email.toLowerCase())) return;
    setWorking((cur) => [...cur, att]);
  };
  const removeAttendee = (email) => {
    setWorking((cur) => cur.filter((a) => a.email?.toLowerCase() !== email.toLowerCase()));
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

  // Compute the diff vs original on Save.
  const computeDiff = () => {
    const origByEmail = new Map(originalVisible.map((a) => [a.email?.toLowerCase(), a]));
    const workingByEmail = new Map(working.map((a) => [a.email?.toLowerCase(), a]));
    const add = [];
    const remove = [];
    for (const [email, a] of workingByEmail) {
      if (!origByEmail.has(email)) add.push({ email: a.email, name: a.name || a.email });
    }
    for (const [email, a] of origByEmail) {
      if (!workingByEmail.has(email)) remove.push({ email: a.email, name: a.name || a.email });
    }
    return { add, remove };
  };

  const handleSave = async () => {
    setError(null);
    setBusy(true);
    const { add, remove } = computeDiff();

    if (add.length === 0 && remove.length === 0) {
      setBusy(false);
      onClose();
      return;
    }

    try {
      // 1. Graph + Google attendee patch via callable.
      if (isBound) {
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
      }
      // 2. Mirror to Firestore agenda doc. Reconstruct the full array:
      // working (visible) + any silent proxies that were already there.
      const proxiesFromOriginal = originalRaw.filter(
        (a) => !originalVisible.find((v) => v.email?.toLowerCase() === a.email?.toLowerCase())
      );
      const merged = [...working, ...proxiesFromOriginal];
      await updateDoc(doc(db, "agendas", agendaId), {
        attendees: merged,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Manage guests
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          Add or remove attendees on this {isRecurring ? "recurring series" : "meeting"}.
          {isBound
            ? " Graph delivers updated invites; the Google Calendar mirror updates silently."
            : " No calendar binding yet — changes save to the agenda only until V2.2.2b.3 wires the create flow."}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {/* Current attendees */}
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 1 }}>
              Attendees ({working.length})
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxHeight: 240, overflowY: "auto" }}>
              {working.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                  No attendees yet.
                </Typography>
              )}
              {working.map((a) => (
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
          </Box>

          {/* Add internal — autocomplete from users collection */}
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.5 }}>
              Add Vistamar team member
            </Typography>
            <Stack direction="row" spacing={1}>
              <Autocomplete
                size="small"
                fullWidth
                value={internalPick}
                onChange={(_, v) => setInternalPick(v)}
                options={internalChoices}
                getOptionLabel={(o) => o.name || o.email}
                isOptionEqualToValue={(a, b) => a.email === b.email}
                renderInput={(params) => (
                  <TextField {...params} placeholder="Pick a teammate…" size="small" />
                )}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={handleAddInternal}
                disabled={!internalPick}
              >
                Add
              </Button>
            </Stack>
          </Box>

          {/* Add external — free-text email + name */}
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.5 }}>
              Add external guest
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                placeholder="email@example.com"
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
              <Button
                size="small"
                variant="outlined"
                onClick={handleAddExternal}
                disabled={!externalEmail.trim()}
              >
                Add
              </Button>
            </Stack>
          </Box>

          {/* Apply-to scope for recurring + bound series */}
          {isRecurring && isBound && (
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

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
