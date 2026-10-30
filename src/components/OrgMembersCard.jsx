import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Close from "@mui/icons-material/Close";
import EditOutlined from "@mui/icons-material/EditOutlined";

import { useOrgMembers } from "../hooks/useOrgMembers.js";
import { isClientEmail, memberIdFromEmail, removeOrgMember, upsertOrgMember } from "../lib/orgMembers.js";

// Name / Email / Role inputs, labeled, shared by the add row and the edit row.
// Stacked on narrow screens.
function MemberFields({ name, email, role, onName, onEmail, onRole, disabled, emailPlaceholder, autoFocus = false }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flex: 1, minWidth: 0 }}>
      <TextField size="small" label="Name" value={name} onChange={(e) => onName(e.target.value)} disabled={disabled} sx={{ flex: 1 }} autoFocus={autoFocus} />
      <TextField size="small" label="Email" type="email" placeholder={emailPlaceholder} value={email} onChange={(e) => onEmail(e.target.value)} disabled={disabled} sx={{ flex: 1.3 }} />
      <TextField size="small" label="Role" placeholder="e.g. CEO, Doctor" value={role} onChange={(e) => onRole(e.target.value)} disabled={disabled} sx={{ flex: 1 }} />
    </Stack>
  );
}

export default function OrgMembersCard({ orgSlug, allowVMDomain = false }) {
  const { data: members, loading, error: loadError } = useOrgMembers(orgSlug);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState(null);

  // Inline edit state — only one row editable at a time.
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);

  // Member awaiting delete confirmation; kept while the dialog fades out.
  const [removing, setRemoving] = useState(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

  const sorted = [...(members || [])].sort((a, b) =>
    (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
  );

  const handleAdd = async () => {
    setAddError(null);
    const trimmedEmail = email.trim();
    const emailValid = allowVMDomain
      ? !!trimmedEmail && trimmedEmail.includes("@")
      : isClientEmail(trimmedEmail);
    if (!emailValid) {
      setAddError(allowVMDomain ? "Enter a valid email" : "Enter a valid non-Vistamar email");
      return;
    }
    setBusy(true);
    try {
      await upsertOrgMember(orgSlug, { name: name.trim(), email: trimmedEmail, role, source: "manual", allowVMDomain });
      setName("");
      setEmail("");
      setRole("");
    } catch (err) {
      setAddError(err.message || "Add failed");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRemove = async () => {
    setRemoveBusy(true);
    try {
      await removeOrgMember(orgSlug, removing.id);
    } catch (err) {
      setAddError(err.message || "Remove failed");
    } finally {
      setRemoveBusy(false);
      setRemoveOpen(false);
    }
  };

  const startEdit = (member) => {
    setEditingId(member.id);
    setEditName(member.name || "");
    setEditEmail(member.email || "");
    setEditRole(member.role || "");
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (member) => {
    setEditError(null);
    const trimmedEmail = editEmail.trim();
    const emailValid = allowVMDomain
      ? !!trimmedEmail && trimmedEmail.includes("@")
      : isClientEmail(trimmedEmail);
    if (!emailValid) {
      setEditError(allowVMDomain ? "Enter a valid email" : "Enter a valid non-Vistamar email");
      return;
    }
    setEditBusy(true);
    try {
      const newId = memberIdFromEmail(trimmedEmail);
      if (newId !== member.id) {
        // Email changed — delete old doc, create new one.
        await removeOrgMember(orgSlug, member.id);
      }
      await upsertOrgMember(orgSlug, { name: editName.trim(), email: trimmedEmail, role: editRole, source: member.source || "manual", allowVMDomain });
      setEditingId(null);
    } catch (err) {
      setEditError(err.message || "Save failed");
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: "#6b6b8a",
            mb: 1.5,
          }}
        >
          Members
        </Typography>

        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {loadError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {loadError.message || "Failed to load members"}
          </Alert>
        )}

        {!loading && !loadError && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1.5 }}>
            {sorted.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No members yet — added automatically when you schedule meetings, or add one below.
              </Typography>
            ) : (
              sorted.map((member) =>
                editingId === member.id ? (
                  <Box key={member.id} sx={{ display: "flex", flexDirection: "column", gap: 0.75, py: 1 }}>
                    <MemberFields
                      name={editName}
                      email={editEmail}
                      role={editRole}
                      onName={setEditName}
                      onEmail={(v) => { setEditEmail(v); if (editError) setEditError(null); }}
                      onRole={setEditRole}
                      disabled={editBusy}
                      autoFocus
                    />
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" onClick={() => handleSaveEdit(member)} disabled={editBusy || !editEmail.trim()}>
                        {editBusy ? "Saving…" : "Save"}
                      </Button>
                      <Button size="small" onClick={cancelEdit} disabled={editBusy}>Cancel</Button>
                    </Stack>
                    {editError && <Alert severity="error" sx={{ py: 0 }}>{editError}</Alert>}
                  </Box>
                ) : (
                  <Box
                    key={member.id}
                    sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4 }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                        {member.name || member.email}
                        {member.role && (
                          <Box component="span" sx={{ fontWeight: 400, color: "text.secondary" }}>{` · ${member.role}`}</Box>
                        )}
                      </Typography>
                      {member.name && (
                        <Typography sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.3 }}>
                          {member.email}
                        </Typography>
                      )}
                    </Box>
                    <IconButton size="small" onClick={() => startEdit(member)} aria-label={`Edit ${member.name || member.email}`}>
                      <EditOutlined sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => { setRemoving(member); setRemoveOpen(true); }} aria-label={`Remove ${member.name || member.email}`}>
                      <Close sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                )
              )
            )}
          </Box>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Add a member
        </Typography>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <MemberFields
            name={name}
            email={email}
            role={role}
            onName={setName}
            onEmail={(v) => {
              setEmail(v);
              if (addError) setAddError(null);
            }}
            onRole={setRole}
            disabled={busy}
            emailPlaceholder={allowVMDomain ? "name@vistamarconsulting.com" : "email@client.com"}
          />
          <Button
            variant="outlined"
            onClick={handleAdd}
            disabled={busy || !email.trim()}
            sx={{ height: 40, flexShrink: 0 }}
          >
            {busy ? "Adding…" : "Add"}
          </Button>
        </Stack>

        {addError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {addError}
          </Alert>
        )}
      </CardContent>

      <Dialog
        open={removeOpen}
        onClose={() => { if (!removeBusy) setRemoveOpen(false); }}
        TransitionProps={{ onExited: () => setRemoving(null) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>Delete member?</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {removing?.name || removing?.email}
          </Typography>
          {removing?.name && (
            <Typography variant="body2" color="text.secondary">{removing.email}</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoveOpen(false)} disabled={removeBusy}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirmRemove} disabled={removeBusy}>
            {removeBusy ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
