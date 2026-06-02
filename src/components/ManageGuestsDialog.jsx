// V2.2.2b.4 — Manage Guests dialog (staged-invite refactor).
//
// Edits agenda.attendees only. Does NOT call /api/meetings/attendees. The
// actual Graph/Google attendee patch is staged behind a dedicated
// "Send Meeting Invite" button in the Action Bar, which compares the current
// agenda.attendees set against agenda.lastSentAttendees and fires only the
// diff. This means edits are reversible until the user explicitly ships them
// — no surprise .ics blasts when an admin is just cleaning up names.
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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { visibleAttendees } from "../lib/meetingHelpers.js";
import { isClientEmail, upsertOrgMember } from "../lib/orgMembers.js";
import { useOrgMembers } from "../hooks/useOrgMembers.js";
import MemberAvatar from "./MemberAvatar.jsx";

export default function ManageGuestsDialog({ agenda, agendaId, calendarSeries, users, onClose }) {
  const { user } = useAuth();
  const isBound = !!(agenda?.graphEventId || calendarSeries?.graphSeriesEventId);

  // Resolve the meeting's org + whether this is the cross-org master agenda.
  // The master spans many orgs, so its attendees must NOT be captured into any
  // single org directory (they'd be misfiled), and the client dropdown stays
  // empty/disabled for it.
  const orgSlug = calendarSeries?.organizationId || agenda?.organizationId || null;
  const isMaster = !!(calendarSeries?.masterAgenda || agenda?.masterAgenda);

  // Original attendee set — visible (proxies hidden). Stable reference for the
  // diff computation against lastSentAttendees.
  const originalVisible = useMemo(() => visibleAttendees(agenda?.attendees), [agenda?.attendees]);
  const originalRaw = agenda?.attendees || [];

  // Working list state — what the user is editing.
  const [working, setWorking] = useState(originalVisible);
  const [internalPick, setInternalPick] = useState(null);
  const [clientPick, setClientPick] = useState(null);
  const [externalEmail, setExternalEmail] = useState("");
  const [externalName, setExternalName] = useState("");
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

  // Per-org client directory (organizations/{orgSlug}/members). Pass null for
  // the master agenda so it stays empty (useOrgMembers(null) short-circuits).
  // Same dedup against the current attendee roster as the Vistamar dropdown.
  const { data: orgMembers } = useOrgMembers(isMaster ? null : orgSlug);
  const clientOptions = useMemo(() => {
    return (orgMembers || [])
      .filter((m) => m.email && !workingEmails.has(m.email.toLowerCase()))
      .map((m) => ({ email: m.email, name: m.name || m.email }));
  }, [orgMembers, workingEmails]);

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
  const handleAddClient = () => {
    if (clientPick) {
      addAttendee(clientPick);
      setClientPick(null);
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

  const handleSave = async () => {
    setError(null);
    setBusy(true);
    try {
      // Reconstruct full attendee list = working (visible) + silent proxies
      // from the original. Proxies never appear in the working list, so we
      // splice them back in here.
      const proxiesFromOriginal = originalRaw.filter(
        (a) => !originalVisible.find((v) => v.email?.toLowerCase() === a.email?.toLowerCase())
      );
      const merged = [...working, ...proxiesFromOriginal];

      const patch = {
        attendees: merged,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      };
      // Legacy agendas (reconciled in before V2.2.2b.4) have no
      // lastSentAttendees. Seed the baseline with the ORIGINAL attendee set
      // (pre-edit) so the post-save diff equals exactly what the user just
      // changed — not "every attendee is new." Without this, the first
      // Send Meeting Invite click would re-fan invites to everyone.
      if (agenda?.lastSentAttendees === undefined) {
        patch.lastSentAttendees = originalRaw;
      }

      await updateDoc(doc(db, "agendas", agendaId), patch);

      // Auto-capture non-Vistamar attendees into the org's member directory
      // (best-effort). Skip the cross-org master agenda — its attendees span
      // many orgs and would be misfiled into a single directory.
      if (orgSlug && !isMaster) {
        try {
          await Promise.all(
            working
              .filter((a) => isClientEmail(a.email))
              .map((a) => upsertOrgMember(orgSlug, { name: a.name, email: a.email, source: "scheduler" })),
          );
        } catch {
          // best-effort: directory capture must never fail the save; idempotent, re-captured next save
        }
      }

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
          {isBound
            ? "Add or remove attendees. Changes save to the agenda — click Send Meeting Invite in the Action Bar to ship the diff to Outlook + Google."
            : "Add or remove attendees. No calendar event yet; schedule the meeting first to start sending invites."}
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

          {/* Add client — autocomplete from the org's member directory */}
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#6b6b8a", mb: 0.5 }}>
              Add client attendee
            </Typography>
            <Stack direction="row" spacing={1}>
              <Autocomplete
                size="small"
                fullWidth
                value={clientPick}
                onChange={(_, v) => setClientPick(v)}
                options={clientOptions}
                getOptionLabel={(o) => o.name || o.email}
                isOptionEqualToValue={(a, b) => a.email === b.email}
                disabled={!orgSlug || isMaster}
                renderInput={(params) => (
                  <TextField {...params} placeholder="Add client attendee…" size="small" />
                )}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={handleAddClient}
                disabled={!clientPick}
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
